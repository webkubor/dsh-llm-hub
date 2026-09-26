/**
 * host 半「模型下拉可用性」的回归测试。
 *
 * 零依赖：只用 node:test + node:assert，不引任何测试框架 —— 本包运行时零依赖，
 * 测试侧也不该为跑几条断言拉一棵依赖树。CI 里直接 `node --test test/`。
 *
 * 这些用例不是「补覆盖率」，每一条都钉住一个**真实踩过的坑**（见各 test 的注释）。
 * 判定逻辑链很长（凭据 → 探测 → 余额 → 运行期），任何一环退化都不会有编译错误，
 * 只会在某个用户的账号上静默地把能用的模型藏起来、或者把不能用的留在下拉里。
 *
 * @module dsh-llm-hub/test/host-availability
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

/** 每次 apply 前清干净，避免上一条用例的 env 泄漏。 */
const TOUCHED_ENV = ['DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'ZAI_CODING_CN_API_KEY', 'MODELGO_API_KEY', 'MOONSHOT_API_KEY']

afterEach(() => {
	for (const key of TOUCHED_ENV) delete process.env[key]
})

/**
 * 造一个足够真的 host 上下文。
 *
 * 只实现插件真正碰的那几个面：`get`（settings / llm / credentials）、`on`、`emit`、
 * `effect`、`webServer.register`、`logger.warn`。路由处理器被收集起来，测试直接调用，
 * 不经过 HTTP —— 这里要测的是判定，不是 node:http。
 * @param options - providers 配置、llm 服务的包装方式、fetch 桩。
 * @returns 上下文与几个观察点。
 */
function createHost(options = {}) {
	// `deepseek: false` 让只想测 pi-ai 的用例把官方直连段关掉 —— 否则它也会被判定，
	// 把 hidden 与 listProviders 搅进无关的条目，断言就说不清在测谁。
	const sections = {
		...(options.deepseek === false ? {} : { 'llm-deepseek': { displayName: 'DeepSeek 官方直连', apiKeyEnv: 'DEEPSEEK_API_KEY' } }),
		'llm-pi-ai': { providers: options.providers ?? {} },
		...(options.sections ?? {})
	}
	const routes = new Map()
	const listeners = new Map()
	const emitted = []
	const warnings = []
	const disposers = []

	let llm = {
		listProviders: () => options.routes ?? [],
		registerModelDiscovery: () => () => {}
	}
	if (options.wrapLlm !== undefined) llm = options.wrapLlm(llm)

	const webServer = { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } }
	const ctx = {
		// 插件同时用属性访问（ctx.llm.xxx）与 ctx.get('llm')：cordis 两者都是正路，
		// 桩必须都给，否则测的不是真实调用形态。
		llm,
		webServer,
		logger: { warn: (message) => warnings.push(String(message)), info: () => {} },
		inject: () => {},
		get: (name) => {
			if (name === 'settings') return { get: (ns) => sections[ns] }
			if (name === 'llm') return llm
			return undefined
		},
		on: (event, fn, opts) => {
			listeners.set(event, { fn, opts })
			return () => listeners.delete(event)
		},
		emit: (event) => emitted.push(event),
		effect: (fn) => {
			const dispose = fn()
			if (typeof dispose === 'function') disposers.push(dispose)
			return () => {}
		},
	}

	/** 调一条已注册路由，解析出 JSON。 */
	const call = async (path, method = 'GET') => {
		const handler = routes.get(path)
		assert.ok(handler, `路由未注册: ${path}`)
		let status = 0
		let body = ''
		await handler({ method, url: path, headers: {} }, {
			writeHead: (code) => { status = code },
			end: (payload) => { body = payload ?? '' }
		})
		return { status, body: body === '' ? null : JSON.parse(body) }
	}

	return { ctx, routes, listeners, emitted, warnings, call, getLlm: () => llm, dispose: () => disposers.forEach((fn) => fn()) }
}

/** 一个 JSON 响应（用真的 Response，好让 readBounded 能读流）。 */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 常用 provider 夹具。 */
const PIAI_PROVIDERS = (overrides = {}) => ({
	minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', api: 'openai-completions', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'MiniMax-M3' }] },
	modelgo: { displayName: 'ModelGo 中转', apiKeyEnv: 'MODELGO_API_KEY_DEAD_DO_NOT_USE', api: 'anthropic-messages', baseURL: 'https://api.modelgo.com', models: [{ id: 'gpt-6-astra' }] },
	...overrides
})

