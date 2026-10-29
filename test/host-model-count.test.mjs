/**
 * host 半「探针结论必须带模型清单」的回归测试。
 *
 * 由来（2026-10-09 owner 报「可用模型显示是 0」）：
 * Hero 卡片的「可用模型」累加的是 availability 载荷里的 modelCount / modelIds，
 * 而那时的探针结论**只带 state/code/latencyMs**，模型清单只存在于另一个端点
 * （pi-ai/status）里 —— 生产端和 Hero 的消费端从来就没接上过。
 * 后果：累加恒为 0，Hero 渲染成破折号，而页面上其他数字都正常，看着像「配置没问题」。
 *
 * 所以这条用例钉的是**服务端产出的载荷形状**：每个 provider 的判定必须带
 * modelIds（去重前的原始 id 列表）与 modelCount（其长度）。
 * 少了任一个，Hero 就只能显示破折号 —— 而这正是 2026-10-09 那次的现象。
 *
 * @module dsh-llm-hub/test/host-model-count
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

const TOUCHED_ENV = ['DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'ZAI_CODING_CN_API_KEY', 'MODELGO_API_KEY', 'MOONSHOT_API_KEY']

afterEach(() => {
	for (const key of TOUCHED_ENV) delete process.env[key]
})

/**
 * 造一个足够真的 host 上下文（与 host-availability 同构，但只需要到能跑一轮全量探测）。
 * @param options - providers 配置、fetch 桩。
 */
function createHost(options = {}) {
	const sections = {
		'llm-pi-ai': { providers: options.providers ?? {} },
		...(options.sections ?? {})
	}
	const routes = new Map()
	const disposers = []
	const llm = { listProviders: () => options.routes ?? [], registerModelDiscovery: () => () => {} }
	const ctx = {
		llm,
		webServer: { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
		logger: { warn: () => {}, info: () => {} },
		inject: () => {},
		get: (name) => {
			if (name === 'settings') return {
				get: (ns) => sections[ns],
				describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value }))
			}
			if (name === 'llm') return llm
			return undefined
		},
		on: () => () => {},
		emit: () => {},
		effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return () => {} }
	}
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
	const hubConfig = {
		routing: { get: () => undefined },
		warning: { get: () => undefined },
		aliases: { get: () => undefined }
	}
	return { ctx, config: hubConfig, routes, call, dispose: () => disposers.forEach((fn) => fn()) }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 装好插件、跑一轮**强制**全量探测，返回载荷。 */
async function boot(t, options) {
	const mod = await import('../lib/index.js')
	const host = createHost(options)
	t.after(() => host.dispose())
	mod.apply(host.ctx, host.config)
	const payload = (await host.call('/api/dsh-llm-hub/availability/recheck', 'POST')).body
	return { ...host, payload }
}

const verdictOf = (payload, provider) => payload.providers.find((entry) => entry.provider === provider)

test('探针结论必须带 modelIds 与 modelCount —— 否则 Hero 只能显示破折号', async (t) => {
	process.env.MINIMAX_API_KEY = 'mm-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('/models')) return json({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M3.1-Flash-Preview' }] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: {
			minimax: {
				displayName: 'MiniMax',
				apiKeyEnv: 'MINIMAX_API_KEY',
				api: 'openai-completions',
				baseURL: 'https://api.minimaxi.com/v1',
				models: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M3.1-Flash-Preview' }]
			}
		},
		routes: [{ id: 'minimax' }]
	})
	const verdict = verdictOf(host.payload, 'minimax')
	assert.ok(verdict, '载荷里应有 minimax 的判定')
	// 这两条是 Hero 出数的唯一依据（client 侧见 lib/client.js 的 HeroOverviewCard）。
	assert.ok(Array.isArray(verdict.modelIds), '判定必须带 modelIds 数组，实际: ' + JSON.stringify(verdict))
	assert.ok(Array.isArray(verdict.modelIds) && verdict.modelIds.length > 0, 'modelIds 不能为空')
	assert.equal(typeof verdict.modelCount, 'number', '判定必须带数字 modelCount')
	assert.equal(verdict.modelCount, verdict.modelIds.length, 'modelCount 应等于 modelIds 的长度')
	assert.deepEqual(verdict.modelIds, ['MiniMax-M3', 'MiniMax-M3.1-Flash-Preview'], 'modelIds 应是设置段里配的模型 id')
})

test('modelIds 只收字符串 id —— 畸形条目不能把计数撑大', async (t) => {
	process.env.MINIMAX_API_KEY = 'mm-live'
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('/models')) return json({ data: [] })
		if (u.includes('token_plan/remains')) return json({ model_remains: [] })
		throw new Error(`不该请求: ${u}`)
	}
	const host = await boot(t, {
		providers: {
			minimax: {
				displayName: 'MiniMax',
				apiKeyEnv: 'MINIMAX_API_KEY',
				api: 'openai-completions',
				baseURL: 'https://api.minimaxi.com/v1',
				models: [{ id: 'ok-1' }, { id: 42 }, { nope: 'x' }, null, 'plain-string']
			}
		},
		routes: [{ id: 'minimax' }]
	})
	const verdict = verdictOf(host.payload, 'minimax')
	assert.deepEqual(verdict.modelIds, ['ok-1', 'plain-string'], '只应保留字符串 id')
	assert.equal(verdict.modelCount, 2, '计数应等于过滤后的长度')
})
