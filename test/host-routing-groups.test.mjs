/**
 * host 半「智能路由组」的真源纯函数回归测试。
 *
 * 三块：
 * 1) parseRouteEntryPure —— provider/model 字符串解析（closure 版的委托目标）；
 * 2) parseRoutingGroups —— settings.routing 段折成路由组（groups/legacy flat）；
 * 3) pickSmartRoute —— smart 模式的请求裁决（跳过不可用、fail-open）。
 *
 * @module dsh-llm-hub/test/host-routing-groups
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRouteEntryPure, parseRoutingGroups, pickSmartRoute } from '../lib/index.js'

test('parseRouteEntryPure：基本形态与边界（与 closure 版同语义）', () => {
	assert.deepEqual(parseRouteEntryPure('modelgo/gpt-4o'), { provider: 'modelgo', model: 'gpt-4o' })
	assert.deepEqual(parseRouteEntryPure('  modelgo  /  gpt-4o '), { provider: 'modelgo', model: 'gpt-4o' }, '容许两侧空白')
	assert.equal(parseRouteEntryPure(''), undefined)
	assert.equal(parseRouteEntryPure('modelgo'), undefined, '无斜杠')
	assert.equal(parseRouteEntryPure('/gpt-4o'), undefined, '缺 provider')
	assert.equal(parseRouteEntryPure('modelgo/'), undefined, '缺 model')
	assert.equal(parseRouteEntryPure(null), undefined, 'null 输入')
})

test('parseRoutingGroups：groups 数组形态，label/fallbacks 解析与 id 去重', () => {
	const result = parseRoutingGroups({
		mode: 'smart',
		activeGroup: 'personal',
		groups: [
			{ id: 'company', label: '公司', primary: 'modelgo/gpt-4o', fallbacks: ['modelgo/claude-3.5-sonnet', 'bad entry'] },
			{ id: 'personal', primary: 'deepseek-official/deepseek-chat', fallbacks: ['minimax/MiniMax-M2.7'] },
			{ id: 'company', primary: 'dup/should-skip' }
		]
	})
	assert.equal(result.mode, 'smart')
	assert.equal(result.activeGroup, 'personal')
	assert.equal(result.groups.length, 2, '重复 id 的组被去掉')
	assert.deepEqual(result.groups[0], {
		id: 'company',
		label: '公司',
		primary: { provider: 'modelgo', model: 'gpt-4o' },
		fallbacks: [{ provider: 'modelgo', model: 'claude-3.5-sonnet' }]
	}, '非法 fallback 被过滤')
	assert.equal(result.groups[1].label, null, '没有 label 时为 null（UI 退回显示 id）')
})

test('parseRoutingGroups：legacy flat primary/fallbacks 折成 default 组', () => {
	const result = parseRoutingGroups({
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['deepseek-official/deepseek-chat']
	})
	assert.equal(result.mode, 'manual', 'no mode 缺省 manual')
	assert.deepEqual(result.groups, [{
		id: 'default',
		label: null,
		primary: { provider: 'minimax', model: 'abab5.5-chat' },
		fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-chat' }]
	}])
	assert.equal(result.activeGroup, 'default')
})

test('parseRoutingGroups：activeGroup 声明不存在时回退第一组', () => {
	const result = parseRoutingGroups({
		activeGroup: 'nowhere',
		groups: [
			{ id: 'a', primary: 'a/x' },
			{ id: 'b', primary: 'b/y' }
		]
	})
	assert.equal(result.activeGroup, 'a')
})

test('parseRoutingGroups：全空输入 → 空配置', () => {
	assert.deepEqual(parseRoutingGroups(undefined), { groups: [], mode: 'manual', activeGroup: '' })
	assert.deepEqual(parseRoutingGroups(null), { groups: [], mode: 'manual', activeGroup: '' })
	assert.deepEqual(parseRoutingGroups({ groups: 'not array' }), { groups: [], mode: 'manual', activeGroup: '' })
	assert.deepEqual(parseRoutingGroups({ groups: [{ id: 'ghost' }] }), { groups: [], mode: 'manual', activeGroup: '' }, '没有候选的组不算')
})

test('pickSmartRoute：primary 可用 → 不切（保持低延迟，也不折腾 model 目录）', () => {
	const decision = pickSmartRoute(
		[{ provider: 'modelgo', model: 'gpt-4o' }, { provider: 'deepseek-official', model: 'deepseek-chat' }],
		(p) => p === 'modelgo' ? 'available' : 'unknown',
		{ provider: 'modelgo', model: 'gpt-4o' }
	)
	assert.equal(decision.switched, false)
	assert.equal(decision.to, null)
	assert.equal(decision.reason, null)
})

test('pickSmartRoute：额度耗尽（unavailable）→ 跳到第一个可用的 fallback', () => {
	const decision = pickSmartRoute(
		[{ provider: 'modelgo', model: 'gpt-4o' }, { provider: 'minimax', model: 'MiniMax-M2.7' }, { provider: 'zhipu', model: 'glm-4.7' }],
		(p) => p === 'modelgo' ? 'unavailable' : (p === 'minimax' ? 'unknown' : 'available'),
		{ provider: 'modelgo', model: 'gpt-4o' }
	)
	// minimax unknown 站得住（unknown 不算不可用），primary 在前所以选 minimax。
	assert.equal(decision.switched, true)
	assert.deepEqual(decision.to, { provider: 'minimax', model: 'MiniMax-M2.7' })
	assert.equal(decision.reason, null)
})

test('pickSmartRoute：全部不可用 → fail-open 保持原配置 + reason', () => {
	const decision = pickSmartRoute(
		[{ provider: 'a', model: 'x' }, { provider: 'b', model: 'y' }],
		() => 'unavailable',
		{ provider: 'a', model: 'x' }
	)
	assert.equal(decision.switched, false)
	assert.equal(decision.to, null)
	assert.equal(decision.reason, '主力与 fallbacks 全部不可用 —— 充值或换一个再说')
})

test('pickSmartRoute：候选为空 → fail-open + 引导 reason', () => {
	const decision = pickSmartRoute([], () => 'available', { provider: 'a', model: 'x' })
	assert.equal(decision.switched, false)
	assert.equal(decision.to, null)
	assert.match(decision.reason, /没有可用候选/)
})

test('pickSmartRoute：active 不在候选里时按组顺序接管（完全接管语义）', () => {
	// 用户在下拉里选了 deepseek，但激活组的 primary 是别的可用 provider —— 接管生效。
	const decision = pickSmartRoute(
		[{ provider: 'modelgo', model: 'gpt-4o' }],
		() => 'available',
		{ provider: 'deepseek-official', model: 'deepseek-chat' }
	)
	assert.equal(decision.switched, true)
	assert.deepEqual(decision.to, { provider: 'modelgo', model: 'gpt-4o' })
})
