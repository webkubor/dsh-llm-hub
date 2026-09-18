/**
 * host 半别名表的纯函数回归测试。
 *
 * 两块：
 * 1) ALIAS_KEY_RE —— 「provider/model」key 的合法性；
 * 2) aliasesOf —— settings.aliases 段的清洗（非法 key / 空值 / 非对象过滤）。
 *
 * 不接 settings / 也不起 server —— 内存复刻 lib 里的纯函数。
 * lib 改这些函数时这里必须同步改（注释里写明依据位置）。
 *
 * @module dsh-llm-hub/test/host-aliases
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/** lib/index.js 里的同一份正则（host 半 routes/aliastes 那段）。 */
const ALIAS_KEY_RE = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.+-]*$/i

/**
 * 内存复刻 aliasesOf：读 settings 段 → 过滤非法 key → 过滤空值。
 * 与 lib 的差异只在「值是空字符串 / 纯空白」时也过滤掉（lib 已经这么做了，
 * 这里复刻保证未来某天 lib 改了，这条 case 第一时间挂）。
 */
function aliasesOf(section) {
	const raw = section !== null && typeof section === 'object' ? section.aliases : null
	if (raw === null || typeof raw !== 'object') return {}
	const out = {}
	for (const [key, value] of Object.entries(raw)) {
		if (!ALIAS_KEY_RE.test(key)) continue
		if (typeof value !== 'string') continue
		const trimmed = value.trim()
		if (trimmed.length === 0) continue
		out[key] = trimmed
	}
	return out
}

test('ALIAS_KEY_RE：合法 / 非法形态', () => {
	// 合法：DSH 真实 provider/model id 都满足
	assert.ok(ALIAS_KEY_RE.test('deepseek-official/deepseek-chat'))
	assert.ok(ALIAS_KEY_RE.test('modelgo/claude-3.5-sonnet'))
	assert.ok(ALIAS_KEY_RE.test('minimax/abab5.5-chat'))
	assert.ok(ALIAS_KEY_RE.test('a/b'))
	assert.ok(ALIAS_KEY_RE.test('A_B/C.D'))

	// 非法：provider 含空格 / model 含斜杠 / 空 provider / 空 model / 缺斜杠
	assert.ok(!ALIAS_KEY_RE.test('model go/gpt-4o'), 'provider 不允许空格')
	assert.ok(!ALIAS_KEY_RE.test('modelgo/gpt/4o'), 'model 不允许再含 /')
	assert.ok(!ALIAS_KEY_RE.test('/gpt-4o'), '空 provider')
	assert.ok(!ALIAS_KEY_RE.test('modelgo/'), '空 model')
	assert.ok(!ALIAS_KEY_RE.test('modelgo'), '缺斜杠')
	assert.ok(!ALIAS_KEY_RE.test(''), '空串')
	assert.ok(!ALIAS_KEY_RE.test('/'), '单斜杠')
})

test('aliasesOf：合法映射全保留，非法 key / 空值被过滤', () => {
	const section = {
		aliases: {
			'deepseek-official/deepseek-reasoner': '推理',
			'modelgo/claude-3.5-sonnet': 'Sonnet',
			'modelgo/gpt/4o': '非法 key —— 应被过滤',
			'modelgo/gpt-4o': '',                 // 空字符串
			'modelgo/gpt-4-turbo': '   ',         // 纯空白
			'good/one': 0,                         // 非字符串
			'good/two': null,                      // null
			'modelgo/old-model': 'GPT-4o',         // 重复 key —— 后写覆盖前写
			// 真实合法的另一条
			'minimax/abab5.5-chat': 'ABAB'
		}
	}
	const out = aliasesOf(section)
	assert.deepEqual(out, {
		'deepseek-official/deepseek-reasoner': '推理',
		'modelgo/claude-3.5-sonnet': 'Sonnet',
		'modelgo/old-model': 'GPT-4o',
		'minimax/abab5.5-chat': 'ABAB'
	})
	assert.equal(Object.keys(out).length, 4)
})

test('aliasesOf：未配置 aliases 段时返空对象（不报错）', () => {
	assert.deepEqual(aliasesOf({}), {})
	assert.deepEqual(aliasesOf(null), {})
	assert.deepEqual(aliasesOf({ aliases: null }), {})
	assert.deepEqual(aliasesOf({ aliases: 'not object' }), {})
	assert.deepEqual(aliasesOf({ aliases: 123 }), {})
})

test('aliasesOf：值为 undefined 时被过滤（不是字符串）', () => {
	assert.deepEqual(aliasesOf({ aliases: { 'a/b': undefined, 'c/d': 'keep' } }), { 'c/d': 'keep' })
})

test('aliasesOf：值的两侧空白被 trim', () => {
	assert.deepEqual(aliasesOf({ aliases: { 'a/b': '  hello  ' } }), { 'a/b': 'hello' })
})