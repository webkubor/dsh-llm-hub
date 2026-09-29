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
// document 额外记下 addEventListener：路由 chip 的浮层靠「点外部 / Esc 关闭」，
// 收不收得住只能靠真触发这两个事件来验，光看渲染树看不出来。
const docListeners = new Map()
globalThis.window = { __ModuleLoader__: { load: (definition) => { pluginDefinition = definition } } }
globalThis.document = {
	getElementById: () => null,
	createElement: () => ({ textContent: '' }),
	head: { appendChild: () => {} },
	addEventListener: (type, handler) => {
		if (!docListeners.has(type)) docListeners.set(type, new Set())
		docListeners.get(type).add(handler)
	},
	removeEventListener: (type, handler) => { docListeners.get(type)?.delete(handler) }
}
/** 触发一次 document 上的事件（冒泡型，由目标节点自己往上传 —— 桩没有真 DOM）。 */
globalThis.__fireDocument = (type, event) => {
	for (const handler of [...(docListeners.get(type) ?? [])]) handler(event)
}
/** 当前挂在 document 上的某类监听数（用来验「关着时不挂」/「关掉后卸干净」）。 */
globalThis.__docListeners = (type) => docListeners.get(type)?.size ?? 0
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
 *
 * setter / ref / effect 三样都记进 `_setters` / `_refs` / `_effects`：
 * 「点完浮层有没有收起」这种契约，看渲染树是看不出来的 —— 收不收起发生在
 * 事件回调和 effect 里，只能观察状态被写成了什么。默认仍不跑 effect，
 * 免得把「加载态自己跑完」这件事从用例手里抢走。
 */
