/**
 * host 半多 key 轮换（1.4.0 新设计）的纯函数回归测试。
 *
 * 设计：
 *   - `pickRotatedEnv(refs, provider)` —— 输入 apiKeyEnv 字段（string 或 string[]），
 *     返 `{ ref, index, total }` 或 undefined。
 *   - 单 key：string → 总是返同一个 ref。
 *   - 多 key：string[] → 按 provider 维护索引 round-robin，每次调用推进 +1。
 *   - 空 / undefined：返 undefined（让 connectionFacts 走单 key fallback）。
 *
 * 不起 server / 不接 settings —— 内存复刻 lib/index.js 的 pickRotatedEnv。
 * lib 改时这里必须同步（comments 标了依据位置）。
 *
 * @module dsh-llm-hub/test/host-multi-key
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * 内存复刻 lib/index.js 的 pickRotatedEnv 逻辑 —— keyRotationIndex 是 per-test 的 Map。
 */
function makePickRotatedEnv(keyRotationIndex) {
	return (refs, provider) => {
		if (typeof refs === 'string' && refs.length > 0) {
			return { ref: refs, index: 0, total: 1 }
		}
		if (Array.isArray(refs)) {
			const list = refs.filter((r) => typeof r === 'string' && r.length > 0)
			if (list.length === 0) return undefined
			const current = keyRotationIndex.get(provider) ?? 0
			const index = current % list.length
			keyRotationIndex.set(provider, (current + 1) % list.length)
			return { ref: list[index], index, total: list.length }
		}
		return undefined
	}
}

test('pickRotatedEnv: 单 key string —— 永远返同一个 ref', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	const r1 = pick('DEEPSEEK_API_KEY_1', 'deepseek-official')
	const r2 = pick('DEEPSEEK_API_KEY_1', 'deepseek-official')
	const r3 = pick('DEEPSEEK_API_KEY_1', 'deepseek-official')
	assert.deepEqual(r1, { ref: 'DEEPSEEK_API_KEY_1', index: 0, total: 1 })
	assert.equal(r1.ref, r2.ref)
	assert.equal(r2.ref, r3.ref)
	assert.equal(idx.size, 0, '单 key 路径不应触碰索引')
})

test('pickRotatedEnv: 多 key array —— round-robin 推进 +1', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	const r1 = pick(['KEY_1', 'KEY_2', 'KEY_3'], 'deepseek-official')
	const r2 = pick(['KEY_1', 'KEY_2', 'KEY_3'], 'deepseek-official')
	const r3 = pick(['KEY_1', 'KEY_2', 'KEY_3'], 'deepseek-official')
	const r4 = pick(['KEY_1', 'KEY_2', 'KEY_3'], 'deepseek-official')
	assert.deepEqual(r1, { ref: 'KEY_1', index: 0, total: 3 })
	assert.deepEqual(r2, { ref: 'KEY_2', index: 1, total: 3 })
	assert.deepEqual(r3, { ref: 'KEY_3', index: 2, total: 3 })
	assert.deepEqual(r4, { ref: 'KEY_1', index: 0, total: 3 }, '循环回起点')
	assert.equal(idx.size, 1, '只一个 provider 的索引')
})

test('pickRotatedEnv: 不同 provider 各自维护索引，互不干扰', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	pick(['A1', 'A2'], 'a')
	pick(['A1', 'A2'], 'a')
	pick(['B1', 'B2'], 'b')
	const rA = pick(['A1', 'A2'], 'a')
	const rB = pick(['B1', 'B2'], 'b')
	assert.deepEqual(rA, { ref: 'A1', index: 0, total: 2 }, 'a 转 3 次：0→1→0→...返 index=0')
	assert.deepEqual(rB, { ref: 'B2', index: 1, total: 2 }, 'b 转 2 次：0→1，返 index=1')
})

test('pickRotatedEnv: 空数组 —— 返 undefined', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	const r = pick([], 'provider')
	assert.equal(r, undefined)
})

test('pickRotatedEnv: undefined / null —— 返 undefined', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	assert.equal(pick(undefined, 'p'), undefined)
	assert.equal(pick(null, 'p'), undefined)
})

test('pickRotatedEnv: array 含空字符串 —— 过滤掉', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	const r = pick(['A', '', 'B'], 'p')
	assert.deepEqual(r, { ref: 'A', index: 0, total: 2 }, '空字符串视为未配')
})

test('pickRotatedEnv: 全部空字符串 —— 返 undefined', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	assert.equal(pick(['', '', ''], 'p'), undefined)
})

test('pickRotatedEnv: 单元素 array —— 总是返同一个 ref', () => {
	const idx = new Map()
	const pick = makePickRotatedEnv(idx)
	const r1 = pick(['ONLY'], 'p')
	const r2 = pick(['ONLY'], 'p')
	const r3 = pick(['ONLY'], 'p')
	assert.deepEqual(r1, { ref: 'ONLY', index: 0, total: 1 })
	assert.equal(r1.ref, r2.ref)
	assert.equal(r2.ref, r3.ref)
})
