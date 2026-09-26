/**
 * provider-sorter 模块纯函数单元测试（完全脱离宿主环境）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectBillingMode, sortProviders } from '../lib/sorter.js'

test('detectBillingMode：用户显式设置拥有最高覆盖权', () => {
	assert.equal(detectBillingMode({ billingMode: 'subscription', baseURL: 'https://api.deepseek.com' }), 'subscription')
	assert.equal(detectBillingMode({ billingMode: 'usage' }, null, { kind: 'plan' }), 'usage')
})

test('detectBillingMode：周期刷新限额识别为 subscription', () => {
	// 配额 resetsAt
	assert.equal(detectBillingMode({}, null, { items: [{ resetsAt: '2026-10-01' }] }), 'subscription')
	// 5小时限额或周期文案
	assert.equal(detectBillingMode({}, null, { items: [{ label: '5h 限额', percent: 80 }], meaning: 'remain' }), 'subscription')
	// weeklyPercent
	assert.equal(detectBillingMode({}, null, { items: [{ weeklyPercent: 50 }] }), 'subscription')
	// plan / quota 类型
	assert.equal(detectBillingMode({}, null, { kind: 'plan' }), 'subscription')
})

test('detectBillingMode：OpenCode Go 专属识别为 subscription', () => {
	assert.equal(detectBillingMode({ provider: 'opencode-go', baseURL: 'https://opencode.ai/zen/go/v1' }), 'subscription')
	assert.equal(detectBillingMode({ id: 'opencode' }), 'subscription')
})

test('detectBillingMode：中转站与原厂按量识别为 usage', () => {
	// 中转站
	assert.equal(detectBillingMode({ provider: 'modelgo', baseURL: 'https://api.modelgo.com' }), 'usage')
	assert.equal(detectBillingMode({ provider: 'my-relay' }), 'usage')
	// 原厂域名
	assert.equal(detectBillingMode({ baseURL: 'https://api.deepseek.com' }), 'usage')
	assert.equal(detectBillingMode({ baseURL: 'https://api.minimaxi.com/v1' }), 'usage')
	// 现金余额
	assert.equal(detectBillingMode({}, null, { kind: 'cash' }), 'usage')
})

test('sortProviders：套餐排在上面，按量排在下面，保持原序', () => {
	const list = [
		{ id: 'deepseek-official', name: 'DeepSeek' },
		{ id: 'opencode-go', name: 'OpenCode Go' },
		{ id: 'modelgo', name: 'ModelGo 中转' },
		{ id: 'minimax-coding', name: 'MiniMax Coding' }
	]

	const metas = {
		'deepseek-official': { available: true, billingMode: 'usage' },
		'opencode-go': { available: true, billingMode: 'subscription' },
		modelgo: { available: true, billingMode: 'usage' },
		'minimax-coding': { available: true, billingMode: 'subscription' }
	}

	const sorted = sortProviders(list, (id) => metas[id])
	const ids = sorted.map((p) => p.id)

	// 套餐排在最前面：opencode-go 与 minimax-coding 保留相对原序
	// 按量排在后面：deepseek-official 与 modelgo 保留相对原序
	assert.deepEqual(ids, ['opencode-go', 'minimax-coding', 'deepseek-official', 'modelgo'])
})

test('sortProviders：不可用沉底或过滤', () => {
	const list = [
		{ id: 'a-broken-sub' },
		{ id: 'b-live-usage' },
		{ id: 'c-live-sub' }
	]

	const metas = {
		'a-broken-sub': { available: false, billingMode: 'subscription' },
		'b-live-usage': { available: true, billingMode: 'usage' },
		'c-live-sub': { available: true, billingMode: 'subscription' }
	}

	// 1. 不过滤但沉底
	const sorted = sortProviders(list, (id) => metas[id])
	assert.deepEqual(sorted.map((p) => p.id), ['c-live-sub', 'b-live-usage', 'a-broken-sub'])

	// 2. filterUnavailable 为 true 时直接剔除
	const filtered = sortProviders(list, (id) => metas[id], { filterUnavailable: true })
	assert.deepEqual(filtered.map((p) => p.id), ['c-live-sub', 'b-live-usage'])
})
