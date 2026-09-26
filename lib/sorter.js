/**
 * LLM Provider 优先级排序与计费模式决策引擎（纯逻辑层，零宿主依赖）。
 *
 * 核心规则：
 * 1. 可用性保障：不可用/熔断的 provider 沉底或过滤；
 * 2. 计费权重：套餐（subscription）排在上面，按量付费（usage）排在下面，
 *    确保从上往下选最容易优先消耗固定周期配额，节省按量现金；
 * 3. 计费识别：中转站默认按量，原厂默认按量，周期限额（5h/周/月/resetsAt/OpenCode Go）默认套餐，
 *    用户显式配置具有最高覆盖权。
 *
 * @module @dsh-plugins/dsh-llm-hub/sorter
 */

/**
 * 智能推断或读取某个 Provider 的计费模式。
 * @param {object} [profile] - 配置段对象（含 billingMode、baseURL、provider 等）
 * @param {object} [status] - 运行期状态（含 baseURL、api、billingMode 等）
 * @param {object} [balance] - 余额信封对象（含 kind, items, meaning 等）
 * @returns {'usage' | 'subscription'}
 */
export function detectBillingMode(profile, status, balance) {
	if (profile?.billingMode === 'usage' || profile?.billingMode === 'subscription') {
		return profile.billingMode
	}
	if (status?.billingMode === 'usage' || status?.billingMode === 'subscription') {
		return status.billingMode
	}
	if (balance && typeof balance === 'object') {
		if (balance.kind === 'plan' || balance.kind === 'quota') return 'subscription'
		if (Array.isArray(balance.items)) {
			for (const item of balance.items) {
				if (item?.resetsAt) return 'subscription'
				if (typeof item?.weeklyPercent === 'number') return 'subscription'
				if (item?.label && /(5h|hour|hourly|week|month|day|分|时|天|周|月)/i.test(item.label)) return 'subscription'
				if (typeof item?.percent === 'number' && balance.meaning) return 'subscription'
			}
		}
	}
	const providerName = String(profile?.provider || profile?.id || status?.provider || '').toLowerCase()
	const baseURL = String(status?.baseURL || profile?.baseURL || '').toLowerCase()

	// 特殊套餐/订阅服务商智能识别（如 OpenCode Go、各类 Coding Plan 等）
	if (providerName.includes('opencode') || baseURL.includes('opencode.ai') || providerName.includes('coding-plan')) {
		if (balance?.kind !== 'cash' && balance?.kind !== 'deepseek') {
			return 'subscription'
		}
	}

	// 中转站（无定时限额的聚合/反代如 modelgo, relay, proxy, oneapi 等）基本都是按量付费
	if (providerName.includes('modelgo') || providerName.includes('relay') || providerName.includes('proxy') || providerName.includes('oneapi') || providerName.includes('newapi') || providerName.includes('gateway')) {
		return 'usage'
	}

	// 厂商原厂域名或现金余额默认按量付费
	if (baseURL.includes('deepseek.com') || baseURL.includes('bigmodel.cn') || baseURL.includes('openai.com') || baseURL.includes('anthropic.com') || baseURL.includes('volces.com') || baseURL.includes('moonshot.cn') || baseURL.includes('minimax.chat') || baseURL.includes('baichuan-ai.com')) {
		return 'usage'
	}
	if (balance?.kind === 'cash' || balance?.kind === 'deepseek') {
		return 'usage'
	}
	return 'usage'
}

/**
 * 对 Provider 列表进行带权稳定排序。
 *
 * @param {Array<object>} providers - 原始 provider 数组（每个对象需含 id）
 * @param {function(string): { available?: boolean, billingMode?: 'usage' | 'subscription' }} getMeta - 获取元信息的回调
 * @param {object} [options]
 * @param {boolean} [options.filterUnavailable=false] - 是否直接剔除不可用的 provider
 * @returns {Array<object>} 排序（及可选过滤）后的新数组
 */
export function sortProviders(providers, getMeta, options = {}) {
	if (!Array.isArray(providers)) return []
	const filterUnavailable = options.filterUnavailable === true

	let list = providers
	if (filterUnavailable) {
		list = list.filter((p) => {
			const meta = getMeta(p?.id)
			return meta?.available !== false
		})
	}

	return [...list].sort((a, b) => {
		const metaA = getMeta(a?.id) || {}
		const metaB = getMeta(b?.id) || {}

		// 1. 可用性优先级（若未硬过滤）：可用排前，不可用排后
		const availA = metaA.available !== false ? 1 : 0
		const availB = metaB.available !== false ? 1 : 0
		if (availA !== availB) {
			return availB - availA
		}

		// 2. 计费模式优先级：套餐（subscription）排前，按量（usage）排后
		const scoreA = metaA.billingMode === 'subscription' ? 1 : 0
		const scoreB = metaB.billingMode === 'subscription' ? 1 : 0
		if (scoreA !== scoreB) {
			return scoreB - scoreA
		}

		// 3. 相同权重保持原有先后相对顺序（稳定排序）
		return 0
	})
}
