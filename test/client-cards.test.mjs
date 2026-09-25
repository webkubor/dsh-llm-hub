/**
 * client 半的回归测试：挂载点、卡片状态片、页脚重探，以及可用性缓存的两条在途链。
 *
 * client 半是 classic script（无顶层 import/export），靠 `window.__ModuleLoader__.load`
 * 注册且 React 由 `require('react')` 注入 —— 所以这里要自己搭最小的模块加载器与 React 桩。
 * 每个用例都**重新调一次 factory**（而不是复用上一次的 exports），这样用例之间没有共享状态。
 *
 * @module dsh-llm-hub/test/client-cards
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 包名从 package.json 读，不写死 —— 写死的那版正是没拦住 2026-09-17 那次 scope 迁移的原因 */
const PKG_NAME = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).name

/** 本文件里所有用例共用的「已注册的 client 插件定义」。 */
let pluginDefinition = null

// 搭好 window / document，再载入一次脚本，拿到 factory。
globalThis.window = { __ModuleLoader__: { load: (definition) => { pluginDefinition = definition } } }
globalThis.document = {
	getElementById: () => null,
	createElement: () => ({ textContent: '' }),
	head: { appendChild: () => {} }
}
await import('../lib/client.js')
assert.ok(pluginDefinition, 'client 脚本没有通过 window.__ModuleLoader__.load 注册')
// 断言的说法一直是对的，但期望值曾被写死成 'dsh-llm-hub' —— 包名迁到 @webkubor/ scope 时
// 只改了 package.json，这条断言反而变成了钉住旧名的锚，于是没拦住，直到 DSH 里报
// "loaded without registering ... via __ModuleLoader__.load" 才发现。
assert.equal(pluginDefinition.id, PKG_NAME, 'id 必须与 package.json 的 name 一致，否则 DSH 拒绝注册')

/**
 * 一份可控的 React 桩。
 *
 * `useState` 按**调用顺序**喂种子值：PiAiCard 与 HubFooter 的 hook 顺序是确定的，
 * 想跳过「还没加载完」的早返回，就必须能seed 出非空的首个状态。
 * `useSyncExternalStore` 直接返回当前的可用性快照 —— 测试要的是渲染结果，不是订阅机制。
 */
function createReact(seedValues) {
	// 用闭包变量而不是 this：桩里的 useState 是箭头函数，this 不指向这个对象字面量。
	let seed = seedValues ?? []
	let index = 0
	const noop = () => {}
	return {
		_reset(next) { seed = next ?? []; index = 0 },
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
		useState: (initial) => {
			// 按调用顺序喂种子：hook 顺序确定，想跳过「还没加载完」的早返回就得这样 seed。
			const seeded = seed[index]
			index += 1
			return [seeded !== undefined ? seeded : initial, noop]
		},
		useEffect: noop,
		useCallback: (fn) => fn,
		useMemo: (fn) => fn(),
		useRef: () => ({ current: null }),
		useId: () => 'test-id',
		// 卡片/页脚用它读可用性：桩直接返回注入的快照，机制本身不在这一层测。
		useSyncExternalStore: () => seedValues?.__availability ?? { providers: [], hidden: [] }
	}
}

/** 把渲染树摊平成一维，方便按 class / 文本查找。 */
const flatten = (node) => {
	if (node === null || node === undefined || node === false) return []
	if (Array.isArray(node)) return node.flatMap(flatten)
	if (typeof node !== 'object') return [node]
	return [node, ...flatten(node.children ?? [])]
}
const textsOf = (node) => flatten(node).filter((n) => typeof n === 'string')
const findByClass = (node, className) => flatten(node).find((n) => n && n.props && typeof n.props.className === 'string' && n.props.className.includes(className))

/**
 * 起一个插件实例，返回观察点。
 * @param options - providers 快照、seed 值、fetch 桩。
 */
