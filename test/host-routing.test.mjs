/**
 * host 半智能路由的纯函数回归测试。
 *
 * 三块：
 * 1) parseRouteEntry —— 「provider/model」字符串解析的边界；
 * 2) routingCandidatesOf —— settings 段下 primary + fallbacks[] 的形态校验；
 * 3) resolveRoute —— 给定 active + candidates + 状态，返回 recommendation 与 reason。
 *
 * 不接 storageDomain / llm service 也不起 server —— 用内存桩验语义。
 *
 * @module dsh-llm-hub/test/host-routing
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

/** 内存版 baseVerdicts Map（verdict = { provider, state, ... }）。 */
function createVerdictsMap(initial = []) {
	const map = new Map()
	for (const entry of initial) map.set(entry.provider, entry)
	return map
}

/**
 * 复刻 lib 里的纯函数（parseRouteEntry / stateFor / routingCandidatesOf / resolveRoute），
 * 因为它们在 lib 闭包里，测不出 export。lib 改这些函数时这里必须同步改 —— 否则
 * 这是「同一份逻辑的两个真相」，是技术债。注释里写明依据位置（lib/index.js）。
 */
function parseRouteEntry(entry) {
	if (typeof entry !== 'string') return undefined
	const ROUTE_KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i
	const ROUTE_MODEL_RE = /^[a-z0-9][a-z0-9_.+-]*$/i
	const slash = entry.indexOf('/')
	if (slash <= 0 || slash === entry.length - 1) return undefined
	const provider = entry.slice(0, slash).trim()
	const model = entry.slice(slash + 1).trim()
	if (!ROUTE_KEY_RE.test(provider) || !ROUTE_MODEL_RE.test(model)) return undefined
	return { provider, model }
}

function stateFor(map, provider, model) {
	// lib 里的语义：只按 provider 比，不区分 model —— 单 provider 内部任一 model
	// 的 state 是 provider-level 的判定。
	const verdict = map.get(provider)
	return verdict === undefined ? 'unknown' : verdict.state
}

function routingCandidatesOf(routing) {
	const r = routing !== null && typeof routing === 'object' ? routing : {}
	const out = []
	const primary = parseRouteEntry(r.primary)
	if (primary !== undefined) out.push(primary)
	const fallbacks = Array.isArray(r.fallbacks) ? r.fallbacks : []
	for (const fallback of fallbacks) {
		const parsed = parseRouteEntry(fallback)
		if (parsed !== undefined) out.push(parsed)
	}
	return out
}

function resolveRoute(map, routing, active) {
	const candidates = routingCandidatesOf(routing)
	const verdicts = new Map()
	for (const candidate of candidates) {
		verdicts.set(`${candidate.provider}/${candidate.model}`, stateFor(map, candidate.provider, candidate.model))
	}
	const activeParsed = active === undefined || active === null ? null : parseRouteEntry(active)
	const activeState = activeParsed === null
		? null
		: verdicts.get(`${activeParsed.provider}/${activeParsed.model}`) ?? stateFor(map, activeParsed.provider, activeParsed.model)
	const recommendation = candidates.find((c) => verdicts.get(`${c.provider}/${c.model}`) === 'available')
	const reason = candidates.length === 0
		? '尚未在 settings.dsh-llm-hub.routing 配置主力模型 / fallbacks'
		: (recommendation === undefined ? '主力与 fallbacks 全部不可用 —— 充值或换一个再说' : null)
	return {
		ok: true,
		active: activeParsed === null ? null : { provider: activeParsed.provider, model: activeParsed.model, state: activeState },
		candidates: candidates.map((c) => ({
			provider: c.provider, model: c.model, state: verdicts.get(`${c.provider}/${c.model}`) ?? 'unknown'
		})),
		recommendation: recommendation === undefined ? null : { provider: recommendation.provider, model: recommendation.model },
		reason
	}
}

test('parseRouteEntry：基本形态、空字符串、缺斜杠、非法字符', () => {
	assert.deepEqual(parseRouteEntry('modelgo/gpt-4o'), { provider: 'modelgo', model: 'gpt-4o' })
	assert.deepEqual(parseRouteEntry('  modelgo  /  gpt-4o  '), { provider: 'modelgo', model: 'gpt-4o' }, '容许两侧空白')
	assert.equal(parseRouteEntry(''), undefined)
	assert.equal(parseRouteEntry('modelgo'), undefined, '无斜杠')
	assert.equal(parseRouteEntry('/gpt-4o'), undefined, '缺 provider')
	assert.equal(parseRouteEntry('modelgo/'), undefined, '缺 model')
	assert.equal(parseRouteEntry('model go/gpt-4o'), undefined, 'provider 含空格被 ROUTE_KEY_RE 挡掉')
	assert.equal(parseRouteEntry('modelgo/gpt 4o'), undefined, 'model 含空格被 ROUTE_KEY_RE 挡掉')
	assert.equal(parseRouteEntry(null), undefined, 'null 输入')
	assert.equal(parseRouteEntry(123), undefined, '非字符串输入')
})

