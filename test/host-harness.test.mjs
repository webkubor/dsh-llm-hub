/**
 * host 半「harness 子代理」的回归测试。
 *
 * 零依赖：只用 node:test + node:assert，与本包其余测试一致。
 *
 * 这些用例不测「能不能跑通 codex」（那要真的花钱调模型），测的是**判定与组装**——
 * 三条链路每一条坏掉都不会有编译错误，只会让人在会话里看到「工具不见了」或者
 * 「子代理说它做完了但什么也没做」：
 *
 *   1. 探测 → 注册：没装的不能注册，装了的必须注册（工具的有无完全由此决定）
 *   2. argv 组装：少一个 flag 就整类任务静默失败（agy 的权限坑就是这么来的）
 *   3. 退出折算：exit 0 + 空输出**必须**报错，不能报成功
 *
 * @module dsh-llm-hub/test/host-harness
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HARNESS_CATALOG, HARNESS_DEFINITIONS, applyHarness, createProvider, harnessArgv, harnessReport, printOutcome, textTask } from '../lib/harness.js'

/**
 * 从 applyHarness 的报告里取出真正注册成功的 id。
 * @param entries - applyHarness 的返回值。
 * @returns 已注册的 harness id。
 */
function registeredIds(entries) {
	return entries.filter((entry) => entry.registered).map((entry) => entry.id)
}

/**
 * 造一个够真的 host 上下文。
 *
 * 只实现 harness 段真正碰的面：`subprocess.resolveExecutable`（按 installed 集合
 * 决定找不找得到）、`subagents.registerProvider`（收集注册结果）、`logger`。
 * @param options - installed（装了哪些 bin）、registerFails（注册时抛错的 id 集合）。
 * @returns 上下文与观察点。
 */
function createHost(options = {}) {
	const installed = new Set(options.installed ?? [])
	const registerFails = new Set(options.registerFails ?? [])
	const registered = []
	const logs = []
	const ctx = {
		subprocess: {
			async resolveExecutable(bin) {
				if (!installed.has(bin)) throw new Error(`not found: ${bin}`)
				return `/fake/bin/${bin}`
			},
			spawn() { throw new Error('本用例不应真的 spawn') }
		},
		subagents: {
			registerProvider(provider) {
				if (registerFails.has(provider.name)) throw new Error(`duplicate provider: ${provider.name}`)
				registered.push(provider)
			}
		},
		logger: {
			info: (message) => logs.push(['info', message]),
			warn: (message) => logs.push(['warn', message])
		}
	}
	return { ctx, registered, logs }
}

// ── 探测 → 注册 ─────────────────────────────────────────────────────────────

test('一个都没装 → 一个都不注册（工具因此不会出现）', async () => {
	// 这是本功能对外分发的**唯一**安全保证：别人机器上没有这些 CLI 时，
	// 既不能注册 provider，也不能抛错把宿主启动带崩。
	const { ctx, registered, logs } = createHost({ installed: [] })
	const entries = await applyHarness(ctx)
	assert.deepEqual(registeredIds(entries), [])
	assert.equal(registered.length, 0)
	// 三个都要如实报告「没装」，而不是从报告里消失 —— UI 要能显示「装了它就能用」。
	assert.equal(entries.length, 3)
	for (const entry of entries) {
		assert.equal(entry.installed, false)
		assert.equal(entry.executable, null)
		assert.ok(entry.note.length > 0, '没装必须写明原因')
	}
	assert.ok(logs.some(([, message]) => message.includes('未注册任何')), '应该留一条「没注册」的日志')
})