function bootstrap(options = {}) {
	const availability = options.availability ?? { providers: [], hidden: [] }
	const react = createReact(options.seed)
	if (options.seed) options.seed.__availability = availability
	const slots = []
	const subscriptions = []
	const calls = []

	// 调用记录统一在桩里做，用例的 fetch 只负责应答 ——
	// 否则用例得在闭包里引用还没赋值的 `hub`，而 apply 期间的首次 load 就会踩到。
	globalThis.fetch = async (url, init) => {
		calls.push(`${init?.method ?? 'GET'} ${url}`)
		if (typeof options.fetch === 'function') return options.fetch(url, init)
		return { status: 200, json: async () => ({ ok: true, providers: [], hidden: [] }) }
	}

	const exports = pluginDefinition.factory((id) => {
		if (id === 'react') return react
		throw new Error(`测试没准备这个模块: ${id}`)
	})
	const ctx = {
		locale: { register: () => {}, bind: () => (key) => key },
		slots: {
			inject: (_name, register) => register(),
			register: (meta, component) => { slots.push({ ...meta, component }); return () => {} }
		},
		effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
		inject: (deps, callback) => {
			if (deps.includes('remote')) {
				callback({ remote: { $on: (event) => { subscriptions.push(event); return () => {} } } })
			}
		}
	}
	exports.apply(ctx)

	const footer = slots.find((slot) => slot.id === 'dsh-llm-hub-footer')
	const renderFooter = () => {
		react._reset(options.seed)
		return footer.component({ ...footer.inject() })
	}
	const renderPiai = (provider) => {
		const slot = slots.find((item) => item.key === 'llm-pi-ai')
		react._reset(options.seed)
		return slot.component({ ...slot.inject(), provider })
	}
	const renderHarness = () => {
		const slot = slots.find((item) => item.id === 'dsh-llm-hub-harness')
		react._reset(options.seed)
		return slot.component({ ...slot.inject() })
	}
	return {
		slots,
		subscriptions,
		calls,
		renderFooter,
		renderPiai,
		renderHarness,
		/** 直接拿可用性存储（页脚注入的就是它） */
		store: footer.inject().availability
	}
}

/** 一个 pi-ai 卡用的 status 快照（走完早返回所需的最小字段）。 */
const STATUS = {
	ok: true,
	provider: 'modelgo',
	displayName: 'ModelGo 中转',
	api: 'anthropic-messages',
	baseURL: 'https://api.modelgo.com',
	apiKeyEnv: 'MODELGO_API_KEY',
	keyConfigured: false,
	modelCount: 11,
	modelIds: ['gpt-6-astra'],
	balanceAdapter: null
}

test('挂载点：两张 provider 卡 + 页脚 + harness + 用量 + 健康看板 + 路由，且不再有逐条重述的可用性面板', () => {
	const hub = bootstrap()
	const mounted = hub.slots.map((slot) => `${slot.name}${slot.id ? '#' + slot.id : ''}${slot.key ? '@' + slot.key : ''}`)
	assert.deepEqual(mounted.sort(), [
		'settings.models.footer#dsh-llm-hub-footer',
		'settings.models.footer#dsh-llm-hub-harness',
		'settings.models.footer#dsh-llm-hub-health',
		'settings.models.footer#dsh-llm-hub-hero',
		'settings.models.footer#dsh-llm-hub-presets',
		'settings.models.footer#dsh-llm-hub-routing',
		'settings.models.footer#dsh-llm-hub-suite',
		'settings.models.footer#dsh-llm-hub-usage',
		'settings.models.provider-card@llm-deepseek',
		'settings.models.provider-card@llm-pi-ai'
	].sort())
	// footer 是 list slot，**八个**条目靠 id 区分、靠 order 排序（hero 60 / presets 65 / health 70 /
	// routing 75 / usage 80 / harness 90 / footer 100 / suite 110）。漏了 id 会被宿主静默丢弃 —— 接口通、组件在、页面上什么都没有。
	// **没有 keypool**：1.4.0 起按用户反馈删独立「多账号 key 轮换」卡 —— 多 key 走 `apiKeyEnv` 数组配置，
	// 轮换状态统一在 connectionFacts 内部，失败信息进 runtimeMarks，不需要单独 debug 路由。
	const footer = hub.slots.filter((slot) => slot.name === 'settings.models.footer')
	assert.deepEqual(footer.map((slot) => slot.id).sort(), ['dsh-llm-hub-footer', 'dsh-llm-hub-harness', 'dsh-llm-hub-health', 'dsh-llm-hub-hero', 'dsh-llm-hub-presets', 'dsh-llm-hub-routing', 'dsh-llm-hub-suite', 'dsh-llm-hub-usage'])
	for (const slot of footer) assert.equal(typeof slot.order, 'number', 'list slot 必须给 order')
	// 面板是初版设计，后来因为与卡片重复被拿掉；这里钉住它不会被顺手加回来。
	assert.equal(hub.slots.some((slot) => slot.id === 'dsh-llm-hub-availability'), false)
})

