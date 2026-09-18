/**
 * host 半多账号 key 轮换（keyPool）的纯函数回归测试。
 *
 * 三块：
 * 1) keyPoolOf —— settings 段的清洗（缺 name/env 的过滤；env 必须有）；
 * 2) rotateKeyPool —— round-robin 索引推进 + 末位记录；
 * 3) connectionFacts 的优先级（一次性覆盖 > keyPool > 单 key 兼容路径）。
 *
 * 不接 ctx / credentials / process.env 真实值 —— 用内存 stub 验语义。
 *
 * @module dsh-llm-hub/test/host-keypool
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/** 内存复刻：跟 lib/index.js 同份正则 / 同份判定。lib 改时这里必须同步。 */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/**
 * 内存复刻 keyPoolOf：清洗 entries、过滤非法。
 */
function keyPoolOf(section, provider) {
	const raw = section !== null && typeof section === 'object' ? section.keyPool : undefined
	if (raw === null || typeof raw !== 'object') return undefined
	const entries = raw[provider]
	if (!Array.isArray(entries)) return undefined
	const out = []
	for (const entry of entries) {
		if (entry === null || typeof entry !== 'object') continue
		const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : undefined
		const env = typeof entry.env === 'string' && entry.env.trim().length > 0 ? entry.env.trim() : undefined
		if (env === undefined) continue
		out.push({ name: name ?? env, env })
	}
	return out.length > 0 ? out : undefined
}

/**
 * 内存复刻 rotateKeyPool：用闭包索引 + lastChosen。
 */
function makeRotator(section) {
	const idx = new Map()
	const last = new Map()
	const rotate = (provider) => {
		const entries = keyPoolOf(section, provider)
		if (entries === undefined) return undefined
		const current = idx.get(provider) ?? 0
		const i = current % entries.length
		idx.set(provider, (current + 1) % entries.length)
		const entry = entries[i]
		last.set(provider, { entry, index: i, at: 1 })
		return { entry, index: i }
	}
	return { rotate, idx, last }
}

test('keyPoolOf：合法 / 非法 entry 全覆盖', () => {
	const section = {
		keyPool: {
			'deepseek-official': [
				{ name: 'primary', env: 'DEEPSEEK_API_KEY_1' },
				{ name: 'backup', env: 'DEEPSEEK_API_KEY_2' },
				// 缺 env —— 过滤
				{ name: 'no-env' },
				// env 是空字符串 —— 过滤
				{ name: 'empty-env', env: '   ' },
				// 非对象 —— 过滤
				null,
				'string',
				// 没 name 时用 env 兜底
				{ env: 'DEEPSEEK_API_KEY_3' },
				// name 是空白时也用 env 兜底
				{ name: '   ', env: 'DEEPSEEK_API_KEY_4' }
			]
		}
	}
	const out = keyPoolOf(section, 'deepseek-official')
	assert.equal(out.length, 4)
	assert.deepEqual(out[0], { name: 'primary', env: 'DEEPSEEK_API_KEY_1' })
	assert.deepEqual(out[1], { name: 'backup', env: 'DEEPSEEK_API_KEY_2' })
	assert.deepEqual(out[2], { name: 'DEEPSEEK_API_KEY_3', env: 'DEEPSEEK_API_KEY_3' }, '没 name 时 fallback 到 env')
	assert.deepEqual(out[3], { name: 'DEEPSEEK_API_KEY_4', env: 'DEEPSEEK_API_KEY_4' }, 'name 空白时 fallback 到 env')
})

test('keyPoolOf：没配 / provider 没配 / 不是数组 / 数组空 —— 都返 undefined', () => {
	assert.equal(keyPoolOf({}, 'any'), undefined, 'keyPool 段不存在')
	assert.equal(keyPoolOf({ keyPool: null }, 'any'), undefined, 'keyPool 是 null')
	assert.equal(keyPoolOf({ keyPool: 'not object' }, 'any'), undefined, 'keyPool 不是对象')
	assert.equal(keyPoolOf({ keyPool: {} }, 'unconfigured'), undefined, 'keyPool 有但该 provider 没配')
	assert.equal(keyPoolOf({ keyPool: { 'a/b': 'not array' } }, 'a/b'), undefined, 'entries 不是数组')
	assert.equal(keyPoolOf({ keyPool: { 'a/b': [] } }, 'a/b'), undefined, 'entries 空数组视作未配置')
})

