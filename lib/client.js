/**
 * dsh-llm-hub —— Client（浏览器）半。
 *
 * 在 **Models 设置页的 provider 卡片里** 显示 DeepSeek 账户余额与可用性；
 * 并为官方 pi-ai 路由（`llm-pi-ai` 段里的 modelgo / minimax / zai-coding-cn …）
 * 旁路补上网关可达性探测与目录拉取 —— 官方适配器占着自己的 discovery 坑、
 * 其 LISTABLE_PROTOCOLS 又不含 anthropic-messages，那部分缺口只能旁路补。
 *
 * ## 挂在哪
 *
 * 官方为"本仓库之外分发的插件"留了两个扩展位，本插件用的是
 * `settings.models.provider-card` —— 它**按 settings 命名空间做 key 分发**
 * （`entryKey = settingsNs`），所以注册 `key: 'llm-deepseek'` 就能收到
 * DeepSeek 官方直连那一张卡片的每次渲染，而 Models 页本身完全不知道我们是谁。
 * 官方文档（`slot-contract.d.ts`）原话：这两个座位就是给外部分发插件用的。
 *
 * 收到的 owner props 是 `{ provider, configured, keyConfigured }`，其中
 * `keyConfigured` 是本页的凭据 join 结果 —— 它决定我们要不要去查余额。
 *
 * ## 形态
 *
 * `classic script`：DSH 的 client 插件以 classic script 加载并由
 * `window.__ModuleLoader__.load({ id, factory })` 注册；**产物里不能出现顶层
 * import/export**，而 `factory(require)` 里的 `require` 才是拿 React 等模块的正路。
 * 因此本文件是源码即产物（无构建步骤，零依赖）。
 *
 * @module dsh-llm-hub/client
 */