/**
 * 装好插件、跑一轮**强制**全量探测，返回观察点。
 * 用 recheck（force）而不是等初始探针的 1.5s 定时器，测试才是确定性的。
 */
async function boot(t, options) {
	const mod = await import('../lib/index.js')
	const host = createHost(options)
	t.after(() => host.dispose())
	mod.apply(host.ctx)
	const payload = options?.probe === false ? null : (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	return { ...host, payload }
}

/** 从 payload 里取某 provider 的判定。 */
const verdictOf = (payload, provider) => payload.providers.find((entry) => entry.provider === provider)

test('凭据解析不到 → 判不可用，并从 llm.listProviders() 里摘掉', async (t) => {
	process.env.MINIMAX_API_KEY = 'mm-live'
	const routes = [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'minimax', name: 'MiniMax' }, { id: 'modelgo', name: 'ModelGo 中转' }]
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('minimaxi.com') && u.includes('/models')) return json({ data: [{ id: 'MiniMax-M3' }] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [{ model_name: 'M3', current_interval_remaining_percent: 80 }] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, { providers: PIAI_PROVIDERS(), routes, deepseek: false })

	const modelgo = verdictOf(host.payload, 'modelgo')
	assert.equal(modelgo.state, 'unavailable')
	assert.equal(modelgo.code, 'CREDENTIAL_MISSING')
	assert.match(modelgo.reason, /MODELGO_API_KEY_DEAD_DO_NOT_USE/)
	assert.deepEqual(host.payload.hidden, ['modelgo'])
	// 关键：过滤真的作用在服务上（composer、/model 弹窗、子代理都读它）
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['deepseek-official', 'minimax'])
})

test('网关 401/403 → AUTH_REJECTED（key 失效）', async (t) => {
	process.env.MODELGO_API_KEY = 'sk-dead'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('modelgo.com')) return json({ error: 'unauthorized' }, 401)
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: { modelgo: { displayName: 'ModelGo', apiKeyEnv: 'MODELGO_API_KEY', api: 'anthropic-messages', baseURL: 'https://api.modelgo.com', models: [{ id: 'x' }] } },
		routes: [{ id: 'modelgo' }],
		deepseek: false
	})
	const verdict = verdictOf(host.payload, 'modelgo')
	assert.equal(verdict.state, 'unavailable')
	assert.equal(verdict.code, 'AUTH_REJECTED')
	assert.equal(verdict.source, 'probe')
	assert.deepEqual(host.getLlm().listProviders(), [])
})

test('网关 402 → PAYMENT_REQUIRED（欠费）', async (t) => {
	process.env.MODELGO_API_KEY = 'sk-broke'
	globalThis.fetch = async (url) => {
		if (String(url).includes('modelgo.com')) return json({ error: 'payment required' }, 402)
		throw new Error(`不该请求: ${url}`)
	}
	const host = await boot(t, {
		providers: { modelgo: { displayName: 'ModelGo', apiKeyEnv: 'MODELGO_API_KEY', baseURL: 'https://api.modelgo.com', models: [{ id: 'x' }] } },
		routes: [{ id: 'modelgo' }],
		deepseek: false
	})
	assert.equal(verdictOf(host.payload, 'modelgo').code, 'PAYMENT_REQUIRED')
})

test('现金余额为 0 → BALANCE_EMPTY', async (t) => {
	process.env.MOONSHOT_API_KEY = 'ms-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('moonshot.cn') && u.includes('/models')) return json({ data: [{ id: 'kimi-k3' }] })
		if (u.includes('/v1/users/me/balance')) return json({ data: { total_balance: '0.00' } })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: { moonshot: { displayName: 'Moonshot', apiKeyEnv: 'MOONSHOT_API_KEY', baseURL: 'https://api.moonshot.cn/v1', models: [{ id: 'kimi-k3' }] } },
		routes: [{ id: 'moonshot' }],
		deepseek: false
	})
	const verdict = verdictOf(host.payload, 'moonshot')
	assert.equal(verdict.state, 'unavailable')
	assert.equal(verdict.code, 'BALANCE_EMPTY')
})