function createReact(seedValues, options = {}) {
	// 用闭包变量而不是 this：桩里的 useState 是箭头函数，this 不指向这个对象字面量。
	let seed = seedValues ?? []
	let index = 0
	const noop = () => {}
	const setters = []
	const refs = []
	const effects = []
	const applied = []
	const react = {
		_reset(next) { seed = next ?? []; index = 0; setters.length = 0; refs.length = 0; effects.length = 0; applied.length = 0 },
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
		useState: (initial) => {
			// 按调用顺序喂种子：hook 顺序确定，想跳过「还没加载完」的早返回就得这样 seed。
			const seeded = seed[index]
			const hook = index
			index += 1
			const value = seeded !== undefined ? seeded : initial
			const pair = [value, (next) => {
				pair[0] = typeof next === 'function' ? next(pair[0]) : next
				applied.push({ hook, value: pair[0] })
			}]
			setters.push(pair)
			return pair
		},
		useEffect: options.runEffects === true ? (fn) => { effects.push(fn) } : noop,
		useCallback: (fn) => fn,
		useMemo: (fn) => fn(),
		useRef: (initial) => {
			const ref = { current: initial === undefined ? null : initial }
			refs.push(ref)
			return ref
		},
		useId: () => 'test-id',
		// 卡片/页脚用它读可用性：桩直接返回注入的快照，机制本身不在这一层测。
		useSyncExternalStore: () => seedValues?.__availability ?? { providers: [], hidden: [] }
	}
	react._setters = setters
	react._refs = refs
	react._effects = effects
	react._applied = applied
	return react
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
	const react = createReact(options.seed, options)
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
	const renderPiai = (provider, owner = {}) => {
		const slot = slots.find((item) => item.key === 'llm-pi-ai')
		react._reset(options.seed)
		return slot.component({ ...slot.inject(), provider, ...owner })
	}
	const renderHarness = () => {
		const slot = slots.find((item) => item.id === 'dsh-llm-hub-harness')
		react._reset(options.seed)
		return slot.component({ ...slot.inject() })
	}
	/**
	 * 渲染家族 Dock。`options.boot` 决定 client 半从 `window.__DSH_BOOT__` 读到什么：
	 * 不传 = 这个全局不存在（老宿主 / 非 web 载体）；传数组 = 存在的那份 entries。
	 */
	const renderSuite = () => {
		const slot = slots.find((item) => item.id === 'dsh-llm-hub-suite')
		if (options.boot === undefined) delete globalThis.window.__DSH_BOOT__
		else globalThis.window.__DSH_BOOT__ = { rev: 'test', entries: options.boot }
		react._reset(options.seed)
		return slot.component({ ...slot.inject() })
	}
	return {
		slots,
		subscriptions,
		calls,
		react,
		/**
		 * 按 slot id 渲染任意卡片，并显式喂 hook 种子。
		 *
		 * 为什么需要它：路由卡这类组件的可见内容由 `useState` 的初值决定（测试里的
		 * `useEffect` 是 noop，加载态不会自己跑完），所以必须能把状态直接 seed 进去。
		 */
		renderSlot(id, seed) {
			const slot = slots.find((item) => item.id === id)
			if (slot === undefined) throw new Error(`没有注册这个 slot: ${id}`)
			react._reset(seed)
			return slot.component({ ...slot.inject() })
		},
		renderFooter,
		renderPiai,
		renderHarness,
		renderSuite,
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

test('挂载点：两张 provider 卡 + 页脚 + harness + 用量 + 健康看板 + 路由 + composer 路由 chip，且不再有逐条重述的可用性面板', () => {
	const hub = bootstrap()
	const mounted = hub.slots.map((slot) => `${slot.name}${slot.id ? '#' + slot.id : ''}${slot.key ? '@' + slot.key : ''}`)
	assert.deepEqual(mounted.sort(), [
		'conversation.input.left#dsh-llm-hub-route-chip',
		'settings.models.footer#dsh-llm-hub-footer',
		'settings.models.footer#dsh-llm-hub-harness',
		'settings.models.footer#dsh-llm-hub-health',
		'settings.models.footer#dsh-llm-hub-hero',
		'settings.models.footer#dsh-llm-hub-suite',
		'settings.models.footer#dsh-llm-hub-usage',
		'settings.models.provider-card@llm-deepseek',
		'settings.models.provider-card@llm-pi-ai',
		'settings.section#dsh-llm-hub-routing'
	].sort())
	// footer 是 list slot，**六个**条目靠 id 区分、靠 order 排序（hero 60 / health 70 /
	// routing 75 / usage 80 / harness 90 / footer 100 / suite 110）。漏了 id 会被宿主静默丢弃 —— 接口通、组件在、页面上什么都没有。
	// **没有 keypool**：1.4.0 起按用户反馈删独立「多账号 key 轮换」卡 —— 多 key 走 `apiKeyEnv` 数组配置，
	// 轮换状态统一在 connectionFacts 内部，失败信息进 runtimeMarks，不需要单独 debug 路由。
	const footer = hub.slots.filter((slot) => slot.name === 'settings.models.footer')
	assert.deepEqual(footer.map((slot) => slot.id).sort(), ['dsh-llm-hub-footer', 'dsh-llm-hub-harness', 'dsh-llm-hub-health', 'dsh-llm-hub-hero', 'dsh-llm-hub-suite', 'dsh-llm-hub-usage'])
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

// ── 家族 Dock：激活判定 ──────────────────────────────────────────────────────

/** 一个 boot graph entry 的最小形状。 */
const bootEntry = (id) => ({ id, url: `/plugins/??${id}/client.js&rev=x`, rev: 'x' })

test('家族 Dock：四个插件都进 boot graph 时必须亮四个 —— 回归「只有自己亮」', () => {
	// 这条是 2026-09-26 用户报的 bug：四个都装了、都真的加载了，面板却只亮 LLM Hub 一个。
	// 根因是判定写死成 `item.isCurrent`，而 isCurrent:true 只写在 LLM Hub 自己那个对象上，
	// 另外三个压根没这个字段 → 永远 undefined。判定从来没发生过。
	const hub = bootstrap({
		boot: [
			bootEntry('dsh-bloom-theme'),
			bootEntry('@dsh-plugins/dsh-llm-hub'),
			bootEntry('@dsh-plugins/dsh-user-mirror'),
			bootEntry('@dsh-plugins/dsh-env-inspector')
		]
	})
	const tree = hub.renderSuite()
	assert.equal(textsOf(tree).filter((x) => x === 'suiteActive').length, 4, '四个都激活')
	assert.equal(findByClass(tree, 'dsh-suite-btn-action'), undefined, '一个都不该出现安装按钮')
})

test('家族 Dock：没装的显示安装按钮，装了的不显示 —— 逐个按真实名单判', () => {
	const hub = bootstrap({ boot: [bootEntry('dsh-bloom-theme'), bootEntry('@dsh-plugins/dsh-llm-hub')] })
	const tree = hub.renderSuite()
	assert.equal(textsOf(tree).filter((x) => x === 'suiteActive').length, 2)
	// 按钮文案是模板串拼的（`⚡ ${t(...)}`），按后缀数而不是全等 —— 前缀符号也是设计的一部分。
	assert.equal(textsOf(tree).filter((x) => x.endsWith('suiteCopyInstall')).length, 2, '缺的两个给安装按钮')
})

test('家族 Dock：包名按 aliases 归一 —— scope 改过名也要认得出来', () => {
	// user-mirror 在 profile 里叫 @dsh-plugins/dsh-user-mirror，仓库叫 dsh-mirror，
	// 曾经的 row 名是 dsh-mirror。任一形态在 boot graph 里都得算已激活。
	const hub = bootstrap({ boot: [bootEntry('dsh-mirror')] })
	const tree = hub.renderSuite()
	assert.equal(textsOf(tree).filter((x) => x === 'suiteActive').length, 1, '短名 dsh-mirror 也算激活')
})

test('家族 Dock：读不到 __DSH_BOOT__ 时说「判定不可用」，不说「没装」', () => {
	// 把探测失败渲染成「四个都没装」，人会去重装已经装好的插件 —— 这是谎报，必须区分开。
	const hub = bootstrap({})
	const tree = hub.renderSuite()
	assert.equal(textsOf(tree).filter((x) => x === 'suiteUnknown').length, 4, '四个都标判定不可用')
	assert.equal(findByClass(tree, 'dsh-suite-btn-action'), undefined, '判定不了时不给安装按钮')
})

test('家族 Dock：entries 形状不对（不是数组）也走「判定不可用」，不抛异常', () => {
	for (const boot of [null, 'nonsense', { entries: 'not-an-array' }]) {
		const hub = bootstrap({ boot })
		const tree = hub.renderSuite()
		assert.equal(textsOf(tree).filter((x) => x === 'suiteUnknown').length, 4, `entries=${JSON.stringify(boot)} 应降级`)
	}
})

test('家族 Dock：复制出的安装命令必须是能跑的（带 --profile）', () => {
	// `dsh plugin` 是 pnpm 的透传层，--profile 是必填选项，漏了直接报错退出 ——
	// 复制出去的命令跑不通，比不给命令更糟。
	const written = []
	// Node 24 的 navigator 只有 getter，得用 defineProperty 覆盖而不是直接赋值。
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { clipboard: { writeText: (text) => { written.push(text); return Promise.resolve() } } }
	})
	try {
		const tree = bootstrap({ boot: [] }).renderSuite()
		findByClass(tree, 'dsh-suite-btn-action').props.onClick()
		assert.equal(written.length, 1)
		assert.match(written[0], /^dsh plugin --profile web add @dsh-plugins\//, `实际复制: ${written[0]}`)
	} finally {
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined })
	}
})

test('家族 Dock：条目里不再有写死的 isCurrent', () => {
	// 钉住根因本身：面板源码里不允许再出现按「自己是不是当前插件」来判别人的写法。
	const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../lib/client.js'), 'utf8')
	assert.equal(/isCurrent\s*:/.test(source), false, '不允许再写死 isCurrent')
	assert.equal(/item\.isCurrent/.test(source), false, '不允许再按 isCurrent 判定激活')
})

// ── 智能路由编辑器（设置页路由卡）────────────────────────────────────────────

/** 状态接口的最小快照：一个 smart 模式下的「公司」组。 */
const ROUTING_STATE = {
	ok: true,
	mode: 'smart',
	activeGroup: 'company',
	groups: [
		{
			id: 'company',
			label: '公司',
			candidates: [
				{ provider: 'modelgo-gateway', model: 'claude-sonnet-5', state: 'available' },
				{ provider: 'modelgo-gateway', model: 'gpt-5.5', state: 'unavailable' }
			],
			wouldRoute: { provider: 'modelgo-gateway', model: 'claude-sonnet-5' },
			reason: null
		}
	],
	lastDecision: { at: 1, group: 'company', from: { provider: 'deepseek-official', model: 'deepseek-flash' }, to: { provider: 'modelgo-gateway', model: 'claude-sonnet-5' }, reason: null }
}

/** 可路由目录：两个 provider。 */
const ROUTING_CATALOG = {
	ok: true,
	providers: [
		// models 条目带 input 模态（host 1.5.5 起的目录形态）：claude-sonnet-5 与
		// deepseek-flash 是多模态，gpt-5.5 纯文本 —— UI 要能区分。
		{ id: 'modelgo-gateway', displayName: 'modelgo', ns: 'llm-pi-ai', models: [
			{ id: 'claude-sonnet-5', input: ['text', 'image'] },
			{ id: 'gpt-5.5', input: ['text'] }
		] },
		{ id: 'deepseek-official', displayName: 'DeepSeek 官方直连', ns: 'llm-deepseek', models: [
			{ id: 'deepseek-flash', input: ['text', 'image'] }
		] }
	]
}

/** 路由卡 hook 种子（顺序即 useState 调用顺序）。 */
function routingSeed(state, draft, savedKey) {
	return [state, ROUTING_CATALOG.providers, draft, state.activeGroup, state.activeGroup, { provider: '', model: '' }, false, null, savedKey]
}

/** 两个组的状态快照：验「展开的组 / 折叠的组并存」必须有第二组。 */
function twoGroupState() {
	return {
		...ROUTING_STATE,
		groups: [
			ROUTING_STATE.groups[0],
			{
				id: 'personal',
				label: '个人',
				candidates: [
					{ provider: 'deepseek-official', model: 'deepseek-flash', state: 'available' },
					{ provider: 'modelgo-gateway', model: 'gpt-5.5', state: 'unavailable' }
				],
				wouldRoute: { provider: 'deepseek-official', model: 'deepseek-flash' },
				reason: null
			}
		]
	}
}
/** 与 host 侧同一套「草稿指纹」（label 空 → null）。 */
function routingKeyOf(draft) {
	return JSON.stringify(draft
		.filter((group) => group.candidates.length > 0)
		.map((group) => [group.id, group.label ? group.label : null, group.note ? group.note : null,
			group.candidates.map((candidate) => [`${candidate.provider}/${candidate.model}`, candidate.note ? candidate.note : null])]))
}
/** 从 state 折出编辑器草稿（与组件 adopt() 一致）。 */
function draftOf(state) {
	return (state.groups ?? []).map((group) => ({
		id: group.id,
		label: group.label ?? '',
		note: group.note ?? '',
		candidates: group.candidates.map((candidate) => ({ provider: candidate.provider, model: candidate.model, note: candidate.note ?? '' }))
	}))
}
/** 某组展开后，每个候选行里「提供方 / 模型」两个下拉的当前值。 */
const pickedOf = (tree) => flatten(tree)
	.filter((node) => node && node.props && typeof node.props.className === 'string' && node.props.className.includes('dsh-llm-hub-routing__pick'))
	.map((pick) => pick.children.filter((child) => child && child.type === 'select').map((select) => select.props.value).join('/'))

test('路由卡：规则与接管说明写在卡上（用户不用读代码就知道怎么切的）', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, routingKeyOf(draft)))
	const texts = textsOf(tree)
	assert.ok(texts.includes('routeRuleText'), '必须写明匹配规则')
	assert.ok(texts.includes('routeSmartNotice'), 'smart 模式必须说明「下拉只作参考」')
})

