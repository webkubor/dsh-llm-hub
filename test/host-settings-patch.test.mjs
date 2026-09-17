/**
 * host 半「settings patch — modelgo 空列表自动写回目录」的回归测试。
 *
 * 钉住三件事：① `models: []` 的 pi-ai provider 应被 plugin 启动时拉一份目录写回；
 * ② 用户已显式填的 models 不被覆盖；③ fetch 失败 / 缺 baseURL 时 best-effort 跳过。
 *
 * 零依赖：只用 node:test + node:assert。复用 host-availability 的 helper 模式 + 加可写 settings 桩。
 *
 * @module dsh-llm-hub/test/host-settings-patch
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

afterEach(() => {
	delete globalThis.fetch
})

/**
 * 造一个可写的 settings service + 完整 host ctx。
 *
 * - settingsService 是真 store：get 走 sections、update 合并 sections、onChange 注册 listener。
 * - inject 模拟 cordis 真实签名：cordis 调 `cb(ctx, config)`（不是 `(settingsCtx, ...)`），所以测试里 cb 第一参数就是 host.ctx。
 * - boot 把 host.ctx + settings 段（sections）传给 apply。
 */
function createHost({ sections = {}, settingsFail = false } = {}) {
	const state = {
		sections: structuredClone(sections),
		updates: [],
		listeners: []
	}
	const settingsService = {
		get: (ns) => state.sections[ns],
		update: async (ns, payload) => {
			if (settingsFail) throw new Error('settings update forced to fail')
			state.updates.push({ ns, payload })
			state.sections[ns] = { ...state.sections[ns], ...payload }
			for (const l of state.listeners) {
				if (l.ns === ns) await l.cb()
			}
		},
		onChange: (ns, cb) => {
			state.listeners.push({ ns, cb })
		}
	}
	const ctx = {
		llm: {
			listProviders: () => [],
			registerModelDiscovery: () => () => {}
		},
		webServer: { register: () => () => {} },
		logger: { warn: () => {}, info: () => {} },
		get: (name) => {
			if (name === 'settings') return settingsService
			if (name === 'llm') return ctx.llm
			return undefined
		},
		on: () => () => {},
		emit: () => {},
		effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
		// cordis 真传：inject 的 cb 只收一个新 fiber ctx，cordis 会在那个 ctx 上挂
		// `.settings` 属性（service intercept）。plugin 里写的是 `settingsCtx.settings.get(NS)`，
		// 所以 settingsCtx 必须带 .settings。
		inject: (_deps, cb) => {
			const settingsCtx = { settings: settingsService }
			setImmediate(() => {
				try { cb(settingsCtx, sections) } catch (e) { /* swallow */ }
			})
		}
	}
	return { ctx, settingsService, state }
}

/**
 * 装好插件（apply 会通过 inject 触发 settings patch）。
 * 等待 patch 跑完（cordis 是 fiber-schedule，inject 的 cb 在 setImmediate 里）。
 */
async function boot(sections) {
	const mod = await import('../lib/index.js')
	const host = createHost({ sections })
	mod.apply(host.ctx)
	// 等 patch 跑完：最多 1 秒，每轮一个 setImmediate 让 cordis fiber tick
	const start = Date.now()
	while (host.state.updates.length === 0 && Date.now() - start < 1000) {
		await new Promise((r) => setImmediate(r))
	}
	// 再等一下让 update 内的 listeners await 完
	await new Promise((r) => setImmediate(r))
	return host
}

test('models: [] → 写回 fetch /models 的结果', async () => {
	const fetchUrls = []
	globalThis.fetch = async (url) => {
		fetchUrls.push(url)
		return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), {
			status: 200, headers: { 'content-type': 'application/json' }
		})
	}
	const host = await boot({
		'llm-pi-ai': {
			providers: {
				modelgo: {
					displayName: 'modelgo',
					apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
					api: 'anthropic-messages',
					baseURL: 'https://api.modelgo.com',
					models: []
				}
			}
		}
	})
	assert.equal(host.state.updates.length, 1, '应触发一次 settings.update')
	assert.deepEqual(
		host.state.sections['llm-pi-ai'].providers.modelgo.models.map((m) => m.id),
		['a', 'b'],
		'models 应被写回为网关返回的 id 列表'
	)
	assert.ok(fetchUrls.some((u) => u === 'https://api.modelgo.com/models'), '应请求 modelgo 网关的 /models')
})