test('配额「余量 0%」→ QUOTA_EXHAUSTED（0 不能被当成没填，且不抹除下拉）', async (t) => {
	// 回归：共用的 capacity() 只认正数，MiniMax 的 current_interval_remaining_percent: 0
	// 被当成缺字段丢掉。且 5 小时限额耗尽属于临时状态，绝不能从下拉框抹除导致死锁。
	process.env.MINIMAX_API_KEY = 'mm-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('minimaxi.com') && u.includes('/models')) return json({ data: [{ id: 'MiniMax-M3' }] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [{ model_name: 'M3', current_interval_remaining_percent: 0, current_weekly_remaining_percent: 40 }] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: { minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'MiniMax-M3' }] } },
		routes: [{ id: 'minimax' }],
		deepseek: false
	})
	const verdict = verdictOf(host.payload, 'minimax')
	assert.equal(verdict.state, 'unavailable')
	assert.equal(verdict.code, 'QUOTA_EXHAUSTED')
	assert.deepEqual(host.payload.hidden, [], '配额耗尽属于临时限额状态，绝不能进 hidden 抹除下拉')
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['minimax'], '配额耗尽的 provider 依然保留在下拉列表中供用户查看与恢复')
})

test('配额「已用 100%」→ QUOTA_EXHAUSTED（used 语义方向相反，且不抹除下拉）', async (t) => {
	process.env.ZAI_CODING_CN_API_KEY = 'zai-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('open.bigmodel.cn') && u.includes('/models')) return json({ data: [{ id: 'glm-5.3' }] })
		if (u.includes('quota/limit')) return json({ data: { limits: [{ type: 'TOKENS_LIMIT', unit: 3, percentage: 100 }] } })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: { 'zai-coding-cn': { displayName: '智谱 GLM', apiKeyEnv: 'ZAI_CODING_CN_API_KEY', models: [{ id: 'glm-5.3' }] } },
		routes: [{ id: 'zai-coding-cn' }],
		deepseek: false
	})
	assert.equal(verdictOf(host.payload, 'zai-coding-cn').code, 'QUOTA_EXHAUSTED')
	assert.deepEqual(host.payload.hidden, [], '临时配额用尽不从下拉中抹除')
})

test('探测没结论（404 / 连不上）→ 一律保留（fail-open）', async (t) => {
	process.env.MODELGO_API_KEY = 'sk-live'
	globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED') }
	const host = await boot(t, {
		providers: { modelgo: { displayName: 'ModelGo', apiKeyEnv: 'MODELGO_API_KEY', baseURL: 'https://api.modelgo.com', models: [{ id: 'x' }] } },
		routes: [{ id: 'modelgo' }],
		deepseek: false
	})
	const verdict = verdictOf(host.payload, 'modelgo')
	assert.equal(verdict.state, 'unknown', '拿不准就该是 unknown')
	assert.deepEqual(host.payload.hidden, [], 'unknown 绝不能进 hidden')
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['modelgo'], 'unknown 的 provider 仍在下拉里')
})

test('被隐藏后仍会被重探 → 能恢复（「隐藏即永久」回归）', async (t) => {
	// 回归：判定目标曾取自 llm.listProviders()，而那正是过滤器的输出 ——
	// 一旦隐藏就再也不会进入下一轮探测，充值/换 key 之后永远不恢复。
	delete process.env.MINIMAX_API_KEY
	let reachable = true
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('minimaxi.com') && u.includes('/models')) {
			if (!reachable) throw new Error('gateway down')
			return json({ data: [{ id: 'MiniMax-M3' }] })
		}
		if (u.includes('token_plan/remains')) return json({ model_remains: [] })
		throw new Error(`不该请求: ${u}`)
	}
	const mod = await import('../lib/index.js')
	const host = createHost({
		providers: { minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'MiniMax-M3' }] } },
		routes: [{ id: 'minimax' }],
		deepseek: false
	})
	t.after(() => host.dispose())
	mod.apply(host.ctx)

	const first = (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	assert.equal(verdictOf(first, 'minimax').state, 'unavailable')
	assert.deepEqual(host.getLlm().listProviders(), [], '已隐藏')

	// 人把 key 配好了 → 下一轮重探必须**仍然包含**这个已隐藏的 provider
	process.env.MINIMAX_API_KEY = 'mm-new'
	const second = (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	assert.equal(verdictOf(second, 'minimax').state, 'available', '换好 key 后必须恢复')
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['minimax'])
	assert.equal(reachable, true)
})