test('路由卡：组行带候选顺序、状态与「当前组」标记', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, routingKeyOf(draft)))
	const texts = textsOf(tree)
	// 1.7.0 起候选是可原地修改的下拉框：按顺序读出每行选中的 provider/model。
	assert.deepEqual(pickedOf(tree), ['modelgo-gateway/claude-sonnet-5', 'modelgo-gateway/gpt-5.5'], '主力与 fallback 按顺序显示')
	assert.ok(texts.includes('routePrimaryTag') && texts.includes('routeFallbackTag1'), '主/备角色要标出来')
	assert.ok(texts.includes('routeActiveTag'), '当前组要有标记')
	assert.ok(findByClass(tree, 'dsh-llm-hub-routing__add'), '要有添加候选的入口（闭环）')
})

test('路由卡：多模态候选带 👁 标记，纯文本的不带', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, routingKeyOf(draft)))
	// 组内两个候选：claude-sonnet-5 多模态（有标），gpt-5.5 纯文本（没标）。
	const badges = flatten(tree).filter((node) => node && node.props && typeof node.props.className === 'string' && node.props.className.includes('dsh-llm-hub-routing__multimodal'))
	assert.equal(badges.length, 1, '只有多模态的那个候选有标记')
})

// 2026-09-28 改的契约：干净时**不占位**。原先空闲态渲染「已保存」，但那三个字
// 跟「刚刚存成功」长得一模一样，读起来像一条一直挂着的成功提示，其实什么都没说。
// 现在只有 真存过 / 存到一半 / 存失败 才给反馈。
test('路由卡：干净时不显示任何保存状态（不再常驻「已保存」）', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, routingKeyOf(draft)))
	assert.equal(findByClass(tree, 'dsh-llm-hub-routing__status'), undefined, '干净状态不该有状态文案占位')
	assert.ok(!textsOf(tree).includes('routeSaved'), '干净状态不该显示「已保存」')
})