test('三个都装了 → 注册三个，provider 名字就是 harness id', async () => {
	const { ctx, registered } = createHost({ installed: ['codex', 'claude', 'agy'] })
	const entries = await applyHarness(ctx)
	assert.deepEqual(registeredIds(entries), ['codex', 'claude-code', 'antigravity'])
	assert.deepEqual(registered.map((provider) => provider.name), ['codex', 'claude-code', 'antigravity'])
	for (const entry of entries) assert.match(entry.executable, /^\/fake\/bin\//)
})

test('只装了一个 → 只注册那一个（部分安装是常态，不是异常）', async () => {
	const { ctx, registered } = createHost({ installed: ['agy'] })
	const entries = await applyHarness(ctx)
	assert.deepEqual(registeredIds(entries), ['antigravity'])
	assert.equal(registered.length, 1)
})

test('同名 provider 已被别的插件占了 → 跳过，不抛（官方 bundle 共存）', async () => {
	// 用户可能同时装着官方的 dsh-subagent-codex。先到的赢，我们只记一行，
	// 而且**不能**因此中断剩下两个的注册。
	const { ctx, registered, logs } = createHost({ installed: ['codex', 'claude', 'agy'], registerFails: ['codex'] })
	const entries = await applyHarness(ctx)
	assert.deepEqual(registeredIds(entries), ['claude-code', 'antigravity'], 'codex 被占，另两个仍须注册')
	assert.equal(registered.length, 2)
	// 被占的那个要报告成「装了但没注册」，而不是「没装」—— 两者的处置完全不同。
	const codex = entries.find((entry) => entry.id === 'codex')
	assert.equal(codex.installed, true)
	assert.equal(codex.registered, false)
	assert.ok(codex.note.includes('已存在'))
	assert.ok(logs.some(([, message]) => message.includes('已存在')), '应该留一条「已存在」的日志')
})

test('provider 不声明任何 start 能力，也不继承父上下文', async () => {
	// 子进程在另一个运行时里，父侧的 persona / 工具过滤 / 深度上限 / 结构化输出
	// 都管不到它。声明了就等于「接了再悄悄忽略」，内核要靠这个如实声明去拒请求。
	const { ctx } = createHost({ installed: ['codex'] })
	const provider = createProvider(ctx, HARNESS_DEFINITIONS[0], '/fake/bin/codex')
	assert.equal(provider.inheritsParentContext, false)
	for (const [key, value] of Object.entries(provider.capabilities)) {
		assert.equal(value, false, `capabilities.${key} 必须是 false`)
	}
})

// ── argv 组装 ───────────────────────────────────────────────────────────────

test('codex 带 --skip-git-repo-check（父 cwd 不一定是 git 仓库）', () => {
	const codex = HARNESS_DEFINITIONS.find((harness) => harness.id === 'codex')
	const argv = harnessArgv(codex, '/fake/bin/codex', '干活')
	assert.deepEqual(argv, ['/fake/bin/codex', 'exec', '--skip-git-repo-check', '干活'])
})

test('claude 走 -p，任务是最后一个位置参数', () => {
	const claude = HARNESS_DEFINITIONS.find((harness) => harness.id === 'claude-code')
	assert.deepEqual(harnessArgv(claude, '/fake/bin/claude', '干活'), ['/fake/bin/claude', '-p', '干活'])
})

test('agy 必须带 --dangerously-skip-permissions，否则整类任务静默失败', () => {
	// 2026-09-17 实测：headless print 模式下 agy 自动拒绝 `command` 权限，
	// 于是任何碰文件或命令的任务都 exit 0 且不打印任何东西。少这个 flag
	// 不会报错，只会让子代理"成功"地什么都没干 —— 所以钉住它。
	const agy = HARNESS_DEFINITIONS.find((harness) => harness.id === 'antigravity')
	const argv = harnessArgv(agy, '/fake/bin/agy', '干活')
	assert.ok(argv.includes('--dangerously-skip-permissions'), '缺这个 flag 会让 agy 静默空转')
	assert.ok(argv.includes('--print-timeout'), 'print 模式必须给超时上界')
})

test('任务文本由 text 块拼成，非文本块丢弃', () => {
	const task = textTask([
		{ type: 'text', text: '第一段' },
		{ type: 'image', data: 'xxx' },
		{ type: 'text', text: '第二段' }
	])
	assert.equal(task, '第一段\n\n第二段')
})

// ── 退出折算 ────────────────────────────────────────────────────────────────

test('exit 0 且有输出 → completed，答案就是 stdout', () => {
	const result = printOutcome('p', 'codex', 0, 'PONG\n', '')
	assert.equal(result.stopReason, 'completed')
	assert.deepEqual(result.output, [{ type: 'text', text: 'PONG' }])
})

test('exit 0 但没有输出 → 必须抛，不能报成功', () => {
	// 这是 agy 权限坑的形状，也是最危险的一种：报成功的话父 agent 会拿着
	// 空答案往下走，还以为子代理干完了。
	assert.throws(() => printOutcome('p', 'agy', 0, '   \n', ''), /没有输出答案/)
})

test('exit 非 0 → 抛，并带上 stderr 尾巴作为诊断', () => {
	assert.throws(
		() => printOutcome('p', 'codex', 3, '', 'auth failed'),
		(error) => error.message.includes('以 3 退出') && error.message.includes('auth failed')
	)
})

test('被信号终止（exitCode 为 null）→ 抛，且说清是信号', () => {
	assert.throws(() => printOutcome('p', 'claude', null, '', ''), /被信号终止/)
})

test('ANSI 上色的输出被剥干净', () => {
	const result = printOutcome('p', 'codex', 0, '[32mPONG[0m\n', '')
	assert.deepEqual(result.output, [{ type: 'text', text: 'PONG' }])
})

// ── 目录 ────────────────────────────────────────────────────────────────────

test('对外清单与定义表一一对应，且不泄漏 args 组装器', () => {
	assert.equal(HARNESS_CATALOG.length, HARNESS_DEFINITIONS.length)
	for (const entry of HARNESS_CATALOG) {
		assert.deepEqual(Object.keys(entry).sort(), ['bin', 'displayName', 'id'])
	}
})

test('探测后快照可读（宿主 info 日志不落盘，自检路由靠它）', async () => {
	const { ctx } = createHost({ installed: ['agy'] })
	await applyHarness(ctx)
	const report = harnessReport()
	assert.ok(report.probedAt > 0, 'probedAt 必须落值，否则路由无法区分「没探」与「没装」')
	assert.deepEqual(report.entries.map((entry) => entry.id), ['codex', 'claude-code', 'antigravity'])
})
