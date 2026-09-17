/**
 * dsh-llm-hub —— harness 委派半（host）。
 *
 * 把**本机已经装好**的外部 agent CLI 注册成 DSH 的子代理提供方，于是会话里可以
 * 用 `subagent_codex` / `subagent_claude_code` / `subagent_antigravity` 把一段独立
 * 任务甩出去，各自烧各自的订阅额度（ChatGPT / Claude / Google AI）。
 *
 * ## 为什么长在本插件里
 *
 * host 半已经在做「探测 → 判定 → 只做减法」这件事（模型可用性）。harness 是同一条
 * 线的延伸：探测对象从「网关能不能连」换成「CLI 装没装」，判定结果从「把 provider
 * 从路由表里摘掉」换成「注册 / 不注册 provider」。
 *
 * ## 装了才出现
 *
 * 三个 provider **只在对应可执行文件真的存在时才注册**。`dsh-tool-subagent` 遇到
 * 缺失的 provider 只打一条 info（`provider "x" not registered yet; the "..." tool
 * will register when it appears`），工具行会延迟到 provider 出现才注册 —— 所以
 * 别人机器上没装 codex，`subagent_codex` 就静默不出现，DSH 照常启动。
 * 这就是「检查人家电脑装没装」的全部实现：**不注册即不存在**，不需要 UI 开关。
 *
 * ## 为什么不自己扫 PATH
 *
 * `ctx.subprocess.resolveExecutable` 是内核自己的解析器，与子进程真正执行时用的是
 * 同一套 PATH 视图。自己扫 PATH 会在两处翻车：登录 shell 的 alias（本机 `agy` 就是
 * 个带 `--dangerously-skip-permissions` 的 alias，`command -v` 返回的是 alias 定义
 * 而不是路径），以及 launchd 起的宿主进程根本读不到 `.zshrc` 里的 PATH。
 *
 * ## 为什么内核符号是**动态** import
 *
 * 本包零运行时依赖，`@deepseek-ai/dsh-subagent` / `-session` 由宿主提供 —— 在 profile
 * 里经 `.dsh-module-fallback` 解析到宿主的 node_modules（2026-09-17 实测
 * `import.meta.resolve` 可解析），但在**仓库目录里解析不到**。顶部静态 import 会因此
 * 两头挨打：仓库内 `node --test` 直接 MODULE_NOT_FOUND，而线上一旦某个宿主版本少了
 * 其中一个导出，整个插件加载失败 —— 连余额和模型发现一起没了。惰性载入把这个风险
 * 关在 harness 这一段里：载不到就只是不启用它。
 *
 * @module dsh-llm-hub/harness
 */

import { randomUUID } from 'node:crypto'