// 1.6.1：页脚「热门大模型一键装配」抽屉读起来像广告，改成只在「添加提供方」选中某家时，
// 在那张草稿卡（宿主以 configured:false 派发）上给一行匹配提示。
test('添加提供方草稿卡：选中已知厂商时出现一行匹配提示（名称 · 推荐 · 获取 Key）', () => {
	const hub = bootstrap({ seed: [STATUS] })
	const tree = hub.renderPiai({ provider: 'minimax-cn', displayName: 'minimax-cn' }, { configured: false })
	const hint = findByClass(tree, 'dsh-llm-hub-preset-hint')
	assert.ok(hint, '草稿态且命中预设时必须出现提示')
	const link = findByClass(tree, 'dsh-llm-hub-preset-hint__link')
	assert.match(link.props.href, /minimaxi\.com/)
})

test('添加提供方草稿卡：已配置的卡、未知厂商都不出现提示', () => {
	const hub = bootstrap({ seed: [STATUS] })
	assert.equal(findByClass(hub.renderPiai({ provider: 'minimax-cn' }, { configured: true }), 'dsh-llm-hub-preset-hint'), undefined)
	assert.equal(findByClass(hub.renderPiai({ provider: 'xai' }, { configured: false }), 'dsh-llm-hub-preset-hint'), undefined)
})