test('MiniMax 5小时限额用尽（QUOTA_EXHAUSTED）不抹除下拉，配额重置后重探恢复', async (t) => {
	process.env.MINIMAX_API_KEY = 'mm-live'
	let percent = 0
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('minimaxi.com') && u.includes('/models')) return json({ data: [{ id: 'MiniMax-M3' }] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [{ model_name: 'M3', current_interval_remaining_percent: percent, current_weekly_remaining_percent: 80 }] })
		throw new Error(`不该请求: ${u}`)
	}
	const mod = await import('../lib/index.js')
	const host = createHost({
		providers: { minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'MiniMax-M3' }] } },
		routes: [{ id: 'minimax' }],
		deepseek: false
	})
	t.after(() => host.dispose())
	mod.apply(host.ctx)

	// 1) 5 小时配额耗尽（0%）
	const first = (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	assert.equal(verdictOf(first, 'minimax').state, 'unavailable')
	assert.equal(verdictOf(first, 'minimax').code, 'QUOTA_EXHAUSTED')
	assert.deepEqual(first.hidden, [], '配额耗尽不加入 hidden')
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['minimax'], '下拉菜单依然保留 MiniMax，不死锁')

	// 2) 5 小时过后服务端配额重置（100%）
	percent = 100
	const second = (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	assert.equal(verdictOf(second, 'minimax').state, 'available', '配额恢复后状态变绿')
	assert.equal(verdictOf(second, 'minimax').code, 'OK')
	assert.deepEqual(host.getLlm().listProviders().map((p) => p.id), ['minimax'])
})

test('隐藏集合变化时广播 llm/adapters-updated（客户端靠它重拉目录）', async (t) => {
	delete process.env.MINIMAX_API_KEY
	globalThis.fetch = async () => { throw new Error('不该请求') }
	const host = await boot(t, {
		providers: { minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', models: [{ id: 'x' }] } },
		routes: [{ id: 'minimax' }],
		deepseek: false
	})
	assert.ok(host.emitted.includes('llm/adapters-updated'), '判定变化必须通知客户端')
	assert.equal(host.emitted.filter((e) => e === 'llm/adapters-updated').length, 1, '同一份集合只广播一次')
})

test('刻意不监听 llm/adapters-updated（自己的广播不该把自己的缓存打回未探）', async (t) => {
	// 回归：曾同时 emit 又监听这个事件 —— 每次隐藏集合变化都会让判定缓存自失效，
	// 白白多探一轮；网关卡顿时会变成来回弹。
	globalThis.fetch = async () => { throw new Error('不该请求') }
	const host = await boot(t, { providers: {}, routes: [] })
	assert.equal(host.listeners.has('llm/adapters-updated'), false)
})

test('listProviders 被代理包装时也能装上过滤器（!== 假阴性回归）', async (t) => {
	// 回归：曾用 `service.listProviders !== filtered` 校验「写进去了没有」。
	// cordis 的服务访问是 traceable 代理，每次读方法都返回新的包装对象，永远不相等 ——
	// 于是把自己误判成「赋值未生效」，顺带清掉探针用的未过滤表。
	const raw = { listProviders: () => [{ id: 'minimax' }, { id: 'modelgo' }], registerModelDiscovery: () => () => {} }
	const wrapped = new Proxy(raw, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver)
			return typeof value === 'function' ? (...args) => value.apply(receiver, args) : value
		}
	})
	process.env.MINIMAX_API_KEY = 'mm-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('minimaxi.com') && u.includes('/models')) return json({ data: [{ id: 'MiniMax-M3' }] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: {
			minimax: { displayName: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY', baseURL: 'https://api.minimaxi.com/v1', models: [{ id: 'MiniMax-M3' }] },
			modelgo: { displayName: 'ModelGo', apiKeyEnv: 'MODELGO_API_KEY_DEAD_DO_NOT_USE', baseURL: 'https://api.modelgo.com', models: [{ id: 'x' }] }
		},
		routes: [],
		deepseek: false,
		wrapLlm: () => wrapped
	})
	assert.deepEqual(host.warnings, [], '不该出现「赋值未生效」的误判')
	// 代理包装下过滤器仍然生效：可用的留下、不可用的摘掉
	assert.deepEqual(wrapped.listProviders().map((p) => p.id), ['minimax'], '过滤器必须真的生效')
})