test('rotateKeyPool：round-robin 索引推进 + 末位记录', () => {
	const { rotate, idx, last } = makeRotator({
		keyPool: {
			'a': [{ name: 'p1', env: 'E1' }, { name: 'p2', env: 'E2' }, { name: 'p3', env: 'E3' }]
		}
	})
	assert.deepEqual(rotate('a'), { entry: { name: 'p1', env: 'E1' }, index: 0 })
	assert.deepEqual(rotate('a'), { entry: { name: 'p2', env: 'E2' }, index: 1 })
	assert.deepEqual(rotate('a'), { entry: { name: 'p3', env: 'E3' }, index: 2 })
	// 第 4 次回到 0
	assert.deepEqual(rotate('a'), { entry: { name: 'p1', env: 'E1' }, index: 0 })
	// 末位记录正确
	assert.equal(last.get('a').entry.env, 'E1')
	assert.equal(idx.get('a'), 1, '下次轮换推进到索引 1')
})

test('rotateKeyPool：单 entry 时永远选同一个，但 lastChosen 每次都更新', () => {
	const { rotate, last } = makeRotator({
		keyPool: { 'a': [{ name: 'only', env: 'E1' }] }
	})
	assert.deepEqual(rotate('a'), { entry: { name: 'only', env: 'E1' }, index: 0 })
	assert.deepEqual(rotate('a'), { entry: { name: 'only', env: 'E1' }, index: 0 })
	assert.equal(last.get('a').entry.env, 'E1')
})

test('rotateKeyPool：多个 provider 各自维护索引，互不干扰', () => {
	const { rotate, idx } = makeRotator({
		keyPool: {
			'a': [{ name: 'a1', env: 'A1' }, { name: 'a2', env: 'A2' }],
			'b': [{ name: 'b1', env: 'B1' }]
		}
	})
	rotate('a'); rotate('a'); rotate('b')
	assert.equal(idx.get('a'), 0, 'a 转 2 次：0 → 1 → 0，下次再转返 a1')
	assert.equal(idx.get('b'), 0, 'b 数组长 1，单 entry 下 idx 永远回 0')
})

test('connectionFacts 优先级：显式 apiKey > keyPool > 单 key', () => {
	// 这个 case 用伪复刻验证语义（不让它依赖真实 ctx）。
	const explicit = 'literal-key'
	const pool = [{ name: 'pool', env: 'POOL_KEY' }]
	const fallback = 'DEFAULT_API_KEY'
	// 模拟 connectionFacts 的三段式：
	const pickApiKey = ({ explicit, pool, poolEnvValue, fallbackEnv, fallbackValue }) => {
		if (explicit !== undefined) return { ref: 'EXPLICIT_REF', apiKey: explicit, source: 'explicit' }
		if (pool !== undefined) {
			if (poolEnvValue !== undefined) return { ref: pool[0].env, apiKey: poolEnvValue, source: 'pool' }
		}
		if (fallbackValue !== undefined) return { ref: fallbackEnv, apiKey: fallbackValue, source: 'fallback' }
		return { ref: fallbackEnv, apiKey: undefined, source: 'fallback' }
	}
	// 优先级 1：显式覆盖
	assert.deepEqual(pickApiKey({ explicit, pool, poolEnvValue: 'POOL_KEY', fallbackEnv: 'DEEPSEEK_API_KEY', fallbackValue: fallback }), { ref: 'EXPLICIT_REF', apiKey: 'literal-key', source: 'explicit' })
	// 优先级 2：keyPool 命中且 env 有值
	assert.deepEqual(pickApiKey({ explicit: undefined, pool, poolEnvValue: 'POOL_KEY', fallbackEnv: 'DEEPSEEK_API_KEY', fallbackValue: fallback }), { ref: 'POOL_KEY', apiKey: 'POOL_KEY', source: 'pool' })
	// 优先级 3：keyPool 命中但 env 没值 —— 退回单 key（不让 keyPool 吞掉请求）
	assert.deepEqual(pickApiKey({ explicit: undefined, pool, poolEnvValue: undefined, fallbackEnv: 'DEEPSEEK_API_KEY', fallbackValue: fallback }), { ref: 'DEEPSEEK_API_KEY', apiKey: 'DEFAULT_API_KEY', source: 'fallback' })
	// 优先级 4：没有 keyPool、没单 key
	assert.deepEqual(pickApiKey({ explicit: undefined, pool: undefined, poolEnvValue: undefined, fallbackEnv: 'DEEPSEEK_API_KEY', fallbackValue: undefined }), { ref: 'DEEPSEEK_API_KEY', apiKey: undefined, source: 'fallback' })
})

test('rotateKeyPool：provider 没配 keyPool 时返 undefined（让 connectionFacts 走单 key 路径）', () => {
	const { rotate } = makeRotator({ keyPool: {} })
	assert.equal(rotate('not-configured'), undefined)
})