test('页脚不再有预设抽屉，也不再携带 YAML 模板', () => {
	const hub = bootstrap()
	assert.equal(hub.slots.some((slot) => slot.id === 'dsh-llm-hub-presets'), false)
})

test('添加提供方草稿卡：不渲染原卡内容（避免把「还没保存」显示成红字报错）', () => {
	const hub = bootstrap({ seed: [STATUS] })
	const draft = hub.renderPiai({ provider: 'openrouter' }, { configured: false })
	assert.ok(findByClass(draft, 'dsh-llm-hub-preset-hint'))
	assert.equal(findByClass(draft, 'dsh-llm-hub-error'), undefined)
	assert.equal(hub.renderPiai({ provider: 'xai' }, { configured: false }), null)
})

// ── 1.7.0 路由编辑器：原地改 / 设为主力 / 备注 / 默认展开 / 自动保存 ──
// ── 1.6.2 折叠模型：始终折叠，展开才编辑 ────────────────────────────────
// 反转了 1.7.0 的「当前组默认展开」。理由：进设置页要回答的是「这几组各自会路由到
// 哪」，折叠行就答完了；而逐条候选是低频编辑动作，默认展开等于一进来就糊一屏表单。
// 「看一眼」和「改」是两种意图，默认态应该服务于前者。
test('路由卡：默认全折叠（当前组也不展开），开合是写明「编辑 / 收起」的按钮', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const seed = routingSeed(ROUTING_STATE, draft, routingKeyOf(draft))
	seed[4] = null // expanded：还没开合过
	const tree = hub.renderSlot('dsh-llm-hub-routing', seed)
	assert.equal(findByClass(tree, 'dsh-llm-hub-routing__candidates'), undefined, '默认不该展开任何组（当前组也不例外）')
	assert.ok(textsOf(tree).some((text) => text.includes('routeEdit')), '折叠态按钮写「编辑」')
	// 组名折叠时是纯文本 —— 折叠行还摆输入框，会让「在编辑」和「在显示」长得一样。
	assert.equal(findByClass(tree, 'dsh-llm-hub-routing__group-label'), undefined, '折叠态不该有组名输入框')
	assert.ok(findByClass(tree, 'dsh-llm-hub-routing__group-name'), '折叠态组名是纯文本')
})

test('路由卡：折叠行把「会路由到哪」顶在最前，紧跟可用/总', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	// expanded 指向一个不存在的组 => 全部折叠，这是断言折叠态最干净的办法
	const seed = routingSeed(ROUTING_STATE, draft, routingKeyOf(draft))
	seed[4] = '__none__'
	const tree = hub.renderSlot('dsh-llm-hub-routing', seed)
	const state = flatten(tree).find((node) => node && node.props && node.props.className === 'dsh-llm-hub-routing__group-state')
	assert.ok(state, '折叠行要有摘要')
	// textsOf 是前序遍历，顺序即渲染顺序 —— 这里要的就是「谁排在前面」
	const texts = textsOf(state)
	assert.ok(texts[0].startsWith('→ modelgo-gateway/claude-sonnet-5'), `第一段必须是会路由到哪，实际: ${texts[0]}`)
	// 可用/总：2 个候选里 1 个 unavailable
	assert.equal(texts[1], '1/2', '紧跟着报「可用/总数」')
	// 折叠行不放「主力」和「+N 兜底」：564px 宽的内容区里塞不下（浏览器实测会被压成
	// 「将路由到 m…」「主力 mod…」），而「主力」展开态第一行就有，「1/2」已含总数。
	assert.ok(!texts.some((text) => text.startsWith('routingPrimary')), '折叠行不该再放主力 —— 那是第四件事，挤掉最该读的')
	assert.ok(!texts.some((text) => text.includes('routeFallbackCount')), '「+N 兜底」与「可用/总」同义，不重复占位')
	// 箭头的全称进 title，悬停可见
	const would = flatten(state).find((node) => node && node.props && node.props.className === 'dsh-llm-hub-routing__group-would')
	assert.match(would.props.title, /^routeChipWouldRoute /, 'title 里要有全称')
})