test('运行期遥测：鉴权失败即隐藏，真实请求成功即恢复', async (t) => {
	process.env.DEEPSEEK_API_KEY = 'sk-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('deepseek.com/models')) return json({ data: [{ id: 'deepseek-flash' }] })
		if (u.includes('/user/balance')) return json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88' }] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, { providers: {}, routes: [{ id: 'deepseek-official', name: 'DeepSeek' }] })
	assert.equal(verdictOf(host.payload, 'deepseek-official').state, 'available')

	// 1) 一次真实请求因鉴权失败（401/403）—— 隐藏
	const onError = host.listeners.get('agent/request-error').fn
	await onError({ provider: 'deepseek-official', failure: { code: 'INVALID_CREDENTIAL', status: 401 } }, () => Promise.resolve(undefined))
	const afterFailure = (await host.call('/api/dsh-llm-hub/availability')).body
	assert.equal(verdictOf(afterFailure, 'deepseek-official').state, 'unavailable')
	assert.equal(verdictOf(afterFailure, 'deepseek-official').source, 'runtime')
	assert.deepEqual(afterFailure.hidden, ['deepseek-official'])

	// 2) 随后一次真实请求成功 —— 立刻恢复，不必等 TTL、也不必手动重探
	const onStream = host.listeners.get('llm/stream').fn
	const stream = onStream({ provider: 'deepseek-official' }, () => (async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })())
	for await (const _chunk of stream) { /* 消费掉 */ }
	const afterSuccess = (await host.call('/api/dsh-llm-hub/availability')).body
	assert.equal(verdictOf(afterSuccess, 'deepseek-official').state, 'available', '成功即恢复')
	assert.deepEqual(afterSuccess.hidden, [])
})

test('非鉴权类失败（上下文超长）不触发隐藏', async (t) => {
	process.env.DEEPSEEK_API_KEY = 'sk-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('deepseek.com/models')) return json({ data: [] })
		if (u.includes('/user/balance')) return json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88' }] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, { providers: {}, routes: [{ id: 'deepseek-official' }] })
	const onError = host.listeners.get('agent/request-error').fn
	await onError({ provider: 'deepseek-official', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', status: 400 } }, () => Promise.resolve(undefined))
	const payload = (await host.call('/api/dsh-llm-hub/availability')).body
	assert.equal(verdictOf(payload, 'deepseek-official').state, 'available')
})

test('availability 只读路由：非 GET 405，跨站 403', async (t) => {
	globalThis.fetch = async () => { throw new Error('不该请求') }
	const host = await boot(t, { providers: {}, routes: [] })
	assert.equal((await host.call('/api/dsh-llm-hub/availability', 'POST')).status, 405)
	assert.equal((await host.call('/api/dsh-llm-hub/availability/recheck', 'GET')).status, 405)
})

test('listProviders 排序：套餐排在上面，按量付费排在下面', async (t) => {
	const routes = [
		{ id: 'deepseek-official', name: 'DeepSeek' },
		{ id: 'opencode-go', name: 'OpenCode Go' },
		{ id: 'modelgo', name: 'ModelGo 中转' }
	]
	const providers = {
		'opencode-go': { displayName: 'OpenCode Go', baseURL: 'https://opencode.ai/zen/go/v1' },
		modelgo: { displayName: 'ModelGo 中转', baseURL: 'https://api.modelgo.com' }
	}
	const host = await boot(t, { providers, routes, probe: false })
	const result = host.getLlm().listProviders().map((p) => p.id)
	assert.deepEqual(result, ['opencode-go', 'deepseek-official', 'modelgo'], '套餐必须优先排在前面')
})

