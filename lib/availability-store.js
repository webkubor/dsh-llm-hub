/**
 * LLM 网关可用性与健康度管理状态机（Circuit Breaker / Health Registry）。
 *
 * 职责：
 * 1. 维护基础探针判定（baseVerdicts）；
 * 2. 维护运行期遥测瞬时状态（runtimeMarks：401/402 触发不可用，请求成功触发恢复）；
 * 3. 聚合计算当前生效状态快照（currentAvailability）；
 * 4. 判定致命不可用黑名单（hiddenProviders），防止用户选到已坏死 provider 导致报错，
 *    同时对临时配额耗尽（QUOTA_EXHAUSTED）做避免死锁的保留设计。
 *
 * 零宿主依赖，纯内存状态机，便于独立测试与跨系统复用。
 *
 * @module @dsh-plugins/dsh-llm-hub/availability-store
 */

export const DEFAULT_RUNTIME_TTL_MS = 10 * 60 * 1000

/**
 * 判定某条判定结果是否属于致命凭据故障（应从下拉中完全隐藏）。
 * 只有明确的 CREDENTIAL_MISSING / AUTH_REJECTED / ACCOUNT_UNAVAILABLE 才隐藏；
 * 临时限额（QUOTA_EXHAUSTED）与现金为 0 绝不隐藏，避免选不到模型触发不了恢复的死锁。
 * @param {object} verdict
 * @returns {boolean}
 */
export function isDropDeadHidden(verdict) {
	if (verdict === null || typeof verdict !== 'object') return false
	if (verdict.state !== 'unavailable') return false
	const code = verdict.code
	return code === 'CREDENTIAL_MISSING' || code === 'AUTH_REJECTED' || code === 'ACCOUNT_UNAVAILABLE'
}

/**
 * 把真实请求的异常折成运行期标记。
 * @param {object} failure - { code, status, message }
 * @returns {{ code: string, reason: string } | undefined}
 */
export function classifyFailure(failure) {
	const code = typeof failure?.code === 'string' ? failure.code : ''
	const status = typeof failure?.status === 'number' ? failure.status : undefined
	if (code === 'INVALID_CREDENTIAL' || code === 'MISSING_CREDENTIAL' || status === 401 || status === 403) {
		return { code: 'AUTH_REJECTED', reason: '最近一次请求被拒（API key 缺失、无效或已过期）' }
	}
	if (code === 'QUOTA_EXCEEDED' || status === 402) {
		return { code: 'QUOTA_EXHAUSTED', reason: '最近一次请求因余额/配额耗尽失败' }
	}
	return undefined
}

export class AvailabilityStore {
	/**
	 * @param {object} [options]
	 * @param {number} [options.runtimeTtlMs]
	 */
	constructor(options = {}) {
		this.runtimeTtlMs = options.runtimeTtlMs ?? DEFAULT_RUNTIME_TTL_MS
		/** @type {Map<string, object>} */
		this.baseVerdicts = new Map()
		/** @type {Map<string, { code: string, reason: string, at: number }>} */
		this.runtimeMarks = new Map()
		/** @type {Map<string, number>} */
		this.successAt = new Map()
	}

	/** 记录静态探针结论 */
	setBaseVerdict(id, verdict) {
		if (!id) return
		this.baseVerdicts.set(id, { ...verdict, checkedAt: verdict?.checkedAt ?? Date.now() })
	}

	/** 获取某 provider 的静态探针结论 */
	getBaseVerdict(id) {
		return this.baseVerdicts.get(id)
	}

	/** 记录运行期请求失败 */
	recordFailure(id, failure) {
		if (!id) return false
		const mark = classifyFailure(failure)
		if (!mark) return false
		this.runtimeMarks.set(id, { ...mark, at: Date.now() })
		return true
	}

	/** 记录运行期请求成功（瞬时恢复） */
	recordSuccess(id, at = Date.now()) {
		if (!id) return
		this.successAt.set(id, at)
		this.runtimeMarks.delete(id)
	}

	/** 清理指定或全部状态 */
	clear() {
		this.baseVerdicts.clear()
		this.runtimeMarks.clear()
		this.successAt.clear()
	}

	/** 删除已下线的 provider 记录 */
	pruneMissing(liveIds) {
		const live = new Set(liveIds)
		for (const id of [...this.baseVerdicts.keys()]) {
			if (!live.has(id)) this.baseVerdicts.delete(id)
		}
		for (const id of [...this.runtimeMarks.keys()]) {
			if (!live.has(id)) this.runtimeMarks.delete(id)
		}
		for (const id of [...this.successAt.keys()]) {
			if (!live.has(id)) this.successAt.delete(id)
		}
	}

	/**
	 * 计算当前综合生效的所有 Provider 状态列表。
	 * 优先级：真实请求成功 > 运行期遥测失败 > 静态探针结论。
	 * @returns {Array<object>}
	 */
	currentAvailability() {
		const now = Date.now()
		const merged = new Map()
		for (const [id, verdict] of this.baseVerdicts) {
			merged.set(id, { ...verdict })
		}

		// 运行期标记覆盖
		for (const [id, mark] of [...this.runtimeMarks]) {
			if (now - mark.at >= this.runtimeTtlMs) {
				this.runtimeMarks.delete(id)
				continue
			}
			if ((this.successAt.get(id) ?? 0) > mark.at) continue
			const base = merged.get(id)
			merged.set(id, {
				provider: id,
				displayName: base?.displayName ?? id,
				ns: base?.ns,
				state: 'unavailable',
				code: mark.code,
				reason: mark.reason,
				source: 'runtime',
				checkedAt: mark.at
			})
		}

		// 运行期成功恢复
		for (const [id, at] of this.successAt) {
			const base = merged.get(id)
			if (base === undefined || base.state === 'available') continue
			if (now - at >= this.runtimeTtlMs || at <= (base.checkedAt ?? 0)) continue
			merged.set(id, { ...base, state: 'available', code: 'RECOVERED', reason: '', source: 'runtime', checkedAt: at })
		}

		return [...merged.values()].sort((left, right) => String(left.provider).localeCompare(String(right.provider)))
	}

	/**
	 * 获取当前应从下拉菜单彻底隐藏的 Provider ID 集合。
	 * @returns {Set<string>}
	 */
	hiddenProviders() {
		const hidden = new Set()
		for (const verdict of this.currentAvailability()) {
			if (isDropDeadHidden(verdict)) {
				hidden.add(verdict.provider)
			}
		}
		return hidden
	}
}