test('pi-ai 卡：被判不可用时出现状态片，原因放 title', () => {
	const hub = bootstrap({ seed: [STATUS], availability: { providers: [{ provider: 'modelgo', state: 'unavailable', reason: 'apiKeyEnv 指向的 X 解析不到' }], hidden: ['modelgo'] } })
	const tree = hub.renderPiai('modelgo')
	const chip = findByClass(tree, 'dsh-llm-hub-chip--hidden')
	assert.ok(chip, '不可用时必须有状态片')
	assert.equal(chip.props.title, 'apiKeyEnv 指向的 X 解析不到')
	assert.deepEqual(textsOf(chip), ['availabilityUnavailable'])
	// 状态片与按钮同处动作条：不额外占一行
	assert.ok(findByClass(tree, 'dsh-llm-hub-actions'), '动作条还在')
})

test('pi-ai 卡：可用时不出现状态片', () => {
	const hub = bootstrap({ seed: [STATUS], availability: { providers: [{ provider: 'modelgo', state: 'available', reason: '' }], hidden: [] } })
	assert.equal(findByClass(hub.renderPiai('modelgo'), 'dsh-llm-hub-chip--hidden'), undefined)
})

test('页脚：隐藏数为 0 不显示计数，有重探按钮；点击真的发 POST', async () => {
	const hub = bootstrap({ seed: [{ ok: true, name: 'dsh-llm-hub', version: '9.9.9' }, false, false], availability: { providers: [], hidden: [] } })
	const clean = hub.renderFooter()
	assert.equal(findByClass(clean, 'dsh-llm-hub-foot__hidden'), undefined, '没有隐藏项就不该出现红色计数')
	const texts = textsOf(clean)
	assert.ok(texts.some((t) => t.includes('9.9.9')), '版本行仍在')
})

test('页脚：有隐藏项时显示计数，按钮触发强制重探', async () => {
	const hub = bootstrap({
		seed: [{ ok: true, name: 'dsh-llm-hub', version: '9.9.9' }, false, false],
		availability: { providers: [], hidden: ['modelgo', 'minimax'] },
		fetch: async () => ({ status: 200, json: async () => ({ ok: true, providers: [], hidden: [] }) })
	})
	const tree = hub.renderFooter()
	const counter = findByClass(tree, 'dsh-llm-hub-foot__hidden')
	assert.ok(counter, '隐藏数必须显示')
	// 文案是模板串拼出来的一个文本节点（词典桩把 key 原样返回）
	assert.deepEqual(textsOf(counter), ['availabilityHiddenCount 2'])
	const button = findByClass(tree, 'dsh-llm-hub-foot__link')
	assert.ok(button && typeof button.props.onClick === 'function', '重探按钮必须可点')
	button.props.onClick()
	await new Promise((resolve) => setTimeout(resolve, 10))
	assert.ok(hub.calls.some((call) => call.startsWith('POST ') && call.includes('/availability/recheck')), `点击应发 POST，实际: ${hub.calls.join(', ')}`)
})

