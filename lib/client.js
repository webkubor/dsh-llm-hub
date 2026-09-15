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
	id: 'dsh-llm-hub',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		const React = require('react')
		const h = React.createElement

		/** 与 host 半一致：官方直连适配器拥有的 settings 命名空间。 */
		const NS = 'dsh-llm-hub'
		/** 本插件注册进 provider-card 的 key —— 必须等于适配器的 settingsNs。 */
		const CARD_KEY = 'llm-deepseek'
		/** host 半注册的余额路由。 */
		const BALANCE_URL = '/api/dsh-llm-hub/balance'
		/** 本插件为 pi-ai 路由注册进 provider-card 的 key —— 等于 pi-ai 的 settingsNs。 */
		const PIAI_CARD_KEY = 'llm-pi-ai'
		/** host 半的 pi-ai 旁路路由前缀。 */
		const PIAI_BASE = '/api/dsh-llm-hub/pi-ai'

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
				pulling: '拉取中…',
				copyIds: '复制全部 id',
				copied: '已复制 id',
				copyFail: '复制失败',
				statusFail: '状态读取失败',
				statusLoading: '读取中…',
				remain: '余',
				used: '已用',
				week: '周',
				planQuota: '配额'
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
				pulling: 'Fetching…',
				copyIds: 'Copy all ids',
				copied: 'Ids copied',
				copyFail: 'Copy failed',
				statusFail: 'Status check failed',
				statusLoading: 'Loading…',
				remain: 'left',
				used: 'used',
				week: 'wk',
				planQuota: 'quota'
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
				'.dsh-llm-hub-picker__tag{font-size:11px;padding:0 5px;border-radius:4px;',
				'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}',
				'.dsh-llm-hub-balance__button{border:0;background:0 0;padding:0;cursor:pointer;',
				'font-size:12px;color:var(--dsw-alias-brand-primary)}',
				'.dsh-llm-hub-balance__button:disabled{cursor:default;opacity:.5}',
				'.dsh-llm-hub-balance__tag{padding:1px 6px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);',
				'color:var(--dsw-alias-label-secondary);white-space:nowrap}'
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
			if (balance.available === false) {
				return typeof balance.reason === 'string' && balance.reason.length > 0 ? balance.reason : null
			}
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

			const row = []
			row.push(h('span', { key: 'label', className: 'dsh-llm-hub-balance__label' }, 'pi-ai'))
			row.push(h('span', { key: 'name', className: 'dsh-llm-hub-balance__amount' }, status.displayName))
			row.push(h('span', { key: 'count', className: 'dsh-llm-hub-balance__tag' }, `${t('configuredModels')} ${status.modelCount} ${t('modelsUnit')}`))
			row.push(h('span', { key: 'key', className: 'dsh-llm-hub-balance__tag' }, status.keyConfigured === true ? 'Key ✓' : t('keyMissing')))
			const balanceText = renderBalance(balance, t)
			if (balanceText !== null) row.push(h('span', { key: 'bal', className: 'dsh-llm-hub-balance__tag' }, balanceText))

			if (status.baseURL === undefined || status.baseURL === '') {
				row.push(h('span', { key: 'nobase', className: 'dsh-llm-hub-balance__breakdown' }, t('noBaseURLHint')))
				return h('div', { className: 'dsh-llm-hub-balance' }, row)
			}

			row.push(h('span', { key: 'spacer', className: 'dsh-llm-hub-balance__spacer' }))
			const probing = probe !== null && probe.phase === 'loading'
			row.push(h('button', {
				key: 'probe',
				type: 'button',
				className: 'dsh-llm-hub-balance__button',
				disabled: probing,
				onClick: runProbe
			}, probing ? t('probing') : t('probe')))
			if (probe !== null && probe.phase === 'done') {
				const body = probe.body
				if (body?.ok === true && body.reachable === true) {
					row.push(h('span', { key: 'probe-ok', className: 'dsh-llm-hub-balance__breakdown' }, `${t('reachable')} · ${body.latencyMs}ms · ${t('remoteCount')} ${body.remoteCount}`))
				} else {
					row.push(h('span', { key: 'probe-bad', className: 'dsh-llm-hub-balance__error' }, `${t('unreachable')}: ${body?.error ?? ''}`))
				}
			}
			const primary = h('div', { className: 'dsh-llm-hub-balance' }, row)

			// 目录拉取原先只对 modelgo 开放（它走 anthropic-messages，官方发现天然失效）。
			// 但「网关上到底有哪些模型」对每个 provider 都有用 —— 智谱手填 8 个、网关在售
			// 16 个，不拉一次根本不知道漏了什么。改为所有 pi-ai provider 都能拉。
			// 探测不到的（没 baseURL 又不在已知网关表里）点了会得到明确提示，不会静默。

			const extra = []
			const pulling = catalog !== null && catalog.phase === 'loading'
			extra.push(h('button', {
				key: 'catalog',
				type: 'button',
				className: 'dsh-llm-hub-balance__button',
				disabled: pulling,
				onClick: pullCatalog
			}, pulling ? t('pulling') : t('pullCatalog')))
			let picker = null
			if (catalog !== null && catalog.phase === 'done') {
				const body = catalog.body
				if (body?.ok === true && Array.isArray(body.models)) {
					extra.push(h('span', { key: 'cat-count', className: 'dsh-llm-hub-balance__breakdown' }, `${t('remoteCount')} ${body.models.length} · ${body.latencyMs}ms`))
					extra.push(h('button', { key: 'copy', type: 'button', className: 'dsh-llm-hub-balance__button', onClick: copyIds }, copied ? t('copied') : t('copyIds')))

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
							h('button', {
								type: 'button',
								className: 'dsh-llm-hub-balance__button',
								disabled: saveState === 'saving',
								onClick: saveModels
							}, saveState === 'saving' ? t('saving') : saveState === 'done' ? t('saved') : saveState === 'fail' ? t('saveFail') : t('save'))),
						h('div', { className: 'dsh-llm-hub-picker__list' },
							body.models.map((model) => h('label', { key: model.id, className: 'dsh-llm-hub-picker__item' },
								h('input', { type: 'checkbox', checked: picked.has(model.id), onChange: () => toggle(model.id) }),
								h('span', { className: 'dsh-llm-hub-picker__id' }, model.id),
								configured.has(model.id) ? h('span', { className: 'dsh-llm-hub-picker__tag' }, t('configured')) : null))))
				} else {
					extra.push(h('span', { key: 'cat-bad', className: 'dsh-llm-hub-balance__error' }, `${t('failed')}: ${body?.error ?? ''}`))
				}
			}
			return h('div', null, primary, h('div', { className: 'dsh-llm-hub-balance' }, extra), picker)
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
			ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
				name: 'settings.models.provider-card',
				key: CARD_KEY,
				locale: NS,
				inject: () => ({ t })
			}, BalanceCard))
			ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
				name: 'settings.models.provider-card',
				key: PIAI_CARD_KEY,
				locale: NS,
				inject: () => ({ t })
			}, PiAiCard))
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