/** 收集子进程 stdout 的上限；超过就只留头部（宁可截断也要有答案）。 */
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
/** 出错诊断保留的 stderr 尾巴。agy 的 glog 在日志目录不可写时能喷 300+ 行，不能全留。 */
const MAX_STDERR_TAIL_BYTES = 8 * 1024
/** SIGTERM 到 SIGKILL 之间的宽限。 */
const DISPOSE_GRACE_MS = 3000
/** agy 的 `--print-timeout`，与它自己的默认值（5m）一致。 */
const AGY_PRINT_TIMEOUT = '300s'
/** ANSI 转义序列。CLI 即使不在 TTY 下也可能上色。 */
const ANSI_PATTERN = /\[[0-9;?]*[ -/]*[@-~]/g

/**
 * 本机可能装着的外部 harness。
 *
 * 三个 CLI 的非交互模式都已实测：**stdout 是干净的最终答案，日志全在 stderr**
 * （2026-09-17 实测 codex 0.153.4 / claude 2.1.252 / agy 1.2.5，三个都只输出
 * `PONG\n`）。所以不需要解析各家的 stream-json，收 stdout 即可。
 */
const HARNESSES = [
	{
		id: 'codex',
		bin: 'codex',
		displayName: 'Codex',
		// `--skip-git-repo-check`：父会话的 cwd 不一定是 git 仓库，缺这个 flag 会直接拒跑。
		args: (task) => ['exec', '--skip-git-repo-check', task]
	},
	{
		id: 'claude-code',
		bin: 'claude',
		displayName: 'Claude Code',
		args: (task) => ['-p', task]
	},
	{
		id: 'antigravity',
		bin: 'agy',
		displayName: 'Antigravity',
		// `--dangerously-skip-permissions` 不是图方便：headless print 模式下 agy 会
		// **自动拒绝** `command` 权限，于是任何碰文件或命令的任务都静默返回空答案。
		args: (task) => ['-p', task, '--dangerously-skip-permissions', '--print-timeout', AGY_PRINT_TIMEOUT]
	}
]

/**
 * 空能力声明 —— 与内核的 `NO_START_CAPABILITIES` 等价，这里内联。
 *
 * 内联而不是 import：**探测与注册属于启动路径**，不该因为内核模块解析失败而整段
 * 跳过（那样用户会看到「harness 一个都没探到」，而真因是 import）。真正需要内核的
 * 只有 `start()` 里那三个非平凡函数（结算竞态、run 句柄、cwd 解析），它们惰性载入。
 *
 * 将来内核新增能力字段时这里会落后一个字段 —— 但缺失字段读出来是 `undefined`，与
 * `false` 同义（「不支持」），所以落后的方向是安全的：只会少声明能力，不会多声明。
 */
const NO_CAPABILITIES = Object.freeze({
	agentOptions: false,
	outputSchema: false,
	depthLimit: false,
	toolFilter: false,
	persona: false
})

/** 惰性载入的内核符号；`loadKernel` 填，之后全模块共用。 */
let kernel

/**
 * 载入本模块用到的内核符号。
 *
 * 载入失败直接抛 —— 调用方（`applyHarness`）会把它降级成一条 warn，harness 不启用，
 * 插件其余部分不受影响。
 * @returns 内核符号集合。
 */
async function loadKernel() {
	if (kernel !== undefined) return kernel
	const [subagent, session] = await Promise.all([
		import('@deepseek-ai/dsh-subagent'),
		import('@deepseek-ai/dsh-session')
	])
	const missing = ['resolveChildCwd', 'settleRunResult', 'subprocessRunHandle']
		.filter((key) => subagent[key] === undefined)
	if (missing.length > 0) throw new Error(`dsh-subagent 缺少导出：${missing.join(', ')}`)
	if (session.SessionId === undefined) throw new Error('dsh-session 缺少导出：SessionId')
	kernel = {
		resolveChildCwd: subagent.resolveChildCwd,
		settleRunResult: subagent.settleRunResult,
		subprocessRunHandle: subagent.subprocessRunHandle,
		SessionId: session.SessionId
	}
	return kernel
}

/**
 * 剥掉 ANSI 转义。
 * @param text - 原始文本。
 * @returns 去色后的文本。
 */
export function stripAnsi(text) {
	return text.replace(ANSI_PATTERN, '')
}

/**
 * 按字节预算截取字符串头部，不切坏多字节字符。
 * @param text - 原始文本。
 * @param budget - 字节预算。
 * @returns 截取后的文本。
 */
function headToByteBudget(text, budget) {
	if (Buffer.byteLength(text, 'utf8') <= budget) return text
	return Buffer.from(text, 'utf8').subarray(0, budget).toString('utf8').replace(/�$/, '')
}

/**
 * 只保留 stderr 的尾部。
 * @param tail - 已保留的尾部。
 * @param chunk - 新到的块。
 * @returns 合并后仍在预算内的尾部。
 */
function retainStderrTail(tail, chunk) {
	const merged = tail + chunk
	if (Buffer.byteLength(merged, 'utf8') <= MAX_STDERR_TAIL_BYTES) return merged
	const buffer = Buffer.from(merged, 'utf8')
	return buffer.subarray(buffer.length - MAX_STDERR_TAIL_BYTES).toString('utf8').replace(/^�/, '')
}

/**
 * 把 prompt 折成一段纯文本任务；非文本块丢弃（这些 CLI 只吃文本）。
 * @param prompt - 内核给的 prompt 块序列。
 * @returns 拼好的任务文本。
 */
export function textTask(prompt) {
	const parts = []
	for (const block of prompt) if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
	return parts.join('\n\n').trim()
}

/**
 * 组装一次运行的 argv。
 * @param harness - harness 定义。
 * @param executable - 已解析的可执行文件路径。
 * @param task - 任务文本。
 * @returns 完整 argv。
 */
export function harnessArgv(harness, executable, task) {
	return [executable, ...harness.args(task)]
}

/**
 * 有 stderr 尾巴就作为诊断后缀附上。
 * @param stderrTail - 保留的 stderr 尾部。
 * @returns 诊断后缀，或空串。
 */
function diagnosticSuffix(stderrTail) {
	const trimmed = stderrTail.trim()
	return trimmed.length === 0 ? '' : `\nstderr 尾部：\n${trimmed}`
}

/**
 * 把一次退出折成结果，或抛出带诊断的失败。
 *
 * 独立成函数是为了能单测 —— 判定链的每个分支都对应一种真实故障，而它们都不会有
 * 编译错误，只会让父 agent 拿到错的东西。
 * @param prefix - 诊断前缀。
 * @param bin - CLI 名字。
 * @param exitCode - 退出码（被信号终止时为 null）。
 * @param stdout - 收到的原始 stdout。
 * @param stderrTail - 保留的 stderr 尾部。
 * @returns 终态结果。
 */
export function printOutcome(prefix, bin, exitCode, stdout, stderrTail) {
	const answer = stripAnsi(stdout).trim()
	if (exitCode !== 0) {
		const how = exitCode === null ? '被信号终止' : `以 ${String(exitCode)} 退出`
		throw new Error(`${prefix}: ${bin} ${how}`
			+ (answer.length > 0 ? `，已打印：\n${answer}` : '')
			+ diagnosticSuffix(stderrTail))
	}
	// 退出码 0 但一个字都没打印：不能报 completed，否则父 agent 拿到空答案却以为成功。
	// agy 在缺 `--dangerously-skip-permissions` 时就是这个形状（权限被自动拒，静默空输出）。
	if (answer.length === 0) {
		throw new Error(`${prefix}: ${bin} 正常退出但没有输出答案${diagnosticSuffix(stderrTail)}`)
	}
	return { output: [{ type: 'text', text: answer }], stopReason: 'completed' }
}

/**
 * 关掉子进程并等整棵进程树消失。
 * @param child - 子进程句柄。
 */
async function disposeChild(child) {
	if (child.pid <= 0) {
		await child.done.catch(() => {})
		return
	}
	child.terminate()
	await child.waitForExit().catch(() => {})
	await child.done.catch(() => {})
}

/**
 * 起一次 CLI 运行并发布它的 one-shot run。
 * @param harness - harness 定义（HARNESSES 中一项）。
 * @param request - 内核解析好的委派请求。
 * @param deps - 可执行文件路径、cwd、环境、spawn 与日志回调。
 * @returns 已发布的 run 句柄。
 */
async function startHarnessRun(harness, request, deps) {
	const k = await loadKernel()
	const prefix = `dsh-llm-hub/${harness.id}`
	const task = textTask(request.prompt)
	if (task.length === 0) throw new Error(`${prefix}: 委派任务为空`)
	if (request.signal.aborted) throw new Error(`${prefix}: 请求在 ${harness.bin} 启动前已取消`)

	const child = deps.spawn({
		argv: harnessArgv(harness, deps.executable, task),
		cwd: deps.cwd,
		// stdin 给 /dev/null：三个 CLI 都会读 stdin 追加输入，不关掉会等到 EOF 才动。
		stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
		graceMs: DISPOSE_GRACE_MS,
		env: deps.env
	})

	// 第二道取消闸：pre-spawn 检查与这里之间请求可能已被取消，而此时进程已经起来了，
	// 必须先把它收干净再抛，否则留下一棵孤儿进程树。
	if (request.signal.aborted) {
		const failure = new Error(`${prefix}: 请求在 ${harness.bin} 启动过程中被取消`)
		await disposeChild(child)
		throw failure
	}

	const stdout = child.stdout
	if (stdout === undefined) {
		await disposeChild(child)
		throw new Error(`${prefix}: spawn 没有给出可读的 stdout`)
	}

	let captured = ''
	let capturedBytes = 0
	let stderrTail = ''
	stdout.setEncoding('utf8')
	stdout.on('data', (chunk) => {
		if (capturedBytes >= MAX_STDOUT_BYTES) return
		const remaining = MAX_STDOUT_BYTES - capturedBytes
		const keep = Buffer.byteLength(chunk, 'utf8') > remaining ? headToByteBudget(chunk, remaining) : chunk
		capturedBytes += Buffer.byteLength(keep, 'utf8')
		captured += keep
	})
	// 流上的错误不能让宿主进程崩。
	stdout.on('error', () => {})
	const stderr = child.stderr
	if (stderr !== undefined) {
		stderr.setEncoding('utf8')
		stderr.on('data', (chunk) => { stderrTail = retainStderrTail(stderrTail, chunk) })
		stderr.on('error', () => {})
	}

	/** 取消或失败抢到结算时，把能捞的文本交出去。 */
	const collectOutput = () => {
		const answer = stripAnsi(captured).trim()
		return answer.length > 0 ? [{ type: 'text', text: answer }] : []
	}

	const runAbort = new AbortController()
	const requestCancel = () => {
		if (runAbort.signal.aborted) return
		runAbort.abort(new Error(`${prefix}: 运行被本地取消`))
		if (child.pid > 0) child.terminate()
	}
	const onAbort = () => { requestCancel() }
	request.signal.addEventListener('abort', onAbort, { once: true })

	const result = k.settleRunResult({
		attempt: async () => {
			const outcome = await child.done
			return printOutcome(prefix, harness.bin, outcome.exitCode, captured, stderrTail)
		},
		collectOutput,
		cancelled: () => runAbort.signal.aborted,
		onError: deps.onError,
		signal: request.signal,
		onAbort
	})

	return k.subprocessRunHandle({
		id: k.SessionId(randomUUID()),
		result,
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown: () => disposeChild(child)
	})
}

/**
 * 造一个 harness 的子代理提供方。
 *
 * `capabilities` 全 false、`inheritsParentContext` false：子进程在另一个运行时里，
 * 父侧的 persona / 工具过滤 / 深度上限 / 结构化输出都管不到它，所以一个都不声明 ——
 * 内核会在 start 之前就拒掉需要这些能力的请求，而不是接了再悄悄忽略。
 * @param ctx - 插件上下文（带 subprocess 与 logger）。
 * @param harness - harness 定义。
 * @param executable - 已解析的可执行文件绝对路径。
 * @returns 可直接 registerProvider 的提供方。
 */
export function createProvider(ctx, harness, executable) {
	const prefix = `dsh-llm-hub/${harness.id}`
	return {
		name: harness.id,
		capabilities: NO_CAPABILITIES,
		inheritsParentContext: false,
		async start(request) {
			const k = await loadKernel()
			const parentCwd = request.parent?.session?.header?.cwd
			if (parentCwd === undefined) {
				throw new Error(`${prefix}: 父会话没有工作目录，无法为子进程确定 cwd`)
			}
			return startHarnessRun(harness, request, {
				executable,
				cwd: k.resolveChildCwd(prefix, undefined, parentCwd),
				env: {},
				spawn: (spec) => ctx.subprocess.spawn(spec),
				onError: (error, stopReason) => {
					ctx.logger?.warn?.(`${prefix}: 子运行失败（${stopReason}）：${error.message}`)
				}
			})
		}
	}
}

/**
 * 上一次探测的结果。`harnessReport()` 读它 —— 宿主的 `info` 级日志不落盘，没有这个
 * 快照就没法从外部确认「探到了什么、注册了几个」，只能靠在会话里试一次委派。
 */
let lastReport = { probedAt: 0, entries: [] }

/**
 * 读上一次 harness 探测快照。
 * @returns 探测时刻与每个 harness 的状态。
 */
export function harnessReport() {
	return lastReport
}

/**
 * 探测本机 harness 并把探到的注册成子代理提供方。
 *
 * 在 `apply` 里以**局部注入**调用：`subagents` / `subprocess` 缺席时整段跳过，不影响
 * 本插件的余额与模型发现。探测是一次性的 —— 这些 CLI 装完不会自己消失，装上之后重载
 * 插件（或重启 profile）即可被认出来。
 * @param ctx - 插件上下文（需带 subagents 与 subprocess）。
 * @returns 每个 harness 的探测与注册状态。
 */
export async function applyHarness(ctx) {
	const entries = []
	for (const harness of HARNESSES) {
		const entry = { id: harness.id, bin: harness.bin, displayName: harness.displayName, installed: false, executable: null, registered: false, note: '' }
		let executable
		try {
			executable = await ctx.subprocess.resolveExecutable(harness.bin, {}, undefined)
		} catch (error) {
			// 没装就是没装 —— 不注册，对应的 subagent_* 工具自然不会出现。
			entry.note = `未找到可执行文件（${error?.message ?? error}）`
			entries.push(entry)
			continue
		}
		if (typeof executable !== 'string' || executable.length === 0) {
			entry.note = '解析器返回了空路径'
			entries.push(entry)
			continue
		}
		entry.installed = true
		entry.executable = executable
		try {
			ctx.subagents.registerProvider(createProvider(ctx, harness, executable))
			entry.registered = true
			ctx.logger?.info?.(`dsh-llm-hub: 注册 harness 子代理 ${harness.id} → ${executable}`)
		} catch (error) {
			// 同名 provider 已被别的插件占了（例如官方的 dsh-subagent-codex）——
			// 让先到的赢，只记一行，不抢。
			entry.note = `提供方已存在，跳过（${error?.message ?? error}）`
			ctx.logger?.info?.(`dsh-llm-hub: ${harness.id} ${entry.note}`)
		}
		entries.push(entry)
	}
	const registered = entries.filter((entry) => entry.registered).map((entry) => entry.id)
	if (registered.length === 0) {
		ctx.logger?.info?.('dsh-llm-hub: 未注册任何 harness 子代理（本机没装，或提供方已被占用）')
	}
	lastReport = { probedAt: Date.now(), entries }
	return entries
}

/** 供测试与 client 半复用的 harness 清单（只读）。 */
export const HARNESS_CATALOG = HARNESSES.map(({ id, bin, displayName }) => ({ id, bin, displayName }))

/** 供测试复用的 harness 定义（含 args 组装器）。 */
export const HARNESS_DEFINITIONS = HARNESSES
