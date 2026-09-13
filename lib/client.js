/**
 * dsh-llm-hub —— Client（浏览器）半。
 *
 * 在 **Models 设置页的 provider 卡片里** 显示 DeepSeek 账户余额与可用性。
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
				failed: '查询失败'
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
				failed: 'Balance check failed'
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
				'.dsh-llm-hub-balance__button{border:0;background:0 0;padding:0;cursor:pointer;',
				'font-size:12px;color:var(--dsw-alias-brand-primary)}',
				'.dsh-llm-hub-balance__button:disabled{cursor:default;opacity:.5}'
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
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