test('路由卡：组健康点分三色（全可用 / 还剩几个 / 一个不剩）', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const dotOf = (state) => {
		const seed = routingSeed(state, draft, routingKeyOf(draft))
		seed[4] = '__none__'
		const tree = hub.renderSlot('dsh-llm-hub-routing', seed)
		const st = flatten(tree).find((node) => node && node.props && node.props.className === 'dsh-llm-hub-routing__group-state')
		return flatten(st).find((node) => node && node.props && typeof node.props.className === 'string' && node.props.className.includes('dsh-llm-hub-routing__dot--')).props.className
	}
	const withStates = (states) => ({ ...ROUTING_STATE, groups: [{ ...ROUTING_STATE.groups[0], candidates: ROUTING_STATE.groups[0].candidates.map((c, i) => ({ ...c, state: states[i] })) }] })
	// 半可用单独一色：混成全绿会让人以为不用管，混成全红会误报故障
	assert.match(dotOf(withStates(['available', 'unavailable'])), /--degraded$/, '还剩几个 = degraded')
	assert.match(dotOf(withStates(['available', 'available'])), /--available$/, '全可用 = available')
	assert.match(dotOf(withStates(['unavailable', 'unavailable'])), /--unavailable$/, '一个不剩 = unavailable')
})

test('路由卡：展开的组给组名输入框，折叠的组不给（一个时刻只有一处能改名）', () => {
	const hub = bootstrap()
	const twoGroups = twoGroupState()
	const draft = draftOf(twoGroups)
	// expanded = 'company'：公司展开、个人折叠
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(twoGroups, draft, routingKeyOf(draft)))
	assert.equal(flatten(tree).filter((n) => n && n.props && n.props.className === 'dsh-llm-hub-routing__group-label').length, 1, '只有展开的组有输入框')
	assert.equal(flatten(tree).filter((n) => n && n.props && n.props.className === 'dsh-llm-hub-routing__group-name').length, 1, '折叠的组用纯文本')
})

test('路由卡：某组全不可用时，折叠行直说原因而不是空白', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const dead = { ...ROUTING_STATE, groups: [{ ...ROUTING_STATE.groups[0], wouldRoute: null, reason: '全部候选额度耗尽' }] }
	const seed = routingSeed(dead, draft, routingKeyOf(draft))
	seed[4] = '__none__'
	const tree = hub.renderSlot('dsh-llm-hub-routing', seed)
	const state = flatten(tree).find((node) => node && node.props && node.props.className === 'dsh-llm-hub-routing__group-state')
	const texts = textsOf(state)
	// 关键在「排第一」：旧版把 reason 挂在主力**后面**当补充，新版让它顶替
	// 「会路由到哪」那个位置 —— 不可用原因和可路由目标是同一个槽位，不是两件事。
	assert.ok(texts[0].includes('全部候选额度耗尽'), `原因要顶在第一段，实际: ${texts[0]}`)
	assert.ok(!texts[0].startsWith('→'), '没有可路由目标时不该还说「→」')
	// 不可用原因通常很长，这一行没有第二行给它 —— 必须能被截断而不是撑破布局
	const would = flatten(state).find((node) => node && node.props && node.props.className === 'dsh-llm-hub-routing__group-would')
	assert.ok(would, '原因要落在会路由到那个槽位上')
	assert.ok(texts[1] && /^\d+\/\d+$/.test(texts[1]), `不可用也要报「可用/总」，实际: ${texts[1]}`)
})

test('路由卡：非主力候选有「设为主力」，每个候选有备注输入', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const tree = hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, routingKeyOf(draft)))
	const texts = textsOf(tree)
	assert.equal(texts.filter((text) => text === 'routeMakePrimary').length, 1, '只有备1 有「设为主力」')
	const notes = flatten(tree).filter((node) => node && node.type === 'input' && typeof node.props.className === 'string' && node.props.className.includes('dsh-llm-hub-routing__note'))
	assert.equal(notes.length, 3, '组备注 1 个 + 每个候选各 1 个')
})