test('models: [a, b]（用户已显式配置）→ 不写回', async () => {
	let fetchCalls = 0
	globalThis.fetch = async () => { fetchCalls += 1; return new Response('{}', { status: 200 }) }
	const host = await boot({
		'llm-pi-ai': {
			providers: {
				modelgo: {
					displayName: 'modelgo',
					apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
					api: 'anthropic-messages',
					baseURL: 'https://api.modelgo.com',
					models: [{ id: 'a' }, { id: 'b' }]
				}
			}
		}
	})
	assert.equal(fetchCalls, 0, 'models 长度 > 0 不应 fetch')
	assert.deepEqual(
		host.state.sections['llm-pi-ai'].providers.modelgo.models.map((m) => m.id),
		['a', 'b'],
		'应保持原样不被覆盖'
	)
	assert.equal(host.state.updates.length, 0, '不应触发 settings.update')
})

test('models: [] 且 baseURL 缺失 → 跳过，不报错', async () => {
	let fetchCalls = 0
	globalThis.fetch = async () => { fetchCalls += 1; return new Response('{}', { status: 200 }) }
	const host = await boot({
		'llm-pi-ai': {
			providers: {
				modelgo: {
					displayName: 'modelgo',
					apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
					models: []
					// baseURL 缺失
				}
			}
		}
	})
	assert.equal(fetchCalls, 0, 'baseURL 缺失不应 fetch')
	assert.deepEqual(host.state.sections['llm-pi-ai'].providers.modelgo.models, [])
	assert.equal(host.state.updates.length, 0, '不应触发 settings.update')
})

test('models: [] 且 fetch 失败 → best-effort 跳过', async () => {
	globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED') }
	const host = await boot({
		'llm-pi-ai': {
			providers: {
				modelgo: {
					displayName: 'modelgo',
					apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
					baseURL: 'https://api.modelgo.com',
					models: []
				}
			}
		}
	})
	assert.equal(host.state.updates.length, 0, 'fetch 失败不应写回')
	assert.deepEqual(host.state.sections['llm-pi-ai'].providers.modelgo.models, [])
})

test('TOCTOU 防护：fetch 期间用户填了 models，写入时被过滤掉', async () => {
	// 模拟"plugin 启动 → 读到空 models → 拉到目录 → 准备 settings.update →
	// 此时用户在外面编辑 settings.yaml 填上了 models → 不应该被覆盖"。
	const host = createHost({})
	host.state.sections['llm-pi-ai'] = {
		providers: {
			modelgo: {
				displayName: 'modelgo',
				apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
				baseURL: 'https://api.modelgo.com',
				models: []
			}
		}
	}
	// fetch hook：在 mock fetch 内部同步把 sections 改成用户手填的样子
	globalThis.fetch = async () => {
		host.state.sections['llm-pi-ai'].providers.modelgo.models = [{ id: 'user-edited' }]
		return new Response(JSON.stringify({ data: [{ id: 'fetched-a' }] }), { status: 200 })
	}
	const mod = await import('../lib/index.js')
	mod.apply(host.ctx)

	// 等 plugin 走完 boot patch
	const start = Date.now()
	while (host.state.updates.length === 0 && Date.now() - start < 1000) {
		await new Promise((r) => setImmediate(r))
	}
	await new Promise((r) => setImmediate(r))

	// settings.update 应该已经把 'modelgo' 写回，但 TOCTOU 防护应把它过滤掉
	const writtenPayload = host.state.updates[0]?.payload
	if (writtenPayload) {
		assert.equal(
			Object.keys(writtenPayload.providers ?? {}).length,
			0,
			'写入的 providers 应为空：用户在 fetch 期间填的 models 应保留，不被 fetch 结果覆盖'
		)
	}
	// 用户填的 models 必须保留
	assert.deepEqual(
		host.state.sections['llm-pi-ai'].providers.modelgo.models,
		[{ id: 'user-edited' }],
		'用户手填的 models 应保留'
	)
})

test('apply 启动 patch：modelgo 空列表自动写回 settings', async () => {
	globalThis.fetch = async (url) => {
		if (url !== 'https://api.modelgo.com/models') throw new Error('unexpected fetch: ' + url)
		return new Response(JSON.stringify({ data: [{ id: 'a' }] }), {
			status: 200, headers: { 'content-type': 'application/json' }
		})
	}
	const host = await boot({
		'llm-pi-ai': {
			providers: {
				modelgo: {
					displayName: 'modelgo',
					apiKeyEnv: 'MODELGO_GATEWAY_API_KEY',
					baseURL: 'https://api.modelgo.com',
					models: []
				}
			}
		}
	})
	assert.equal(host.state.sections['llm-pi-ai'].providers.modelgo.models.length, 1, 'boot 后 modelgo.models 应有 1 项')
	assert.equal(host.state.sections['llm-pi-ai'].providers.modelgo.models[0].id, 'a')
})