test('routingCandidatesOf：primary + fallbacks 都生效，非法项过滤', () => {
	const routing = {
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['deepseek-official/deepseek-chat', 'bad entry', 'modelgo/gpt-4o']
	}
	const out = routingCandidatesOf(routing)
	assert.deepEqual(out, [
		{ provider: 'minimax', model: 'abab5.5-chat' },
		{ provider: 'deepseek-official', model: 'deepseek-chat' },
		{ provider: 'modelgo', model: 'gpt-4o' }
	])
	assert.equal(out.length, 3, '非法项「bad entry」被过滤')
})

test('routingCandidatesOf：fallbacks 不是数组时只取 primary', () => {
	assert.deepEqual(routingCandidatesOf({ primary: 'a/b', fallbacks: 'not array' }), [{ provider: 'a', model: 'b' }])
	assert.deepEqual(routingCandidatesOf({ fallbacks: ['a/b'] }), [{ provider: 'a', model: 'b' }], '没 primary 时不报错')
	assert.deepEqual(routingCandidatesOf({}), [], 'routing 不存在返空数组')
	assert.deepEqual(routingCandidatesOf(null), [])
})

test('resolveRoute：未配置 routing → null recommendation + 友好 reason', () => {
	const result = resolveRoute(createVerdictsMap(), null, null)
	assert.equal(result.ok, true)
	assert.equal(result.recommendation, null)
	assert.equal(result.reason, '尚未在 settings.dsh-llm-hub.routing 配置主力模型 / fallbacks')
	assert.equal(result.candidates.length, 0)
})

test('resolveRoute：primary 不可用、fallback 可用 → 推荐 fallback', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'unavailable' },
		{ provider: 'deepseek-official', state: 'available' }
	])
	const result = resolveRoute(map, {
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['deepseek-official/deepseek-chat']
	}, 'minimax/abab5.5-chat')
	assert.equal(result.active.state, 'unavailable')
	assert.deepEqual(result.recommendation, { provider: 'deepseek-official', model: 'deepseek-chat' })
	assert.equal(result.reason, null)
})

test('resolveRoute：primary 可用 → 推荐 primary 自己（无需切）', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'available' }
	])
	const result = resolveRoute(map, {
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['deepseek-official/deepseek-chat']
	}, 'minimax/abab5.5-chat')
	assert.deepEqual(result.recommendation, { provider: 'minimax', model: 'abab5.5-chat' }, 'primary available 时推荐自己')
	assert.equal(result.reason, null)
})

test('resolveRoute：primary + fallbacks 全不可用 → null recommendation + 「全部不可用」', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'unavailable' },
		{ provider: 'deepseek-official', state: 'unavailable' }
	])
	const result = resolveRoute(map, {
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['deepseek-official/deepseek-chat']
	}, 'minimax/abab5.5-chat')
	assert.equal(result.recommendation, null)
	assert.equal(result.reason, '主力与 fallbacks 全部不可用 —— 充值或换一个再说')
})

test('resolveRoute：未探测到的 candidate 视为 unknown，但只要有 available 的就推', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'available' }
	])
	// fallbacks 里的 provider 不在 baseVerdicts 里（stateFor 返 'unknown'）
	const result = resolveRoute(map, {
		primary: 'minimax/abab5.5-chat',
		fallbacks: ['unseen/whatever']
	}, null)
	assert.deepEqual(result.recommendation, { provider: 'minimax', model: 'abab5.5-chat' })
	assert.equal(result.candidates[1].state, 'unknown', '未探测的 fallback 标 unknown，不算不可用')
})

test('resolveRoute：active 不在配置里时（用户瞎选了一个）active 还是会被解析出来', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'available' },
		{ provider: 'strange', state: 'unavailable' }
	])
	const result = resolveRoute(map, {
		primary: 'minimax/abab5.5-chat'
	}, 'strange/some-model')
	assert.deepEqual(result.active, { provider: 'strange', model: 'some-model', state: 'unavailable' })
	assert.deepEqual(result.recommendation, { provider: 'minimax', model: 'abab5.5-chat' }, '用户瞎选的不可用时照样推荐 primary')
})

test('resolveRoute：active 是 null 时（用户在 Settings 页没激活任何模型），只看 candidates', () => {
	const map = createVerdictsMap([
		{ provider: 'minimax', state: 'available' }
	])
	const result = resolveRoute(map, { primary: 'minimax/abab5.5-chat' }, null)
	assert.equal(result.active, null)
	assert.deepEqual(result.recommendation, { provider: 'minimax', model: 'abab5.5-chat' })
})