/**
 * 回归：Hero 卡片的「可用模型」必须显示真实数量，不能是破折号。
 *
 * 这条用例的由来（2026-10-09 owner 报「可用模型显示是 0」）：
 * hero 累加的是 availability 载荷里的 `modelCount`，而那时的探针结论
 * 压根不带这个字段 —— 数字只存在于另一个端点（pi-ai/status）里，
 * 于是累加恒为 0，渲染成 `—`。
 *
 * 修法是让探针结论直接带上 `modelIds` / `modelCount`（见 lib/index.js 的
 * refreshAvailability），hero 再用 Set 对 modelIds 去重，避免不同 provider
 * 重复配同名模型时重复计数。
 *
 * 所以这里必须用**真载荷形状**来验：只有 modelIds、没有 modelCount 时也要出数；
 * 两者都在时以去重后的 modelIds 为准；unavailable 的 provider 不计入。
 *
 * @module dsh-llm-hub/test/hero-live-payload
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PKG_NAME = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).name

/** 渲染树 → 一维数组。 */
const flatten = (node) => {
	if (node === null || node === undefined || node === false) return []
	if (Array.isArray(node)) return node.flatMap(flatten)
	if (typeof node !== 'object') return [node]
	return [node, ...flatten(node.children ?? [])]
}
const textsOf = (node) => flatten(node).filter((n) => typeof n === 'string')

/** 抽出 hero 卡片里每张卡的数字（按卡片顺序）。 */
const heroNumbers = (tree) => {
	const nums = []
	const walk = (node) => {
		if (node === null || node === undefined) return
		if (Array.isArray(node)) return node.forEach(walk)
		if (typeof node !== 'object') return
		const cls = node.props?.className
		if (typeof cls === 'string' && cls.includes('dsh-llm-hub-hero__num')) {
			nums.push(textsOf(node).join(''))
		}
		if (Array.isArray(node.children)) node.children.forEach(walk)
	}
	walk(tree)
	return nums
}

let pluginDefinition = null
globalThis.window = { __ModuleLoader__: { load: (d) => { pluginDefinition = d } } }
globalThis.document = {
	getElementById: () => null,
	createElement: () => ({ textContent: '' }),
	head: { appendChild: () => {} },
	addEventListener: () => {},
	removeEventListener: () => {}
}
await import('../lib/client.js')
assert.ok(pluginDefinition, 'client 脚本没有通过 window.__ModuleLoader__.load 注册')
assert.equal(pluginDefinition.id, PKG_NAME, 'id 必须与 package.json 的 name 一致')

/**
 * 起一个插件实例，把 hero slot 渲染出来。
 * @param providers - availability 快照里的 providers 数组。
 */
const renderHero = (providers) => {
	const react = {
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
		useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
		useEffect: () => {},
		useCallback: (fn) => fn,
		useMemo: (fn) => fn(),
		useRef: (initial) => ({ current: initial === undefined ? null : initial }),
		useId: () => 'test-id',
		useSyncExternalStore: () => ({ providers, hidden: [] })
	}
	globalThis.fetch = async () => ({ status: 200, json: async () => ({ ok: true, providers: [], hidden: [] }) })

	const exports = pluginDefinition.factory((id) => {
		if (id === 'react') return react
		throw new Error('测试没准备这个模块: ' + id)
	})
	const slots = []
	const ctx = {
		locale: { register: () => {}, bind: () => (key) => key },
		slots: {
			inject: (_name, register) => register(),
			register: (meta, component) => { slots.push({ ...meta, component }); return () => {} }
		},
		effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
		inject: (deps, callback) => {
			if (deps.includes('remote')) callback({ remote: { $on: () => () => {} } })
		}
	}
	exports.apply(ctx)
	const hero = slots.find((slot) => slot.id === 'dsh-llm-hub-hero')
	assert.ok(hero, '应注册 hero slot')
	return hero.component({ ...hero.inject() })
}

test('Hero「可用模型」：载荷带 modelIds 时显示去重后的真实数量', () => {
	// 真载荷形状（2026-10-28 实测 127.0.0.1:52000 的真实响应）：
	// 两个 provider，modelIds 分别为 119 和 7，去重后 126。
	const nums = heroNumbers(renderHero([
		{ provider: 'magpie', displayName: 'Magpie', ns: 'llm-pi-ai', state: 'available', code: 'OK', source: 'probe', reason: '', latencyMs: 45, modelCount: 119, modelIds: Array.from({ length: 119 }, (_, i) => `m/${i}`) },
		{ provider: 'magpie-anthropic', displayName: 'Magpie Anthropic', ns: 'llm-pi-ai', state: 'available', code: 'OK', source: 'probe', reason: '', latencyMs: 120, modelCount: 7, modelIds: Array.from({ length: 7 }, (_, i) => `a/${i}`) }
	]))
	assert.ok(nums.length >= 4, 'hero 应有四张 KPI 卡，实际 ' + nums.length)
	assert.equal(nums[1], '126', '可用模型应为去重后的 126，实际 ' + nums[1])
	assert.notEqual(nums[1], '—', '可用模型不能是破折号')
})

test('Hero「可用模型」：同名模型跨 provider 重复时只算一次', () => {
	const nums = heroNumbers(renderHero([
		{ provider: 'a', state: 'available', latencyMs: 10, modelCount: 3, modelIds: ['x/1', 'x/2', 'x/3'] },
		{ provider: 'b', state: 'available', latencyMs: 20, modelCount: 3, modelIds: ['x/1', 'x/2', 'x/4'] }
	]))
	assert.equal(nums[1], '4', '去重后应是 4，实际 ' + nums[1])
})

test('Hero「可用模型」：只有 modelCount 时降级累加，也必须出数', () => {
	const nums = heroNumbers(renderHero([
		{ provider: 'a', state: 'available', latencyMs: 10, modelCount: 9 },
		{ provider: 'b', state: 'available', latencyMs: 20, modelCount: 57 }
	]))
	assert.equal(nums[1], '66', '降级累加应是 66，实际 ' + nums[1])
})

test('Hero「可用模型」：unavailable 的 provider 不计入', () => {
	const nums = heroNumbers(renderHero([
		{ provider: 'a', state: 'available', latencyMs: 10, modelIds: ['x/1', 'x/2'] },
		{ provider: 'b', state: 'unavailable', code: 'AUTH_REJECTED', latencyMs: 30, modelIds: ['y/1', 'y/2', 'y/3'] }
	]))
	assert.equal(nums[1], '2', '只算 available 的 2 个，实际 ' + nums[1])
})

test('Hero「可用模型」：没有模型信息时才是破折号（不是 0）', () => {
	const nums = heroNumbers(renderHero([
		{ provider: 'a', state: 'available', latencyMs: 10 }
	]))
	assert.equal(nums[1], '—', '无模型信息时应显示破折号，实际 ' + nums[1])
})