test('可用性缓存：普通读取在途时，强制重探不会被降级成读缓存', async () => {
	// 回归：load 与 recheck 曾共用一条在途链。点「重新探测全部」时若正好有一次读取
	// 在途，重探会静默返回那次读取的结果 —— 按钮点了没反应，最难查的那种 bug。
	let release
	const calls = []
	const pending = new Promise((resolve) => { release = resolve })
	const hub = bootstrap({
		fetch: (url, init) => {
			const method = init?.method ?? 'GET'
			calls.push(`${method} ${url}`)
			if (method === 'GET') return pending
			return Promise.resolve({ status: 200, json: async () => ({ ok: true, providers: [], hidden: [] }) })
		}
	})
	const store = hub.store
	const inFlight = store.load()
	const recheck = store.recheck()
	await new Promise((resolve) => setTimeout(resolve, 10))
	assert.ok(calls.some((call) => call.startsWith('POST ')), `重探必须独立发出 POST，实际: ${calls.join(', ')}`)
	release({ status: 200, json: async () => ({ ok: true, providers: [], hidden: [] }) })
	await Promise.all([inFlight, recheck])
	assert.equal(store.snapshot().status, 'ready')
})

test('可用性缓存：订阅设置/凭据事件，改完 key 会自动重读', () => {
	const hub = bootstrap()
	for (const event of ['settings/document-updated', 'credentials/reference-updated', 'llm/adapters-updated']) {
		assert.ok(hub.subscriptions.includes(event), `应订阅 ${event}`)
	}
})

// ── harness 一览 ────────────────────────────────────────────────────────────

/** 三个 harness 的典型快照：一个可派、一个被占、一个没装。 */
const HARNESS_REPORT = {
	ok: true,
	probed: true,
	harnesses: [
		{ id: 'codex', bin: 'codex', displayName: 'Codex', installed: true, registered: false, note: '提供方已存在' },
		{ id: 'claude-code', bin: 'claude', displayName: 'Claude Code', installed: false, registered: false, note: '未找到可执行文件' },
		{ id: 'antigravity', bin: 'agy', displayName: 'Antigravity', installed: true, registered: true, executable: '/Users/x/.local/bin/agy', note: '' }
	]
}

test('harness：probed 为 false 时什么都不渲染（启动竞态不能说成「都没装」）', () => {
	// host 半是异步探测的，页面可能在探完之前就打开了。这时候渲染「未安装 ×3」
	// 是在说谎，用户会去装一个其实已经装了的 CLI。
	const hub = bootstrap({ seed: [{ ok: true, probed: false, harnesses: [] }] })
	assert.equal(hub.renderHarness(), null)
})

test('harness：接口失败或清单为空 → 不渲染', () => {
	assert.equal(bootstrap({ seed: [{ ok: false }] }).renderHarness(), null)
	assert.equal(bootstrap({ seed: [{ ok: true, probed: true, harnesses: [] }] }).renderHarness(), null)
})

test('harness：三种状态各渲染一个 chip，未安装的也显示（要让人知道装了能多派一个）', () => {
	const tree = bootstrap({ seed: [HARNESS_REPORT] }).renderHarness()
	const texts = textsOf(tree)
	// 三个名字都在
	for (const name of ['Codex', 'Claude Code', 'Antigravity']) assert.ok(texts.includes(name), `缺 ${name}`)
	// 三种状态文案各出现一次
	assert.equal(texts.filter((x) => x === 'harnessReady').length, 1)
	assert.equal(texts.filter((x) => x === 'harnessOccupied').length, 1)
	assert.equal(texts.filter((x) => x === 'harnessMissing').length, 1)
})

test('harness：只有 registered 的那个带就绪点，未安装的整个 chip 置灰', () => {
	const tree = bootstrap({ seed: [HARNESS_REPORT] }).renderHarness()
	const nodes = flatten(tree).filter((n) => n && n.props && typeof n.props.className === 'string')
	const readyDots = nodes.filter((n) => n.props.className.includes('__dot--ready'))
	assert.equal(readyDots.length, 1, '只有真注册上的才算就绪')
	const dimmed = nodes.filter((n) => n.props.className.includes('__chip--missing'))
	assert.equal(dimmed.length, 1, '只有没装的那个置灰；被占用的装了，不该灰')
})

test('harness：可执行文件路径进 tooltip（「装了却不生效」第一件要查的就是它找到了哪个副本）', () => {
	const tree = bootstrap({ seed: [HARNESS_REPORT] }).renderHarness()
	const chip = flatten(tree).find((n) => n && n.props && typeof n.props.title === 'string' && n.props.title.includes('/agy'))
	assert.ok(chip, '已解析到路径的 harness 必须把路径放进 title')
})