window.__ModuleLoader__.load({
	// **必须是完整包名**（含 scope），宿主按 package.json 的 name 找这个注册 ——
	// 对不上就是 "loaded without registering ... via __ModuleLoader__.load"，
	// 而且整个 client bundle 一起失败（DSH 把所有插件打进一个 bundle），
	// 表现成「Failed to load plugins」，看不出是哪个插件的锅。
	//
	// 2026-09-17 踩到：上一版把包名迁到 @webkubor/ scope（commit f907589），
	// package.json 改了、这里漏了。同仓的 dsh-bloom-theme 用的是
	// PLUGIN_ID = "@webkubor/dsh-bloom-theme"，那个写法才是对的。
	id: '@dsh-plugins/dsh-llm-hub',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		const React = require('react')
		const h = React.createElement

		/** 与 host 半一致：官方直连适配器拥有的 settings 命名空间。 */
		const NS = 'dsh-llm-hub'
		/** 本插件注册进 provider-card 的 key —— 必须等于适配器的 settingsNs。 */
		const CARD_KEY = 'llm-deepseek'
		/** 官方直连的 provider id（见 dsh-llm-deepseek 的 PROVIDER）。 */
		const DEEPSEEK_PROVIDER = 'deepseek-official'
		/** host 半注册的余额路由。 */
		const BALANCE_URL = '/api/dsh-llm-hub/balance'
		/** 本插件为 pi-ai 路由注册进 provider-card 的 key —— 等于 pi-ai 的 settingsNs。 */
		const PIAI_CARD_KEY = 'llm-pi-ai'
		/** host 半的 pi-ai 旁路路由前缀。 */
		const PIAI_BASE = '/api/dsh-llm-hub/pi-ai'
		/** 插件元信息端点（版本 / 仓库 / 反馈）。 */
		const META_URL = '/api/dsh-llm-hub/meta'

		/** 模型可用性：读缓存 / 强制全量重探（host 半同名路由）。 */
		const AVAILABILITY_URL = '/api/dsh-llm-hub/availability'
		const AVAILABILITY_RECHECK_URL = '/api/dsh-llm-hub/availability/recheck'

		const LOCALES = {
			zh: {
				balance: '余额',
				loading: '查询中…',
				refresh: '刷新余额',
				retry: '重试',
				noKey: '未配置 API Key',
				noKeyHint: '在下方填入 DeepSeek API Key 后即可查询余额。',
				granted: '赠送',
				toppedUp: '充值',
				unavailable: '账户不可用',
				failed: '查询失败',
				probe: '探测网关',
				probing: '探测中…',
				reachable: '可达',
				unreachable: '不可达',
				remoteCount: '网关在售',
				configuredModels: '已配',
				modelsUnit: '个模型',
				keyMissing: '未配 Key',
				noBaseURLHint: '没填服务地址，探测不了；模型只能手填',
				pullCatalog: '拉取目录',
				pick: '选择要用的模型',
				save: '保存到配置',
				saving: '保存中…',
				saved: '已保存',
				saveFail: '保存失败',
				configured: '已配置',
				viewProject: 'GitHub',
				feedback: '问题反馈',
				share: '分享插件',
				shareCopied: '安装命令已复制',
				protocol: '协议',
				endpoint: '接入地址',
				pulling: '拉取中…',
				copyIds: '复制全部 id',
				copied: '已复制 id',
				copyFail: '复制失败',
				statusFail: '状态读取失败',
				statusLoading: '读取中…',
				remain: '余',
				used: '已用',
				week: '周',
				planQuota: '配额',
				availabilityRecheck: '重新探测全部',
				availabilityRechecking: '探测中…',
				availabilityHiddenCount: '已隐藏',
				availabilityUnavailable: '已从下拉隐藏',
				availabilityFailed: '可用性读取失败'
			},
			en: {
				balance: 'Balance',
				loading: 'Checking…',
				refresh: 'Refresh balance',
				retry: 'Retry',
				noKey: 'No API key',
				noKeyHint: 'Add a DeepSeek API key below to see the balance.',
				granted: 'Granted',
				toppedUp: 'Topped up',
				unavailable: 'Account unavailable',
				failed: 'Balance check failed',
				probe: 'Probe gateway',
				probing: 'Probing…',
				reachable: 'Reachable',
				unreachable: 'Unreachable',
				remoteCount: 'remote',
				configuredModels: 'configured',
				modelsUnit: 'models',
				keyMissing: 'No key',
				noBaseURLHint: 'No service address configured — probing unavailable, models are hand-typed',
				pullCatalog: 'Fetch catalog',
				pick: 'Pick models',
				save: 'Save to config',
				saving: 'Saving…',
				saved: 'Saved',
				saveFail: 'Save failed',
				configured: 'configured',
				viewProject: 'GitHub',
				feedback: 'Report an issue',
				share: 'Share',
				shareCopied: 'Install command copied',
				protocol: 'Protocol',
				endpoint: 'Endpoint',
				pulling: 'Fetching…',
				copyIds: 'Copy all ids',
				copied: 'Ids copied',
				copyFail: 'Copy failed',
				statusFail: 'Status check failed',
				statusLoading: 'Loading…',
				remain: 'left',
				used: 'used',
				week: 'wk',
				planQuota: 'quota',
				availabilityRecheck: 'Re-check all',
				availabilityRechecking: 'Checking…',
				availabilityHiddenCount: 'hidden',
				availabilityUnavailable: 'hidden from dropdown',
				availabilityFailed: 'Availability read failed'
			}
		}

		/** 词典未就绪时的兜底（键原样返回，绝不显示 undefined）。 */
		const fallbackT = (key) => (LOCALES.zh[key] ?? key)

		/** 注入一次卡片样式；用 DSH 主题变量，明暗自适应。 */
		function ensureStyle() {
			const id = 'dsh-llm-hub-style'
			if (document.getElementById(id) !== null) return
			const style = document.createElement('style')
			style.id = id
			style.textContent = [
				'.dsh-llm-hub-balance{display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
				'margin-top:8px;padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-balance__label{color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-balance__amount{color:var(--dsw-alias-label-primary);font-weight:600;',
				'font-variant-numeric:tabular-nums}',
				'.dsh-llm-hub-balance__breakdown{color:var(--dsw-alias-label-secondary);opacity:.8}',
				'.dsh-llm-hub-balance__warn{color:var(--dsw-alias-state-warn-primary)}',
				'.dsh-llm-hub-balance__error{color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-balance__spacer{flex:1 1 auto}',
				// 一张卡一个盒子：事实行 + 动作条。原来是两个盒子，白吃一行高度。
				'.dsh-llm-hub-balance--stack{flex-direction:column;align-items:stretch;gap:6px}',
				'.dsh-llm-hub-balance__facts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
				'.dsh-llm-hub-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-actions__button{box-sizing:border-box;height:24px;padding:0 10px;font:inherit;',
				'font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary);background:0 0;cursor:pointer;',
				'border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;white-space:nowrap}',
				'.dsh-llm-hub-actions__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
				'.dsh-llm-hub-actions__button:disabled{cursor:default;opacity:.5}',
				// 目录选择器：沿用卡片本身的 token，不引入新配色
				'.dsh-llm-hub-picker{margin-top:6px;padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
				'.dsh-llm-hub-picker__head{display:flex;align-items:center;justify-content:space-between;',
				'gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
				'.dsh-llm-hub-picker__list{max-height:220px;overflow-y:auto;display:flex;',
				'flex-direction:column;gap:2px}',
				'.dsh-llm-hub-picker__item{display:flex;align-items:center;gap:6px;font-size:12px;',
				'line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
				'.dsh-llm-hub-picker__id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
				'.dsh-llm-hub-foot{display:flex;align-items:center;gap:12px;margin-top:10px;',
				'padding:2px 2px;font-size:12px;color:var(--dsw-alias-label-secondary);opacity:.8}',
				'.dsh-llm-hub-foot__name{font-variant-numeric:tabular-nums}',
				'.dsh-llm-hub-foot__link{color:var(--dsw-alias-label-link);text-decoration:none;',
				'border:0;background:0 0;padding:0;font:inherit;cursor:pointer}',
				'.dsh-llm-hub-foot__link:hover{text-decoration:underline}',
				'.dsh-llm-hub-picker__tag{font-size:11px;padding:0 5px;border-radius:4px;',
				'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}',
				'.dsh-llm-hub-balance__button{border:0;background:0 0;padding:0;cursor:pointer;',
				'font-size:12px;color:var(--dsw-alias-brand-primary)}',
				'.dsh-llm-hub-balance__button:disabled{cursor:default;opacity:.5}',
				'.dsh-llm-hub-balance__tag{padding:1px 6px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);',
				'color:var(--dsw-alias-label-secondary);white-space:nowrap}',
				// 被摘掉的 provider：在它自己的卡片动作条里标一枚小片，不另开面板
				// （2026-09-16 owner：「这不是很多余吗，上面不都是显示了吗」）。
				'.dsh-llm-hub-chip{box-sizing:border-box;display:inline-flex;align-items:center;height:24px;padding:0 8px;',
				'border-radius:12px;font-size:12px;line-height:16px;white-space:nowrap;',
				'border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-chip--hidden{border-color:var(--dsw-alias-state-error-primary);',
				'color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-foot__hidden{color:var(--dsw-alias-state-error-primary)}',
			].join('')
			document.head.appendChild(style)
		}

		/**
		 * 余额卡：挂载即查，可手动刷新。
		 * @param props - owner props（provider/configured/keyConfigured）+ 注入的 `t`。
		 * @returns 一张紧凑的余额行。
		 */
		function BalanceCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const keyConfigured = props.keyConfigured !== false
			const [state, setState] = React.useState({ status: 'idle' })
			// 官方直连也可能被判不可用（key 被拒 / 账户欠费）。同一个状态片，一致的处理。
			const availability = props.availability
			const availabilityState = availability === undefined
				? { providers: [] }
				: React.useSyncExternalStore(availability.subscribe, availability.snapshot)
			const verdict = Array.isArray(availabilityState.providers)
				? availabilityState.providers.find((entry) => entry.provider === DEEPSEEK_PROVIDER)
				: undefined
			const hiddenFromDropdown = verdict !== undefined && verdict.state === 'unavailable'

			const load = React.useCallback(() => {
				if (!keyConfigured) {
					setState({ status: 'nokey' })
					return
				}
				setState({ status: 'loading' })
				fetch(BALANCE_URL, { headers: { accept: 'application/json' } })
					.then(async (response) => {
						let body
						try {
							body = await response.json()
						} catch {
							throw new Error(`HTTP ${response.status}`)
						}
						if (body == null || body.ok !== true) {
							throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
						}
						setState({ status: 'ok', isAvailable: body.isAvailable === true, balances: Array.isArray(body.balances) ? body.balances : [] })
					})
					.catch((error) => {
						setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
					})
			}, [keyConfigured])

			React.useEffect(() => {
				load()
			}, [load])

			const children = []
			children.push(h('span', { key: 'label', className: 'dsh-llm-hub-balance__label' }, t('balance')))
			if (hiddenFromDropdown) {
				children.push(h('span', {
					key: 'hidden-chip',
					className: 'dsh-llm-hub-chip dsh-llm-hub-chip--hidden',
					title: typeof verdict.reason === 'string' ? verdict.reason : ''
				}, t('availabilityUnavailable')))
			}

			if (state.status === 'nokey') {
				children.push(h('span', { key: 'nokey', className: 'dsh-llm-hub-balance__warn' }, t('noKey')))
				children.push(h('span', { key: 'hint', className: 'dsh-llm-hub-balance__breakdown' }, t('noKeyHint')))
				return h('div', { className: 'dsh-llm-hub-balance' }, children)
			}

			if (state.status === 'loading' || state.status === 'idle') {
				children.push(h('span', { key: 'loading', className: 'dsh-llm-hub-balance__breakdown' }, t('loading')))
				return h('div', { className: 'dsh-llm-hub-balance' }, children)
			}

			if (state.status === 'error') {
				children.push(h('span', { key: 'error', className: 'dsh-llm-hub-balance__error' }, `${t('failed')}: ${state.error}`))
				children.push(h('span', { key: 'spacer', className: 'dsh-llm-hub-balance__spacer' }))
				children.push(h('button', {
					key: 'retry',
					type: 'button',
					className: 'dsh-llm-hub-balance__button',
					onClick: load
				}, t('retry')))
				return h('div', { className: 'dsh-llm-hub-balance' }, children)
			}

			// status === 'ok'
			const primary = state.balances[0]
			if (primary === undefined) {
				children.push(h('span', { key: 'empty', className: 'dsh-llm-hub-balance__breakdown' }, t('loading')))
				return h('div', { className: 'dsh-llm-hub-balance' }, children)
			}
			const symbol = primary.currency === 'CNY' ? '¥' : primary.currency === 'USD' ? '$' : `${primary.currency} `
			children.push(h('span', { key: 'amount', className: 'dsh-llm-hub-balance__amount' }, `${symbol}${primary.total}`))
			if (!state.isAvailable) children.push(h('span', { key: 'unavail', className: 'dsh-llm-hub-balance__warn' }, t('unavailable')))
			const breakdown = []
			if (primary.granted !== '0' && primary.granted !== '0.00') breakdown.push(`${t('granted')} ${symbol}${primary.granted}`)
			if (primary.toppedUp !== '0' && primary.toppedUp !== '0.00') breakdown.push(`${t('toppedUp')} ${symbol}${primary.toppedUp}`)
			if (breakdown.length > 0) {
				children.push(h('span', { key: 'breakdown', className: 'dsh-llm-hub-balance__breakdown' }, breakdown.join(' · ')))
			}
			children.push(h('span', { key: 'spacer', className: 'dsh-llm-hub-balance__spacer' }))
			children.push(h('button', {
				key: 'refresh',
				type: 'button',
				className: 'dsh-llm-hub-balance__button',
				title: t('refresh'),
				onClick: load
			}, t('refresh')))
			return h('div', { className: 'dsh-llm-hub-balance' }, children)
		}

		/**
		 * 把 host 半的余额信封折成一行短文本；未加载 / 不支持时返回 null。
		 * reason 原样透传，因为 host 半保证它一定是人话（"未填写服务地址，查不了余额"、
		 * "连不上服务商"、上游自己的"当前用户不存在coding plan"）。技术细节在 detail 里，
		 * 这里**不展示** —— 设置页是给用人看的，2026-09-15 之前这里印过 fetch 的原始异常
		 * 「could not reach /api/...: Failed to parse URL from ...」，读的人既不知道发生了
		 * 什么，也不知道该做什么。
		 * @param balance - `/pi-ai/balance` 的载荷。
		 * @param t - 词典函数。
		 * @returns 短文本；不可展示时为 null。
		 */
		function renderBalance(balance, t) {
			if (balance === null || typeof balance !== 'object') return null
			if (balance.ok !== true || balance.supported === false) return null
			// 上游说「这个账号没有套餐」时，原样把它那句话印在卡片上是没有信息量的
			// （owner 2026-09-15：「当前用户不存在 coding plan 显示这个没意义」）——
			// 读到的人既不知道发生了什么，也不知道该做什么。没有配额就不显示配额，
			// 这一行上真正有用的是协议和接入地址，它们照常在。原因留给 title，排查时还能看到。
			if (balance.available === false) return null
			const items = Array.isArray(balance.items) ? balance.items : []
			if (items.length === 0) return null
			if (balance.kind === 'cash') {
				const first = items[0]
				const symbol = first.currency === 'CNY' ? '¥' : `${first.currency} `
				const voucher = typeof first.voucher === 'string' && first.voucher !== '0' && first.voucher !== '0.00' ? ` (${t('granted')} ${first.voucher})` : ''
				return `${t('balance')} ${symbol}${first.amount}${voucher}`
			}
			const meaning = balance.meaning === 'used' ? t('used') : t('remain')
			const parts = []
			for (const item of items.slice(0, 2)) {
				let piece = `${item.label} ${meaning} ${item.percent}%`
				if (typeof item.weeklyPercent === 'number') piece += ` · ${t('week')} ${meaning} ${item.weeklyPercent}%`
				parts.push(piece)
			}
			const level = typeof balance.level === 'string' && balance.level.length > 0 ? `${balance.level} · ` : ''
			return `${t('planQuota')} ${level}${parts.join(' / ')}`
		}

		/**
		 * pi-ai 旁路卡：挂在 `llm-pi-ai` 段的每个 provider 行上。
		 *
		 * 官方 pi-ai 适配器占着自己的 discovery 坑，本卡不与之竞争 —— 只通过
		 * host 半的旁路路由读网关目录与探测可达性。owner props 仍是
		 * `{ provider, configured, keyConfigured }`，`provider` 是段内键名；
		 * 「添加 provider」的草稿行没有 provider，此时渲染 null。
		 * @param props - owner props + 注入的 `t`。
		 * @returns 旁路状态行；无 provider 时为 null。
		 */
		function PiAiCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			// 宿主传进来的 `provider` 是 **entry 对象**（`{ provider, displayName, settingsNs,
			// settingsPath, declared }`），不是 provider id 字符串 —— 见宿主
			// dsh-client-ui-settings-models/lib/client.js 的三处 renderSlot：
			//     renderSlot('settings.models.provider-card', { provider: row.entry, ... })
			// 原来这里只认字符串，拿到对象就落进 '' 分支、直接 return null，于是整张
			// pi-ai 行静默消失：API 三个端点全通、插件版本也对，页面上就是什么都没有。
			// DeepSeek 那张卡看不出问题，因为它不读这个字段。
			// 两种形态都接：宿主将来改回字符串也不会再坏。
			const provider = typeof props.provider === 'string'
				? props.provider
				: (props.provider && typeof props.provider.provider === 'string' ? props.provider.provider : '')
			const [status, setStatus] = React.useState(null)
			const [probe, setProbe] = React.useState(null)
			const [catalog, setCatalog] = React.useState(null)
			// 勾选集合与保存态。selected 为 null 表示「还没开始挑」，此时用 status.modelIds
			// 作为初始勾选 —— 已经在用的模型默认勾上，人只需要动增量。
			const [selected, setSelected] = React.useState(null)
			const [saveState, setSaveState] = React.useState(null)
			const [copied, setCopied] = React.useState(false)
			const [balance, setBalance] = React.useState(null)
			// 被摘掉的分组，在它自己的卡片上直接标出来 —— 动作条里一枚小片，不占额外行。
			const availability = props.availability
			const availabilityState = availability === undefined
				? { hidden: [], providers: [] }
				: React.useSyncExternalStore(availability.subscribe, availability.snapshot)
			const verdict = Array.isArray(availabilityState.providers)
				? availabilityState.providers.find((entry) => entry.provider === provider)
				: undefined
			const hiddenFromDropdown = verdict !== undefined && verdict.state === 'unavailable'

			React.useEffect(() => {
				if (provider === '' || status === null || status.ok !== true || !status.balanceAdapter) return undefined
				let alive = true
				fetch(`${PIAI_BASE}/balance?provider=${encodeURIComponent(provider)}`, { headers: { accept: 'application/json' } })
					.then(async (response) => response.json())
					.then((body) => {
						if (alive) setBalance(body !== null && typeof body === 'object' ? body : { ok: false })
					})
					.catch(() => {
						if (alive) setBalance({ ok: false })
					})
				return () => {
					alive = false
				}
			}, [provider, status])

			React.useEffect(() => {
				if (provider === '') return undefined
				let alive = true
				fetch(`${PIAI_BASE}/status?provider=${encodeURIComponent(provider)}`, { headers: { accept: 'application/json' } })
					.then(async (response) => response.json())
					.then((body) => {
						if (alive) setStatus(body !== null && typeof body === 'object' && body.ok === true ? body : { ok: false, error: body?.error })
					})
					.catch(() => {
						if (alive) setStatus({ ok: false })
					})
				return () => {
					alive = false
				}
			}, [provider])

			const runProbe = React.useCallback(() => {
				if (provider === '') return
				setProbe({ phase: 'loading' })
				fetch(`${PIAI_BASE}/probe?provider=${encodeURIComponent(provider)}`, { headers: { accept: 'application/json' } })
					.then(async (response) => response.json())
					.then((body) => setProbe({ phase: 'done', body }))
					.catch((error) => setProbe({ phase: 'done', body: { ok: false, error: error instanceof Error ? error.message : String(error) } }))
			}, [provider])

			const pullCatalog = React.useCallback(() => {
				if (provider === '') return
				setCatalog({ phase: 'loading' })
				setCopied(false)
				fetch(`${PIAI_BASE}/catalog?provider=${encodeURIComponent(provider)}`, { headers: { accept: 'application/json' } })
					.then(async (response) => response.json())
					.then((body) => setCatalog({ phase: 'done', body }))
					.catch((error) => setCatalog({ phase: 'done', body: { ok: false, error: error instanceof Error ? error.message : String(error) } }))
			}, [provider])

			const copyIds = React.useCallback(() => {
				const body = catalog?.phase === 'done' ? catalog.body : undefined
				const models = body?.ok === true && Array.isArray(body.models) ? body.models : []
				if (models.length === 0) return
				navigator.clipboard?.writeText(models.map((model) => model.id).join('\n'))
					.then(() => setCopied(true))
					.catch(() => setCopied(false))
			}, [catalog])

			const saveModels = React.useCallback(() => {
				const ids = selected === null ? [] : [...selected]
				setSaveState('saving')
				fetch(`${PIAI_BASE}/models`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ provider, ids })
				})
					.then((res) => res.json())
					.then((body) => setSaveState(body?.ok === true ? 'done' : 'fail'))
					.catch(() => setSaveState('fail'))
			}, [provider, selected])

			if (provider === '') return null

			// 三态要分开：null 是「还没拉回来」，不是「失败」。
			// 2026-09-15 owner 报「为啥都显示状态读取失败」—— 页面一打开、或 DSH 刚重启
			// 导致这次 fetch 断掉时，三行全是这句，看着像插件坏了，其实只是还没加载完。
			if (status === null) {
				return h('div', { className: 'dsh-llm-hub-balance' },
					h('span', { className: 'dsh-llm-hub-balance__label' }, 'pi-ai'),
					h('span', { className: 'dsh-llm-hub-balance__breakdown' }, t('statusLoading')))
			}
			if (status.ok !== true) {
				return h('div', { className: 'dsh-llm-hub-balance' },
					h('span', { className: 'dsh-llm-hub-balance__label' }, 'pi-ai'),
					h('span', { className: 'dsh-llm-hub-balance__breakdown' }, typeof status.error === 'string' ? status.error : t('statusFail')))
			}

			// 事实行：一行装得下就一行，装不下让它自己换行。
			const facts = []
			facts.push(h('span', { key: 'label', className: 'dsh-llm-hub-balance__label' }, 'pi-ai'))
			facts.push(h('span', { key: 'name', className: 'dsh-llm-hub-balance__amount' }, status.displayName))
			facts.push(h('span', { key: 'count', className: 'dsh-llm-hub-balance__tag' }, `${t('configuredModels')} ${status.modelCount} ${t('modelsUnit')}`))
			facts.push(h('span', { key: 'key', className: 'dsh-llm-hub-balance__tag' }, status.keyConfigured === true ? 'Key ✓' : t('keyMissing')))
			// 协议与接入地址（2026-09-14 owner：「接入的协议和 apiurl 也需要可以看」）。
			// 这两项决定了这个 provider 到底连去哪、用哪套报文；出问题时第一眼要看的就是它们，
			// 之前只能去翻 settings.yaml。地址只显示域名，完整 URL 放 title —— 一行放不下，
			// 而域名已经够回答「连的是不是我以为的那个网关」。
			if (typeof status.api === 'string' && status.api !== '') {
				facts.push(h('span', { key: 'api', className: 'dsh-llm-hub-balance__tag' }, `${t('protocol')} ${status.api}`))
			}
			if (typeof status.baseURL === 'string' && status.baseURL !== '') {
				let host = status.baseURL
				try { host = new URL(status.baseURL).host } catch {}
				facts.push(h('span', {
					key: 'base',
					className: 'dsh-llm-hub-balance__tag',
					title: `${t('endpoint')}: ${status.baseURL}`
				}, host))
			}
			const balanceText = renderBalance(balance, t)
			if (balanceText !== null) facts.push(h('span', { key: 'bal', className: 'dsh-llm-hub-balance__tag' }, balanceText))

			// 动作行：**所有按钮挤在同一行**。
			//
			// 2026-09-16 owner 指着截图：「UI 是不是优化下，有点浪费空间，有的就是一个文字占一行」。
			// 原来是两个各自带边框+内边距的盒子：事实行末尾挂「探测网关」（宽度不够就换行），
			// 再另起一盒放「拉取目录」。一张卡白吃两行多。现在合成一个盒子、按钮排成一条工具条。
			const actions = []
			if (hiddenFromDropdown) {
				actions.push(h('span', {
					key: 'hidden-chip',
					className: 'dsh-llm-hub-chip dsh-llm-hub-chip--hidden',
					title: typeof verdict.reason === 'string' ? verdict.reason : ''
				}, t('availabilityUnavailable')))
			}
			const noBaseURL = status.baseURL === undefined || status.baseURL === ''
			const probeButton = (key, label, busy, onClick) => h('button', {
				key,
				type: 'button',
				className: 'dsh-llm-hub-actions__button',
				disabled: busy,
				onClick
			}, label)
			if (noBaseURL) {
				actions.push(h('span', { key: 'nobase', className: 'dsh-llm-hub-balance__breakdown' }, t('noBaseURLHint')))
			} else {
				const probing = probe !== null && probe.phase === 'loading'
				actions.push(probeButton('probe', probing ? t('probing') : t('probe'), probing, runProbe))
				if (probe !== null && probe.phase === 'done') {
					const body = probe.body
					if (body?.ok === true && body.reachable === true) {
						actions.push(h('span', { key: 'probe-ok', className: 'dsh-llm-hub-balance__breakdown' }, `${t('reachable')} · ${body.latencyMs}ms · ${t('remoteCount')} ${body.remoteCount}`))
					} else {
						actions.push(h('span', { key: 'probe-bad', className: 'dsh-llm-hub-balance__error' }, `${t('unreachable')}: ${body?.error ?? ''}`))
					}
				}
				// 目录拉取原先只对 modelgo 开放（它走 anthropic-messages，官方发现天然失效）。
				// 但「网关上到底有哪些模型」对每个 provider 都有用 —— 智谱手填 8 个、网关在售
				// 16 个，不拉一次根本不知道漏了什么。改为所有 pi-ai provider 都能拉。
				// 探测不到的（没 baseURL 又不在已知网关表里）点了会得到明确提示，不会静默。
				const pulling = catalog !== null && catalog.phase === 'loading'
				actions.push(probeButton('catalog', pulling ? t('pulling') : t('pullCatalog'), pulling, pullCatalog))
			}
			// 配额不可用时的上游原因不进正文，只留在 title 里（见 renderBalance 的注释）。
			const quotaNote = balance !== null && typeof balance === 'object' && balance.ok === true
				&& balance.available === false && typeof balance.reason === 'string' && balance.reason.length > 0
				? balance.reason
				: undefined

			let picker = null
			if (!noBaseURL && catalog !== null && catalog.phase === 'done') {
				const body = catalog.body
				if (body?.ok === true && Array.isArray(body.models)) {
					actions.push(h('span', { key: 'cat-count', className: 'dsh-llm-hub-balance__breakdown' }, `${t('remoteCount')} ${body.models.length} · ${body.latencyMs}ms`))
					actions.push(probeButton('copy', copied ? t('copied') : t('copyIds'), false, copyIds))

					// 拉到目录就把它摆出来。之前这里只报一个数字加「复制全部 id」，
					// 等于让人把 71 个 id 粘到配置文件里自己挑 —— 最后一公里留给了人。
					// 已配置的默认勾上，人只需要动增量。
					const configured = new Set(Array.isArray(status.modelIds) ? status.modelIds : [])
					const picked = selected === null ? configured : selected
					const toggle = (id) => {
						const next = new Set(picked)
						if (next.has(id)) next.delete(id)
						else next.add(id)
						setSelected(next)
						setSaveState(null)
					}
					picker = h('div', { className: 'dsh-llm-hub-picker' },
						h('div', { className: 'dsh-llm-hub-picker__head' },
							h('span', null, `${t('pick')}（${picked.size}/${body.models.length}）`),
							probeButton('save', saveState === 'saving' ? t('saving') : saveState === 'done' ? t('saved') : saveState === 'fail' ? t('saveFail') : t('save'), saveState === 'saving', saveModels)),
						h('div', { className: 'dsh-llm-hub-picker__list' },
							body.models.map((model) => h('label', { key: model.id, className: 'dsh-llm-hub-picker__item' },
								h('input', { type: 'checkbox', checked: picked.has(model.id), onChange: () => toggle(model.id) }),
								h('span', { className: 'dsh-llm-hub-picker__id' }, model.id),
								configured.has(model.id) ? h('span', { className: 'dsh-llm-hub-picker__tag' }, t('configured')) : null))))
				} else {
					actions.push(h('span', { key: 'cat-bad', className: 'dsh-llm-hub-balance__error' }, `${t('failed')}: ${body?.error ?? ''}`))
				}
			}
			return h('div', null,
				h('div', { className: 'dsh-llm-hub-balance dsh-llm-hub-balance--stack', title: quotaNote },
					h('div', { key: 'facts', className: 'dsh-llm-hub-balance__facts' }, facts),
					h('div', { key: 'actions', className: 'dsh-llm-hub-actions' }, actions)),
				picker)
		}

		/**
		 * 模型页页脚：插件版本 + 仓库 + 反馈入口。
		 *
		 * 2026-09-15 owner：「人家写的插件都有，你也加上，不然别人没有反馈，没法闭环」。
		 * 放在 settings.models.footer 而不是每张 provider 卡片上 —— 卡片有几个就会重复
		 * 几次，而这行信息整页只需要一份。
		 * @param props - 注入的 `t`。
		 * @returns 页脚节点；元信息读不到时返回 null（不占位、不报错）。
		 */
		function HubFooter(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const availability = props.availability
			const availabilityState = availability === undefined
				? { hidden: [], probing: false }
				: React.useSyncExternalStore(availability.subscribe, availability.snapshot)
			const [meta, setMeta] = React.useState(null)
			const [shared, setShared] = React.useState(false)
			const [busy, setBusy] = React.useState(false)
			React.useEffect(() => {
				let alive = true
				fetch(META_URL, { headers: { accept: 'application/json' } })
					.then((res) => res.json())
					.then((body) => { if (alive) setMeta(body) })
					.catch(() => { if (alive) setMeta({ ok: false }) })
				return () => { alive = false }
			}, [])
			if (meta === null || meta.ok !== true) return null
			const links = []
			// 一键分享：复制的是**能直接跑的安装命令**，不是一个仓库链接 ——
			// 拿到链接的人还要自己翻 README 找怎么装，等于把最后一步又推给了对方。
			links.push(h('button', {
				key: 'share',
				type: 'button',
				className: 'dsh-llm-hub-foot__link',
				onClick: () => {
					// 别写死我自己的 profile 名，也别只给一条 npm i —— 装进 node_modules
					// 不等于接进 boot graph，少了 bundles 那行插件根本不会加载。
					const text = [
						`${meta.name} —— DSH 模型页增强：网关可达性探测、余额/配额、模型目录勾选写回配置。`,
						'装到你的 DSH（profile 名按自己的改，默认 web）：',
						`  1) dsh plugin --profile web add ${meta.name}`,
						`  2) 把 "${meta.name}" 加进 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles`,
						'  3) 重启 DSH',
						typeof meta.homepage === 'string' ? `仓库：${meta.homepage}` : ''
					].filter((line) => line !== '').join('\n')
					navigator.clipboard?.writeText(text).then(() => setShared(true)).catch(() => setShared(false))
				}
			}, shared ? t('shareCopied') : t('share')))
			if (typeof meta.homepage === 'string') {
				links.push(h('a', { key: 'repo', href: meta.homepage, target: '_blank', rel: 'noreferrer', className: 'dsh-llm-hub-foot__link' }, t('viewProject')))
			}
			if (typeof meta.issues === 'string') {
				links.push(h('a', { key: 'issues', href: meta.issues, target: '_blank', rel: 'noreferrer', className: 'dsh-llm-hub-foot__link' }, t('feedback')))
			}
			const hiddenCount = Array.isArray(availabilityState.hidden) ? availabilityState.hidden.length : 0
			return h('div', { className: 'dsh-llm-hub-foot' },
				h('span', { className: 'dsh-llm-hub-foot__name' }, `${meta.name} v${meta.version}`),
				// 可用性只在页脚留这一处全局信息：被摘掉几个 + 一键重探。
				// 逐 provider 的判定不在这里重复 —— 上面每张卡片自己会说（2026-09-16 owner：
				// 「这不是很多余吗，上面不都是显示了吗」）。
				hiddenCount > 0
					? h('span', { key: 'hidden', className: 'dsh-llm-hub-foot__hidden' }, `${t('availabilityHiddenCount')} ${hiddenCount}`)
					: null,
				availability === undefined ? null : h('button', {
					key: 'recheck',
					type: 'button',
					className: 'dsh-llm-hub-foot__link',
					disabled: busy,
					onClick: () => {
						setBusy(true)
						availability.recheck().finally(() => setBusy(false))
					}
				}, busy ? t('availabilityRechecking') : t('availabilityRecheck')),
				links)
		}

		/**
		 * 可用性判定缓存 —— 所有会话共用一份（同一个 host、同一份设置）。
		 *
		 * 存在的意义：composer 的模型下拉里，不可用的分组是**静默消失**的（过滤发生在
		 * host 半的 llm.listProviders），所以「谁被摘掉了、为什么」必须另有一个地方
		 * 能看 —— 就是 设置 → 模型 的 footer 面板。
		 * @returns 带订阅的可用性存储。
		 */
		function createAvailabilityStore() {
			let state = { status: 'idle', checkedAt: 0, probing: false, providers: [], hidden: [], error: null }
			let retry = null
			const listeners = new Set()

			const publish = (next) => {
				state = next
				for (const listener of [...listeners]) {
					try {
						listener()
					} catch {
						// 某个订阅者自己炸了不该拖垮其他订阅者
					}
				}
			}

			let retryAttempt = 0
			const accept = (body) => {
				const providers = Array.isArray(body.providers) ? body.providers : []
				const probing = body.probing === true
				publish({
					status: 'ready',
					checkedAt: typeof body.checkedAt === 'number' ? body.checkedAt : 0,
					probing,
					providers,
					hidden: Array.isArray(body.hidden) ? body.hidden : [],
					error: null
				})
				// host 还在探（启动首轮，或某家网关卡住）：跟一次，别让人停在半份名单上。
				// 退避且封顶 —— 探针最长允许在途 STUCK_PROBE_MS，不能 1.5s 一次打满。
				if (!probing) {
					retryAttempt = 0
					return
				}
				if (retry !== null || retryAttempt >= 5) return
				retryAttempt += 1
				retry = setTimeout(() => {
					retry = null
					load()
				}, 1500 * retryAttempt)
			}

			// 读缓存与强制重探各有一条在途链：共用一条的话，点「重新探测全部」时若正好有
			// 一次读取在途，重探会被静默降级成读缓存 —— 按钮点了没反应，最难查的那种 bug。
			const inflight = { load: null, recheck: null }
			const request = (kind, url, init) => {
				if (inflight[kind] !== null) return inflight[kind]
				inflight[kind] = fetch(url, init)
					.then(async (response) => ({ response, body: await response.json().catch(() => null) }))
					.then(({ response, body }) => {
						if (body === null || typeof body !== 'object' || body.ok !== true) {
							throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
						}
						accept(body)
					})
					.catch((error) => {
						publish({ ...state, status: 'error', error: error instanceof Error ? error.message : String(error) })
					})
					.finally(() => {
						inflight[kind] = null
					})
				return inflight[kind]
			}

			const load = () => request('load', AVAILABILITY_URL, { headers: { accept: 'application/json' } })
			const recheck = () => request('recheck', AVAILABILITY_RECHECK_URL, { method: 'POST', headers: { accept: 'application/json' } })

			return {
				load,
				recheck,
				subscribe(listener) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				/** 快照身份只在 publish 时变化 —— useSyncExternalStore 要求这一点。 */
				snapshot: () => state,
				dispose() {
					if (retry !== null) clearTimeout(retry)
					retry = null
					listeners.clear()
				}
			}
		}

		const inject = ['slots', 'locale']

		/**
		 * 注册 provider 卡片扩展与词典。
		 * @param ctx - 插件上下文。
		 */
		function apply(ctx) {
			ensureStyle()
			ctx.effect(() => ctx.locale.register(NS, LOCALES), 'dsh-llm-hub: dictionaries')
			const t = ctx.locale.bind(NS)

			// 可用性判定：启动即拉一次（host 侧读缓存，很快），不能让用户先看到
			// 一堆本该隐藏的分组。
			const availability = createAvailabilityStore()
			availability.load()
			ctx.effect(() => () => availability.dispose(), 'dsh-llm-hub: availability cache')

			// 设置/凭据一变就重读判定：host 那边已把探针缓存作废，这一次读取会带回重探结果。
			// 少了这一步，在设置页改完 key 之后，面板会停在旧结论 —— 它只在挂载时读一次。
			ctx.inject(['remote'], (scope) => {
				const events = ['settings/document-updated', 'credentials/reference-updated', 'llm/adapters-updated']
				// 用插件自身的 ctx.effect 收尾，不依赖注入 scope 上也提供 effect
				ctx.effect(() => {
					const disposers = []
					for (const event of events) {
						try {
							const off = scope.remote.$on(event, () => {
								availability.load()
							})
							if (typeof off === 'function') disposers.push(off)
						} catch {
							// 该事件在这套组合里不可订阅：跳过，不影响其余刷新路径
						}
					}
					return () => {
						for (const off of disposers) {
							try {
								off()
							} catch {
								// 取消订阅失败无需处理
							}
						}
					}
				}, 'dsh-llm-hub: availability reload on settings/credential change')
			})

			ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
				name: 'settings.models.provider-card',
				key: CARD_KEY,
				locale: NS,
				inject: () => ({ t, availability })
			}, BalanceCard))
			ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
				name: 'settings.models.provider-card',
				key: PIAI_CARD_KEY,
				locale: NS,
				inject: () => ({ t, availability })
			}, PiAiCard))
			// settings.models.footer 的契约是 kind:'list'（见宿主 dsh-client-ui-settings-models
			// 的 children 声明），list 类 slot 注册**必须带 id** —— 参照宿主自己的
			// settings.onboarding 注册（id:'welcome-notice', order:-100）。
			// 第一版漏了 id，注册被静默丢弃：接口通、组件在、页面上什么都没有。
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-footer',
				order: 100,
				locale: NS,
				inject: () => ({ t, availability })
			}, HubFooter))
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
