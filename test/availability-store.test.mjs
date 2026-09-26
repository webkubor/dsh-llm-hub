/**
 * availability-store 模块单元测试（脱离宿主环境）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AvailabilityStore, isDropDeadHidden, classifyFailure } from '../lib/availability-store.js'

test('isDropDeadHidden：只有致命凭据故障才进入隐藏黑名单', () => {
	// 致命凭据故障：必须隐藏
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'CREDENTIAL_MISSING' }), true)
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'AUTH_REJECTED' }), true)
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'ACCOUNT_UNAVAILABLE' }), true)

	// 临时配额耗尽 / 欠费：绝不隐藏（避免死锁）
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'QUOTA_EXHAUSTED' }), false)
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'BALANCE_EMPTY' }), false)
	assert.equal(isDropDeadHidden({ state: 'unavailable', code: 'PAYMENT_REQUIRED' }), false)

	// 正常可用或未知状态：不隐藏
	assert.equal(isDropDeadHidden({ state: 'available', code: 'OK' }), false)
	assert.equal(isDropDeadHidden({ state: 'unknown', code: 'UNREACHABLE' }), false)
})

test('classifyFailure：正确归类运行期异常', () => {
	assert.equal(classifyFailure({ status: 401 })?.code, 'AUTH_REJECTED')
	assert.equal(classifyFailure({ status: 403 })?.code, 'AUTH_REJECTED')
	assert.equal(classifyFailure({ code: 'INVALID_CREDENTIAL' })?.code, 'AUTH_REJECTED')
	assert.equal(classifyFailure({ code: 'MISSING_CREDENTIAL' })?.code, 'AUTH_REJECTED')

	assert.equal(classifyFailure({ status: 402 })?.code, 'QUOTA_EXHAUSTED')
	assert.equal(classifyFailure({ code: 'QUOTA_EXCEEDED' })?.code, 'QUOTA_EXHAUSTED')

	// 普通业务异常（如上下文超长）不标记为故障
	assert.equal(classifyFailure({ code: 'CONTEXT_LENGTH_EXCEEDED', status: 400 }), undefined)
})

test('AvailabilityStore：静态判定、运行期失败覆盖与请求成功恢复', () => {
	const store = new AvailabilityStore()

	// 1. 静态判定录入
	store.setBaseVerdict('deepseek-official', { provider: 'deepseek-official', state: 'available', code: 'OK' })
	store.setBaseVerdict('modelgo', { provider: 'modelgo', state: 'unavailable', code: 'CREDENTIAL_MISSING' })
	assert.deepEqual([...store.hiddenProviders()], ['modelgo'])

	// 2. 运行期错误遥测覆盖
	store.recordFailure('deepseek-official', { status: 401 })
	const list = store.currentAvailability()
	const ds = list.find((item) => item.provider === 'deepseek-official')
	assert.equal(ds.state, 'unavailable')
	assert.equal(ds.code, 'AUTH_REJECTED')
	assert.equal(ds.source, 'runtime')
	assert.ok(store.hiddenProviders().has('deepseek-official'), '运行期 401 触发进入隐藏名单')

	// 3. 运行期真实请求成功瞬间恢复
	store.recordSuccess('deepseek-official', Date.now() + 10)
	const listAfter = store.currentAvailability()
	const dsAfter = listAfter.find((item) => item.provider === 'deepseek-official')
	assert.equal(dsAfter.state, 'available')
	assert.equal(store.hiddenProviders().has('deepseek-official'), false, '请求成功瞬间移出隐藏名单')
})