// 2026-09-28：干净态不再显示「已保存」（见上一个测试的理由）。
// 「空组不算改动」这条契约本身不变，只是改用反向断言表达 —— 空组不该
// 触发「保存中…」。
test('路由卡：有改动显示「保存中…」，空组不算改动，干净态不占位', () => {
	const hub = bootstrap()
	const draft = draftOf(ROUTING_STATE)
	const clean = routingKeyOf(draft)
	assert.ok(!textsOf(hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, draft, clean))).includes('routeSaved'), '干净状态不该显示「已保存」')
	const edited = draft.map((group) => ({ ...group, note: '公司报销' }))
	assert.ok(textsOf(hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, edited, clean))).includes('routeSaving'), '改了备注 = 有改动')
	const withEmpty = [...draft, { id: 'group-2', label: '', note: '', candidates: [] }]
	assert.ok(!textsOf(hub.renderSlot('dsh-llm-hub-routing', routingSeed(ROUTING_STATE, withEmpty, clean))).includes('routeSaving'), '刚建的空组不触发保存（服务端会丢弃空组）')
})

test('路由是独立的设置分区，排在「模型」(10) 下面、「插件」(15) 上面', () => {
	const hub = bootstrap()
	const section = hub.slots.find((slot) => slot.name === 'settings.section' && slot.id === 'dsh-llm-hub-routing')
	assert.ok(section, '要注册成 settings.section')
	assert.ok(section.order > 10 && section.order < 15)
	assert.equal(typeof section.label, 'function', '导航文字由注册方提供')
	assert.equal(hub.slots.some((slot) => slot.name === 'settings.models.footer' && slot.id === 'dsh-llm-hub-routing'), false, '模型页脚不再重复挂一份')
})

// ── 路由快切 chip 的浮层开关（2026-09-29 浏览器实测）────────────────────────
// 症状：在浮层里点「智能路由 / 手动模型」或点某个组，按钮高亮变了、状态也切了，
// 浮层却纹丝不动地盖在输入框上，只能再点一次 chip 才收得回去。
// 根因：open 只有 chip 按钮一个 toggle 在写，菜单内的所有 onClick 都不碰它，
// 也没有「点外部 / Esc」的兜底。
// 这类契约看渲染树验不出来 —— 收不收起发生在事件回调里，只能看 open 被写成什么。

/** chip 的 hook 种子（顺序即 useState 调用顺序）：state / open / busy。 */
const chipSeed = (open) => [ROUTING_STATE, open, false]

/** 起一个 chip 实例：fetch 桩只答 routing 两条，其余照通用应答。 */
function chipHub(options = {}) {
	return bootstrap({
		runEffects: true,
		seed: chipSeed(true),
		fetch: async (url) => ({
			status: 200,
			json: async () => (url.endsWith('/routing/state') ? ROUTING_STATE : { ok: true, ...ROUTING_STATE })
		}),
		...options
	})
}
/** 把渲染树里 class 命中的第一个节点的 onClick 触发掉。 */
const clickOf = (tree, className) => {
	const node = flatten(tree).find((item) => item && item.props && typeof item.props.className === 'string' && item.props.className.includes(className))
	assert.ok(node, `渲染树里没有 ${className}`)
	node.props.onClick()
}
/**
 * 按 class **整词**取节点。
 *
 * 不能用子串匹配：模式按钮的 class 是 `dsh-llm-hub-route__mode is-on`，
 * 而容器是 `dsh-llm-hub-route__modes` —— 子串匹配会把容器一起捞进来，
 * 按下标取「第二个」就取到了 div 而非按钮（第一版就是这么挂的）。
 */
const allByClass = (tree, className) => flatten(tree)
	.filter((item) => item && item.props && typeof item.props.className === 'string'
		&& item.props.className.split(/\s+/).includes(className))
/** 让 fetch 链上的 then 跑完。 */
const settle = () => new Promise((resolve) => { setImmediate(resolve) })
/** open（第 2 个 useState）有没有被写成 false。 */
const closedAfter = (hub) => hub.react._applied.some((item) => item.hook === 1 && item.value === false)
/**
 * 跑一遍本轮收集到的 effect，并把清理挂在 t.after 上。
 *
 * 不清理的话，chip 那个 30s 轮询的 setInterval 会一直吊着事件循环 ——
 * 用例全绿，node --test 却永远不退出（踩过一次：整轮测试 60s 超时）。
 */
function mountEffects(hub, t) {
	const disposers = hub.react._effects.map((effect) => {
		const dispose = effect()
		return typeof dispose === 'function' ? dispose : () => {}
	})
	const disposeAll = () => { for (const dispose of disposers) dispose() }
	if (typeof t?.after === 'function') t.after(disposeAll)
	return disposeAll
}

