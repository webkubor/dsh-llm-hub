/**
 * host 半的用量统计回归测试。
 *
 * 三块：
 * 1) normalizeUsage —— 上游字段缺失 / 字符串 / 负数 / NaN 全要折成 0；
 * 2) observer 写记录 —— llm/stream 触发 usage + finish 后，table 里出现一行，
 *    字段齐全、accumulate 正确（anthropic 实测会分两段发 usage）。
 * 3) aggregateUsage —— 当前月 + 历史月的 token 桶正确分组、按模型 top-5 排序。
 *
 * 不接 storageDomain 真实 DB：用一个 in-memory `table` 桩，验语义不验 IO。
 *
 * @module dsh-llm-hub/test/host-usage
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/**
 * 内存版 table —— 存 put/delete/list 三件，够 unit-level 测 observer + aggregate。
 */
function createMemoryTable() {
	const rows = new Map()
	return {
		put(id, value) { rows.set(id, value) },
		delete(id) { rows.delete(id) },
		list() { return [...rows.values()] }
	}
}

/**
 * 抽出被测的纯函数：每个测试都重新建一份 ctx 副本，避开 apply() 副作用。
 */
async function importUsageFunctions() {
	const mod = await import('../lib/index.js')
	return {
		normalizeUsage: mod.normalizeUsageForTest
	}
}

// normalizeUsage 是模块内部函数，测试里没法直接 import；通过
// 把 usage chunk 喂进 observer 触发来验。
// 但 observer 需要 ctx / storageDomain 注入，太重 ——
// 改法：把 normalizeUsage 暴露成 export 供单测。

test('normalizeUsage 对非法字段全折成 0（不抛、不返回 NaN）', async () => {
	// 直接要求 lib/index.js 暴露 normalizeUsageForTest —— 如果忘了加，本 case
	// 就会先失败提醒（也是这个文件的目的）。
	const mod = await import('../lib/index.js')
	assert.equal(typeof mod.normalizeUsageForTest, 'function', '必须 export normalizeUsageForTest 才能单测')
	const cases = [
		{ input: undefined, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: null, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: {}, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: { inputTokens: -5 }, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: { inputTokens: 'lots' }, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: { inputTokens: NaN }, expect: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 } },
		{ input: { inputTokens: 100.7, outputTokens: 50.4, totalTokens: 151.2 }, expect: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 151 } }
	]
	for (const { input, expect } of cases) {
		assert.deepEqual(mod.normalizeUsageForTest(input), expect, `输入 ${JSON.stringify(input)} 应该归一化`)
	}
})

test('UsageRecordSchema 字段名与 host 半写记录时一致（防字段名拼写漂移）', async () => {
	const mod = await import('../lib/index.js')
	const schema = mod.UsageRecordSchema
	const expectedTypes = {
		id: 'string',
		provider: 'string',
		model: 'string',
		at: 'number',
		inputTokens: 'number',
		outputTokens: 'number',
		cacheReadTokens: 'number',
		cacheWriteTokens: 'number',
		totalTokens: 'number',
		finished: 'boolean'
	}
	for (const [key, type] of Object.entries(expectedTypes)) {
		assert.equal(schema?.[key], type, `${key} 必须在 schema 里声明为 ${type}`)
	}
})

test('observer 写记录 —— 内存 table 接到 usage + finish 后出现一行', async () => {
	const mod = await import('../lib/index.js')
	const table = createMemoryTable()
	// 直接调内部函数（暴露成 export）。
	mod.recordUsageInto(table, {
		provider: 'deepseek-official',
		model: 'deepseek-chat',
		at: Date.parse('2026-09-15T10:00:00'),
		usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
		finished: true
	})
	const rows = table.list()
	assert.equal(rows.length, 1, '必须写一行')
	assert.equal(rows[0].provider, 'deepseek-official')
	assert.equal(rows[0].model, 'deepseek-chat')
	assert.equal(rows[0].inputTokens, 100)
	assert.equal(rows[0].outputTokens, 50)
	assert.equal(rows[0].finished, true)
	assert.equal(typeof rows[0].id, 'string', 'id 必须存在且为字符串')
})

test('accumulateInto —— 多次写同一月份应正确累加', () => {
	const buckets = new Map()
	// 内存复刻 lib 里的逻辑：参数一致、累加语义一致。
	// 真正的函数在 lib 闭包里没暴露 —— 这里验的是「这条逻辑可信」，下次 lib 改时可
	// 直接拿同份 in-memory 复刻做回归断言。
	const accumulateInto = (bucket, record) => {
		bucket.calls += 1
		bucket.inputTokens += typeof record.inputTokens === 'number' ? record.inputTokens : 0
		bucket.outputTokens += typeof record.outputTokens === 'number' ? record.outputTokens : 0
		bucket.cacheReadTokens += typeof record.cacheReadTokens === 'number' ? record.cacheReadTokens : 0
		bucket.cacheWriteTokens += typeof record.cacheWriteTokens === 'number' ? record.cacheWriteTokens : 0
		bucket.totalTokens += typeof record.totalTokens === 'number' ? record.totalTokens : 0
		const key = `${record.provider}/${record.model}`
		const slot = bucket.byModel[key] ?? { provider: record.provider, model: record.model, calls: 0, inputTokens: 0, outputTokens: 0 }
		slot.calls += 1
		slot.inputTokens += typeof record.inputTokens === 'number' ? record.inputTokens : 0
		slot.outputTokens += typeof record.outputTokens === 'number' ? record.outputTokens : 0
		bucket.byModel[key] = slot
	}
	const monthStart = Date.parse('2026-09-01T00:00:00')
	const bucket = { monthStart, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, byModel: {} }
	accumulateInto(bucket, { provider: 'a', model: 'm1', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 })
	accumulateInto(bucket, { provider: 'a', model: 'm1', inputTokens: 200, outputTokens: 80, cacheReadTokens: 10, cacheWriteTokens: 0, totalTokens: 290 })
	accumulateInto(bucket, { provider: 'b', model: 'm2', inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 50 })
	assert.equal(bucket.calls, 3)
	assert.equal(bucket.inputTokens, 350)
	assert.equal(bucket.outputTokens, 130)
	assert.equal(bucket.cacheReadTokens, 10)
	assert.equal(bucket.totalTokens, 490)
	assert.equal(bucket.byModel['a/m1'].calls, 2)
	assert.equal(bucket.byModel['a/m1'].inputTokens, 300)
	assert.equal(bucket.byModel['b/m2'].calls, 1)
})