test('路由 chip：点某个组，浮层立刻收起（原来要再点一次 chip）', async () => {
	const hub = chipHub()
	const tree = hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	assert.ok(findByClass(tree, 'dsh-llm-hub-route__menu'), 'open=true 时浮层要渲染')
	clickOf(tree, 'dsh-llm-hub-route__group')
	await settle()
	assert.ok(closedAfter(hub), '点完组必须收起浮层')
})

test('路由 chip：切模式，浮层立刻收起', async () => {
	const hub = chipHub()
	// ROUTING_STATE 是 smart 模式，所以点「手动模型」才会真的发请求。
	const tree = hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	const modes = allByClass(tree, 'dsh-llm-hub-route__mode')
	assert.equal(modes.length, 2, '两个模式按钮')
	modes[1].props.onClick()
	await settle()
	assert.ok(closedAfter(hub), '切模式后必须收起浮层')
	assert.ok(hub.calls.some((call) => call === 'POST /api/dsh-llm-hub/routing/select'), '确实发了切换请求')
})

test('路由 chip：点当前已生效的模式（无请求可发）也要收起，不能像卡住', async () => {
	const hub = chipHub()
	const tree = hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	// ROUTING_STATE 已经是 smart，第一个（is-on 的）就是它。
	const modes = allByClass(tree, 'dsh-llm-hub-route__mode')
	assert.ok(modes[0].props.className.includes('is-on'), '第一个按钮是当前生效的 smart')
	modes[0].props.onClick()
	await settle()
	assert.ok(closedAfter(hub), '点已生效的模式也要收起浮层')
	assert.equal(hub.calls.filter((call) => call.startsWith('POST')).length, 0, '本来就没得切，不该发请求')
})

test('路由 chip：写失败时不收起（免得把失败藏起来）', async () => {
	const hub = chipHub({
		fetch: async () => ({ status: 500, json: async () => ({ ok: false }) })
	})
	const tree = hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	clickOf(tree, 'dsh-llm-hub-route__group')
	await settle()
	assert.equal(closedAfter(hub), false, '请求没成功就别收，浮层留着让用户看见没切成功')
})

test('路由 chip：点浮层外面收起，点里面不收', (t) => {
	const hub = chipHub()
	hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	mountEffects(hub, t)
	// refs[0] 是浮层根节点的 ref；给它一个能判 contains 的假根。
	hub.react._refs[0].current = { contains: (target) => target === 'inside' }

	globalThis.__fireDocument('mousedown', { target: 'inside' })
	assert.equal(closedAfter(hub), false, '点在浮层内部不能收起（否则菜单里的按钮永远点不到）')

	globalThis.__fireDocument('mousedown', { target: 'elsewhere' })
	assert.ok(closedAfter(hub), '点浮层外面必须收起')
})

test('路由 chip：Esc 收起浮层', (t) => {
	const hub = chipHub()
	hub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	mountEffects(hub, t)
	globalThis.__fireDocument('keydown', { key: 'Escape' })
	assert.ok(closedAfter(hub), 'Esc 必须能收起浮层')
})

test('路由 chip：浮层关着时不往 document 挂监听，卸载时卸干净', (t) => {
	// 量差值：docListeners 是模块级的，会跨用例累积。
	const before = globalThis.__docListeners('mousedown') + globalThis.__docListeners('keydown')

	const closedHub = chipHub()
	closedHub.renderSlot('dsh-llm-hub-route-chip', chipSeed(false))
	mountEffects(closedHub, t)
	assert.equal(globalThis.__docListeners('mousedown') + globalThis.__docListeners('keydown'), before, 'open=false 时不该往 document 挂任何监听')

	const openHub = chipHub()
	openHub.renderSlot('dsh-llm-hub-route-chip', chipSeed(true))
	const unmount = mountEffects(openHub, t)
	assert.ok(globalThis.__docListeners('mousedown') > before, 'open=true 时要挂上 mousedown')

	// 组件卸载 = effect 的清理函数跑一遍；漏掉就是每开关一次浮层就漏一个 handler。
	// 注意要用 mountEffects 返回的那份清理，别再跑一遍 effect ——
	// 那样等于又挂了一对新的，量出来的差值就成了两倍（第一版就是这么错的）。
	unmount()
	assert.equal(globalThis.__docListeners('mousedown') + globalThis.__docListeners('keydown'), before, '卸载后监听要卸干净，不能每开关一次漏一个')
})
