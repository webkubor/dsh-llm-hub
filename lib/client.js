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
		/** host 半的余额预警路由。 */
		const WARNING_URL = '/api/dsh-llm-hub/warning/check'
		/** 本插件为 pi-ai 路由注册进 provider-card 的 key —— 等于 pi-ai 的 settingsNs。 */
		const PIAI_CARD_KEY = 'llm-pi-ai'
		/** host 半的 pi-ai 旁路路由前缀。 */
		const PIAI_BASE = '/api/dsh-llm-hub/pi-ai'
		/** 插件元信息端点（版本 / 仓库 / 反馈）。 */
		const META_URL = '/api/dsh-llm-hub/meta'

		/** 模型可用性：读缓存 / 强制全量重探（host 半同名路由）。 */
		/** harness 探测快照；host 半在 apply 时探一次，这里只读。 */
		const HARNESS_URL = '/api/dsh-llm-hub/harness'
		const AVAILABILITY_URL = '/api/dsh-llm-hub/availability'
		const AVAILABILITY_RECHECK_URL = '/api/dsh-llm-hub/availability/recheck'
		/** 用量统计：月度聚合 + 导出 CSV + 清空。 */
		const USAGE_URL = '/api/dsh-llm-hub/usage/summary'
		const USAGE_EXPORT_URL = '/api/dsh-llm-hub/usage/export'
		/** 健康看板：所有 provider 的探测结果（延迟 / HTTP 状态 / 原因）。 */
		const HEALTH_URL = '/api/dsh-llm-hub/health'
		/** 智能路由建议：当前激活 + 推荐 fallback。 */
		const ROUTING_URL = '/api/dsh-llm-hub/routing/resolve'
		/** 模型别名：把长 id 显示成短名（人话）。 */
		const ALIASES_URL = '/api/dsh-llm-hub/aliases'
		/** 多账号 key 轮换：debug 路由，看每个 provider 当前轮到哪个 key。 */
		const KEYPOOL_URL = '/api/dsh-llm-hub/keypool/status'

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
				harnessTitle: '外部 Agent',
				harnessReady: '可委派',
				harnessOccupied: '已由其它插件提供',
				harnessMissing: '未安装',
				harnessHintReady: '会话里可用 subagent_%s 把独立任务交给它',
				harnessHintOccupied: '本机装了，但这个提供方已被另一个插件注册',
				harnessHintMissing: '装上 %s 并重启 DSH，它就会出现',
				probe: '探测网关',
				probing: '探测中…',
				reachable: '可达',
				unreachable: '不可达',
				remoteCount: '网关在售',
				configuredModels: '已配',
				modelsUnit: '个模型',
				keyMissing: '未配 Key',
				copiedKey: '已复制 Key',
				showKey: '查看原密码',
				hideKey: '收起脱敏',
				showKeyHint: '点击复制完整 Key · 👁️ 查看原密码',
				hideKeyHint: '点击复制完整 Key · 🙈 收起脱敏',
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
				availabilityFailed: '可用性读取失败',
				healthTitle: 'Provider 健康看板',
				healthState: { available: '可用', unavailable: '不可用', unknown: '未知' },
				healthLatency: '延迟',
				healthStatus: 'HTTP',
				healthReason: '原因',
				healthCheckedAt: '探测于',
				healthNoData: '还没有任何探测',
				healthRecheck: '重新探测',
				healthRechecking: '探测中…',
				routingTitle: '当前路由',
				routingActive: '当前',
				routingSuggestion: '建议切换到',
				routingUnconfigured: '未配置主力模型',
				routingFallback: 'fallback',
				routingPrimary: '主力',
				routingNoRecommendation: '全部不可用',
				routingLoading: '路由解析中…',
				aliasesMissing: '尚未配置别名',
				keypoolTitle: '多账号 key 轮换',
				keypoolRound: 'round-robin',
				usageTitle: '本月用量',
				usageCalls: '次调用',
				usageInput: '输入',
				usageOutput: '输出',
				usageCache: '缓存',
				usageTotal: '合计',
				usageTopModels: '最常用模型',
				usageDisabled: '用量统计未启用',
				usageExport: '导出 CSV',
				usageExported: '已复制 CSV 内容',
				usageExportFail: '导出失败',
				usageClear: '清空记录',
				usageCleared: '已清空',
				usageClearConfirm: '确认清空？',
				usageNoData: '本月还没有记录'
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
				harnessTitle: 'External agents',
				harnessReady: 'ready',
				harnessOccupied: 'provided by another plugin',
				harnessMissing: 'not installed',
				harnessHintReady: 'Delegate a standalone task with subagent_%s',
				harnessHintOccupied: 'Installed here, but another plugin already registered this provider',
				harnessHintMissing: 'Install %s and restart DSH to make it appear',
				probe: 'Probe gateway',
				probing: 'Probing…',
				reachable: 'Reachable',
				unreachable: 'Unreachable',
				remoteCount: 'remote',
				configuredModels: 'configured',
				modelsUnit: 'models',
				keyMissing: 'No key',
				copiedKey: 'Key copied',
				showKey: 'Show key',
				hideKey: 'Mask key',
				showKeyHint: 'Click to copy full key · 👁️ View key',
				hideKeyHint: 'Click to copy full key · 🙈 Mask key',
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
				availabilityFailed: 'Availability read failed',
				healthTitle: 'Provider health',
				healthState: { available: 'up', unavailable: 'down', unknown: 'unknown' },
				healthLatency: 'latency',
				healthStatus: 'HTTP',
				healthReason: 'reason',
				healthCheckedAt: 'probed at',
				healthNoData: 'no probes yet',
				healthRecheck: 'Re-check all',
				healthRechecking: 'Checking…',
				routingTitle: 'Current routing',
				routingActive: 'Active',
				routingSuggestion: 'Try switching to',
				routingUnconfigured: 'routing not configured',
				routingFallback: 'fallback',
				routingPrimary: 'primary',
				routingNoRecommendation: 'none available',
				routingLoading: 'resolving routing…',
				aliasesMissing: 'no aliases configured',
				keypoolTitle: 'Key rotation',
				keypoolRound: 'round-robin',
				usageTitle: 'This month',
				usageCalls: 'calls',
				usageInput: 'in',
				usageOutput: 'out',
				usageCache: 'cached',
				usageTotal: 'total',
				usageTopModels: 'top models',
				usageDisabled: 'usage tracking not enabled',
				usageExport: 'Export CSV',
				usageExported: 'CSV copied',
				usageExportFail: 'Export failed',
				usageClear: 'Clear records',
				usageCleared: 'Cleared',
				usageClearConfirm: 'Confirm clear?',
				usageNoData: 'no calls this month yet'
			}
		}

		/** 词典未就绪时的兜底（键原样返回，绝不显示 undefined）。 */
		const fallbackT = (key) => (LOCALES.zh[key] ?? key)

		/**
		 * 全局别名表 —— 启动时拉一次，所有组件共用。
		 *
		 * 数据来源 `GET /api/dsh-llm-hub/aliases`：返回 `{ ok, aliases: { "<provider>/<model>": "短名" } }`。
		 * 启动后注入一次，所有 picker 行、RoutingCard 候选都用它把长 id 翻成短名。
		 * 失败/未配置：aliasesMap = {}，aliasFor 永远返 null，UI 退回到只显示 model.id
		 * （与没装本插件时一致）。
		 *
		 * 为什么不在每张卡 mount 时各自 fetch：每个卡都发一次就 N 张卡 N 个请求，
		 * 还要写一份交叉去重。集中一次、所有卡读同一份快照就完事。
		 * @returns {{ map, aliasFor }}
		 */
		const aliasesStore = (() => {
			let map = {}
			const listeners = new Set()
			const publish = (next) => {
				map = next
				for (const listener of [...listeners]) { try { listener() } catch { /* 不让订阅者炸 */ } }
			}
			const aliasFor = (provider, model) => {
				if (typeof provider !== 'string' || typeof model !== 'string') return null
				return map[`${provider}/${model}`] ?? null
			}
			fetch(ALIASES_URL, { headers: { accept: 'application/json' } })
				.then((res) => res.json())
				.then((body) => {
					if (body !== null && typeof body === 'object' && body.ok === true && typeof body.aliases === 'object' && body.aliases !== null) {
						publish(body.aliases)
					}
				})
				.catch(() => { /* 静默：UI 退回 model.id 渲染 */ })
			return {
				aliasFor,
				/** 订阅别名表变更 —— 组件 mount 后调用一次，以后改了会刷新。 */
				subscribe(listener) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
				snapshot: () => map
			}
		})()

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
				'.dsh-llm-hub-harness{display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-harness__chip{display:inline-flex;align-items:center;gap:5px;',
				'padding:2px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);',
				'background:var(--dsw-alias-bg-layer-2)}',
				'.dsh-llm-hub-harness__chip--missing{opacity:.55}',
				'.dsh-llm-hub-harness__dot{width:6px;height:6px;border-radius:50%;',
				'background:var(--dsw-alias-label-secondary);flex:none}',
				'.dsh-llm-hub-harness__dot--ready{background:var(--dsw-alias-state-success-primary,#3fb950)}',
				'.dsh-llm-hub-harness__name{color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-harness__state{opacity:.75}',
				'.dsh-llm-hub-balance__label{color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-balance__amount{color:var(--dsw-alias-label-primary);font-weight:600;',
				'font-variant-numeric:tabular-nums}',
				'.dsh-llm-hub-balance__amount--low{color:var(--dsw-alias-state-error-primary)}',
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
				'.dsh-llm-hub-key-tag{display:inline-flex;align-items:center;gap:5px;cursor:pointer;',
				'user-select:none;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px}',
				'.dsh-llm-hub-key-tag:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-key-tag__eye{border:0;background:0 0;padding:0;cursor:pointer;',
				'font-size:11px;line-height:1;opacity:.65;display:inline-flex;align-items:center}',
				'.dsh-llm-hub-key-tag__eye:hover{opacity:1}',
				// 被摘掉的 provider：在它自己的卡片动作条里标一枚小片，不另开面板
				// （2026-09-16 owner：「这不是很多余吗，上面不都是显示了吗」）。
				'.dsh-llm-hub-chip{box-sizing:border-box;display:inline-flex;align-items:center;height:24px;padding:0 8px;',
				'border-radius:12px;font-size:12px;line-height:16px;white-space:nowrap;',
				'border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-chip--hidden{border-color:var(--dsw-alias-state-error-primary);',
				'color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-foot__hidden{color:var(--dsw-alias-state-error-primary)}',
				// 用量卡：放在 footer 之前（order 80 vs harness 90 vs footer 100）
				'.dsh-llm-hub-usage{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-usage__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-usage__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-usage__facts{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-usage__tag{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;',
				'border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);',
				'background:var(--dsw-alias-bg-layer-3)}',
				'.dsh-llm-hub-usage__top{display:flex;flex-direction:column;gap:2px;margin-top:2px}',
				'.dsh-llm-hub-usage__top-row{display:flex;justify-content:space-between;gap:8px;',
				'color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-usage__top-row small{color:var(--dsw-alias-label-secondary);opacity:.8}',
				'.dsh-llm-hub-usage__actions{display:flex;gap:6px;flex-wrap:wrap}',
				// 健康看板：放在用量卡之上（order 70 vs usage 80）
				'.dsh-llm-hub-health{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-health__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-health__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-health__rows{display:flex;flex-direction:column;gap:2px}',
				'.dsh-llm-hub-health__row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;',
				'padding:2px 4px;border-radius:6px}',
				'.dsh-llm-hub-health__name{color:var(--dsw-alias-label-primary);font-weight:600;',
				'min-width:80px}',
				'.dsh-llm-hub-health__chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;',
				'border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);',
				'font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-health__chip--available{border-color:var(--dsw-alias-state-success-primary,#3fb950);',
				'color:var(--dsw-alias-state-success-primary,#3fb950)}',
				'.dsh-llm-hub-health__chip--unavailable{border-color:var(--dsw-alias-state-error-primary);',
				'color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-health__chip--unknown{border-color:var(--dsw-alias-border-l3);',
				'color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-health__metric{font-size:11px;opacity:.85}',
				'.dsh-llm-hub-health__metric--time{margin-left:auto}',
				'.dsh-llm-hub-health__reason{color:var(--dsw-alias-state-warn-primary);',
				'max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
				// 当前路由卡：放在 health 70 与 usage 80 之间（order 75）
				'.dsh-llm-hub-routing{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-routing__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-routing__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-routing__active{color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-routing__rows{display:flex;flex-direction:column;gap:2px}',
				'.dsh-llm-hub-routing__row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;',
				'padding:2px 4px;border-radius:6px}',
				'.dsh-llm-hub-routing__role{display:inline-flex;align-items:center;height:20px;padding:0 8px;',
				'border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);',
				'background:var(--dsw-alias-bg-layer-3);font-size:11px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-routing__name{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-routing__suggestion{color:var(--dsw-alias-state-warn-primary);',
				'padding-top:4px}',
				'.dsh-llm-hub-routing__reason{color:var(--dsw-alias-state-error-primary);',
				'padding-top:4px}',
				// 多账号 key 轮换：放在 routing 75 之前（order 73）
				'.dsh-llm-hub-keypool{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:8px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-keypool__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-keypool__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-keypool__rows{display:flex;flex-direction:column;gap:2px}',
				'.dsh-llm-hub-keypool__row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
				'padding:2px 4px;border-radius:6px}',
				'.dsh-llm-hub-keypool__name{color:var(--dsw-alias-label-primary);font-weight:600;min-width:120px}',
				'.dsh-llm-hub-keypool__meta{font-size:11px;opacity:.7}',
				'.dsh-llm-hub-keypool__chosen{display:flex;align-items:baseline;gap:4px;',
				'color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-keypool__chosen small{color:var(--dsw-alias-label-secondary);opacity:.75;font-size:11px}',
				'.dsh-llm-hub-keypool__pending{color:var(--dsw-alias-label-secondary);opacity:.6}',
			].join('')
			document.head.appendChild(style)
		}

		/**
		 * API Key 脱敏展示与一键复制标签。
		 * - 默认展示首尾可见的脱敏串（如 mgk_li••••8cV9）
		 * - 点击 👁️ 查看/收起完整明文
		 * - 点击标签复制完整未脱敏的 Key，并瞬时反馈「已复制 Key」
		 */
		function ApiKeyBadge(props) {
			const apiKey = typeof props.apiKey === 'string' && props.apiKey.trim() !== '' ? props.apiKey.trim() : null
			const keyMasked = typeof props.keyMasked === 'string' && props.keyMasked.trim() !== '' ? props.keyMasked.trim() : null
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [revealed, setRevealed] = React.useState(false)
			const [copied, setCopied] = React.useState(false)

			if (apiKey === null && keyMasked === null) {
				return h('span', { className: 'dsh-llm-hub-balance__tag' }, t('keyMissing'))
			}

			const display = revealed ? (apiKey ?? keyMasked) : (keyMasked ?? '••••••••')

			const copyKey = (e) => {
				e.stopPropagation()
				const textToCopy = apiKey ?? keyMasked
				if (!textToCopy) return
				navigator.clipboard?.writeText(textToCopy)
					.then(() => {
						setCopied(true)
						setTimeout(() => setCopied(false), 1600)
					})
					.catch(() => {})
			}

			const toggleReveal = (e) => {
				e.stopPropagation()
				setRevealed((prev) => !prev)
			}

			return h('span', {
				className: 'dsh-llm-hub-balance__tag dsh-llm-hub-key-tag',
				title: copied ? t('copiedKey') : (revealed ? t('hideKeyHint') : t('showKeyHint')),
				onClick: copyKey
			},
				h('span', { className: 'dsh-llm-hub-key-tag__text' }, copied ? t('copiedKey') : display),
				apiKey === null ? null : h('button', {
					type: 'button',
					className: 'dsh-llm-hub-key-tag__eye',
					title: revealed ? t('hideKey') : t('showKey'),
					onClick: toggleReveal
				}, revealed ? '🙈' : '👁️'))
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
			const [warning, setWarning] = React.useState(null)
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
						setState({
							status: 'ok',
							isAvailable: body.isAvailable === true,
							balances: Array.isArray(body.balances) ? body.balances : [],
							apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
							keyMasked: typeof body.keyMasked === 'string' ? body.keyMasked : undefined
						})
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
			// 余额预警：拿到数字后顺手问 host 是否低于阈值。状态独立：
			// warning=null 表示还没回（不显示标签）/ level='low' 才上色 + 提示。
			React.useEffect(() => {
				fetch(WARNING_URL, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({
						provider: DEEPSEEK_PROVIDER,
						deepseek: { total: primary.total, currency: primary.currency }
					})
				})
					.then((res) => res.json())
					.then((body) => {
						if (body?.ok === true && body.level === 'low') {
							setWarning({ level: 'low', text: typeof body.text === 'string' ? body.text : '' })
						} else {
							setWarning(null)
						}
					})
					.catch(() => setWarning(null))
			}, [primary.total, primary.currency])
			const symbol = primary.currency === 'CNY' ? '¥' : primary.currency === 'USD' ? '$' : `${primary.currency} `
			const amountClass = warning !== null && warning.level === 'low'
				? 'dsh-llm-hub-balance__amount dsh-llm-hub-balance__amount--low'
				: 'dsh-llm-hub-balance__amount'
			children.push(h('span', { key: 'amount', className: amountClass }, `${symbol}${primary.total}`))
			if (warning !== null && warning.level === 'low') {
				children.push(h('span', {
					key: 'warning',
					className: 'dsh-llm-hub-balance__warn',
					title: warning.text
				}, '⚠️'))
			}
			if (!state.isAvailable) children.push(h('span', { key: 'unavail', className: 'dsh-llm-hub-balance__warn' }, t('unavailable')))
			const breakdown = []
			if (primary.granted !== '0' && primary.granted !== '0.00') breakdown.push(`${t('granted')} ${symbol}${primary.granted}`)
			if (primary.toppedUp !== '0' && primary.toppedUp !== '0.00') breakdown.push(`${t('toppedUp')} ${symbol}${primary.toppedUp}`)
			if (breakdown.length > 0) {
				children.push(h('span', { key: 'breakdown', className: 'dsh-llm-hub-balance__breakdown' }, breakdown.join(' · ')))
			}
			if (state.apiKey !== undefined || state.keyMasked !== undefined) {
				children.push(h(ApiKeyBadge, {
					key: 'key-badge',
					apiKey: state.apiKey,
					keyMasked: state.keyMasked,
					t
				}))
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
			const [warning, setWarning] = React.useState(null)
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

			// 余额预警：拿到 envelope 后顺手问 host 是否低于阈值。
			React.useEffect(() => {
				if (provider === '' || balance === null || balance.ok !== true) return undefined
				let alive = true
				fetch(WARNING_URL, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ provider, envelope: balance })
				})
					.then((res) => res.json())
					.then((body) => {
						if (alive && body?.ok === true && body.level === 'low') {
							setWarning({ level: 'low', text: typeof body.text === 'string' ? body.text : '' })
						} else if (alive) {
							setWarning(null)
						}
					})
					.catch(() => { if (alive) setWarning(null) })
				return () => { alive = false }
			}, [provider, balance])

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
			facts.push(h(ApiKeyBadge, {
				key: 'key-badge',
				apiKey: status.apiKey,
				keyMasked: status.keyMasked,
				t
			}))
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
			if (warning !== null && warning.level === 'low') {
				facts.push(h('span', {
					key: 'warning',
					className: 'dsh-llm-hub-balance__warn',
					title: warning.text
				}, '⚠️'))
			}

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
							body.models.map((model) => {
								const alias = aliasesStore.aliasFor(provider, model.id)
								return h('label', {
									key: model.id,
									className: 'dsh-llm-hub-picker__item',
									// 完整 id 永远在 title 里 —— 复制 model id 粘配置用。
									title: model.id
								},
									h('input', { type: 'checkbox', checked: picked.has(model.id), onChange: () => toggle(model.id) }),
									h('span', { className: 'dsh-llm-hub-picker__id' }, alias === null ? model.id : `${alias} (${model.id})`),
									configured.has(model.id) ? h('span', { className: 'dsh-llm-hub-picker__tag' }, t('configured')) : null)
							})))
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
		/**
		 * 外部 harness 一览。
		 *
		 * 只读 host 半 apply 时探好的快照（`/api/dsh-llm-hub/harness`），不自己探 ——
		 * 探测要 spawn 解析可执行文件，那是 host 的活，前端重复做一遍只会两处不一致。
		 *
		 * 未安装的**也显示**（置灰）：这一行的用处一半是「现在能派给谁」，另一半是
		 * 「装上哪个就能多派一个」。全过滤掉就只剩前一半，用户永远不知道还能有什么。
		 * @param props - `t` 文案函数。
		 * @returns 一行 chips；探测未完成或接口不可用时返回 null。
		 */
		function HarnessRow(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [report, setReport] = React.useState(null)
			React.useEffect(() => {
				let alive = true
				fetch(HARNESS_URL, { headers: { accept: 'application/json' } })
					.then((res) => res.json())
					.then((body) => { if (alive) setReport(body) })
					.catch(() => { if (alive) setReport({ ok: false }) })
				return () => { alive = false }
			}, [])
			// probed 为 false 是启动竞态（host 还没探完），不是「一个都没装」——
			// 这时候渲染「未安装 ×3」会说谎，所以什么都不显示。
			if (report === null || report.ok !== true || report.probed !== true) return null
			const list = Array.isArray(report.harnesses) ? report.harnesses : []
			if (list.length === 0) return null
			ensureStyle()
			return h('div', { className: 'dsh-llm-hub-harness' },
				h('span', { className: 'dsh-llm-hub-harness__state' }, t('harnessTitle')),
				list.map((item) => {
					const state = item.registered === true
						? { text: t('harnessReady'), hint: t('harnessHintReady').replace('%s', String(item.id).replace(/-/g, '_')), ready: true }
						: (item.installed === true
							? { text: t('harnessOccupied'), hint: t('harnessHintOccupied'), ready: false }
							: { text: t('harnessMissing'), hint: t('harnessHintMissing').replace('%s', item.bin), ready: false })
					return h('span', {
						key: item.id,
						className: 'dsh-llm-hub-harness__chip' + (item.installed === true ? '' : ' dsh-llm-hub-harness__chip--missing'),
						// 路径放进 tooltip：装了却不生效时，第一件要确认的就是「它找到的是哪个副本」。
						title: state.hint + (typeof item.executable === 'string' ? '\n' + item.executable : '')
					},
						h('span', { className: 'dsh-llm-hub-harness__dot' + (state.ready ? ' dsh-llm-hub-harness__dot--ready' : '') }),
						h('span', { className: 'dsh-llm-hub-harness__name' }, item.displayName),
						h('span', { className: 'dsh-llm-hub-harness__state' }, state.text)
					)
				})
			)
		}

		/**
		 * 健康看板卡：把所有 provider 的探测结果铺成一张表，每行：
		 *   名称 ｜ 状态（可用/不可用/未知） ｜ 延迟 ｜ HTTP ｜ 原因 ｜ 探测时间
		 *
		 * 不复用 availability payload：那个为下拉隐藏服务，shape 不一样；新加
		 * `/api/dsh-llm-hub/health` 路由返回带 latencyMs / status 的全字段。
		 * 状态 chip 与隐藏下拉那枚 chip 共用样式变量。
		 *
		 * 「重新探测」按钮 = availability 路由的 recheck（共用同一条底层 refresh
		 * 流程，避免双探），触发后乐观更新 checkedAt 让用户看见反馈。
		 *
		 * @param props - 注入的 `t` 和 `availability`（recheck 用）。
		 * @returns 健康看板；探测数据为空时返回 null（启动竞态）。
		 */
		function HealthCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const availability = props.availability
			const [report, setReport] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const load = React.useCallback(() => {
				fetch(HEALTH_URL, { headers: { accept: 'application/json' } })
					.then((res) => res.json())
					.then((body) => { setReport(body !== null && typeof body === 'object' ? body : { ok: false }) })
					.catch(() => setReport({ ok: false }))
			}, [])
			React.useEffect(() => { load() }, [load])
			// availability store 推 probing=true 时也刷一次 —— 探测完成后数据更全
			const availabilityState = availability === undefined
				? { probing: false }
				: React.useSyncExternalStore(availability.subscribe, availability.snapshot)
			React.useEffect(() => {
				if (availabilityState.probing === false) load()
			}, [availabilityState.probing, load])
			if (report === null) return null
			if (report.ok !== true) return null
			const providers = Array.isArray(report.providers) ? report.providers : []
			if (providers.length === 0) {
				ensureStyle()
				return h('div', { className: 'dsh-llm-hub-health' },
					h('div', { className: 'dsh-llm-hub-health__head' },
						h('span', { className: 'dsh-llm-hub-health__title' }, t('healthTitle')),
						h('span', null, t('healthNoData'))))
			}
			ensureStyle()
			const recheck = () => {
				if (availability === undefined) return
				setBusy(true)
				availability.recheck().finally(() => { setBusy(false); load() })
			}
			const formatLatency = (value) => typeof value === 'number' ? `${value}ms` : '—'
			const formatCheckedAt = (ms) => {
				if (typeof ms !== 'number' || ms <= 0) return '—'
				const d = new Date(ms)
				const hh = String(d.getHours()).padStart(2, '0')
				const mm = String(d.getMinutes()).padStart(2, '0')
				const ss = String(d.getSeconds()).padStart(2, '0')
				return `${hh}:${mm}:${ss}`
			}
			const stateLabel = (state) => {
				const map = typeof t('healthState') === 'object' ? t('healthState') : { available: 'up', unavailable: 'down', unknown: 'unknown' }
				return map[state] ?? state
			}
			const stateClass = (state) => `dsh-llm-hub-health__chip dsh-llm-hub-health__chip--${state ?? 'unknown'}`
			const rows = providers.map((entry) => h('div', { key: entry.provider, className: 'dsh-llm-hub-health__row' },
				h('span', { className: 'dsh-llm-hub-health__name' }, entry.displayName ?? entry.provider),
				h('span', { className: stateClass(entry.state), title: typeof entry.code === 'string' ? entry.code : '' }, stateLabel(entry.state)),
				h('span', { className: 'dsh-llm-hub-health__metric' }, `${t('healthLatency')} ${formatLatency(entry.latencyMs)}`),
				h('span', { className: 'dsh-llm-hub-health__metric' }, `${t('healthStatus')} ${typeof entry.status === 'number' ? entry.status : '—'}`),
				typeof entry.reason === 'string' && entry.reason.length > 0
					? h('span', { className: 'dsh-llm-hub-health__reason', title: entry.reason }, entry.reason)
					: null,
				h('span', { className: 'dsh-llm-hub-health__metric dsh-llm-hub-health__metric--time' }, `${t('healthCheckedAt')} ${formatCheckedAt(entry.checkedAt)}`)))
			return h('div', { className: 'dsh-llm-hub-health' },
				h('div', { className: 'dsh-llm-hub-health__head' },
					h('span', { className: 'dsh-llm-hub-health__title' }, t('healthTitle')),
					availability === undefined ? null : h('button', {
						key: 'recheck',
						type: 'button',
						className: 'dsh-llm-hub-foot__link',
						disabled: busy,
						onClick: recheck
					}, busy ? t('healthRechecking') : t('healthRecheck'))),
				h('div', { className: 'dsh-llm-hub-health__rows' }, rows))
		}

		/**
		 * 多账号 key 轮换卡 —— 显示每个 provider 当前轮到了哪个 key。
		 *
		 * 设计为调试 / 可见性卡：用户想知道「我现在用的是哪一把 key」「下一把是谁」
		 * 「上次失败用的是哪个 env」。**不**显示 apiKey 实际值，只显示 name + env 名。
		 *
		 * 暂不做「下一把」按钮 —— host 半 round-robin 已经在每次解析时推进，用户
		 * 想强制换的话只要刷一次页面（或重探 health）就轮到下一个。
		 *
		 * @param props - 注入的 `t`。
		 * @returns 轮换卡；没配 keyPool 时返 null。
		 */
		function KeyPoolCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [report, setReport] = React.useState(null)
			React.useEffect(() => {
				let alive = true
				fetch(KEYPOOL_URL, { headers: { accept: 'application/json' } })
					.then((res) => res.json())
					.then((body) => { if (alive) setReport(body !== null && typeof body === 'object' ? body : null) })
					.catch(() => { if (alive) setReport(null) })
				return () => { alive = false }
			}, [])
			if (report === null) return null
			const providers = Array.isArray(report.providers) ? report.providers : []
			if (providers.length === 0) return null
			ensureStyle()
			const formatTime = (ms) => {
				if (typeof ms !== 'number' || ms <= 0) return '—'
				const d = new Date(ms)
				return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
			}
			const rows = providers.map((entry) => {
				const chosen = entry.lastChosen
				return h('div', { key: entry.provider, className: 'dsh-llm-hub-keypool__row' },
					h('span', { className: 'dsh-llm-hub-keypool__name' }, entry.provider),
					h('span', { className: 'dsh-llm-hub-keypool__meta' }, `${entry.total} keys`),
					chosen === null
						? h('span', { className: 'dsh-llm-hub-keypool__pending' }, '—')
						: h('span', { className: 'dsh-llm-hub-keypool__chosen' },
							h('span', null, chosen.name),
							h('small', null, ` #${chosen.index + 1} / ${entry.total} · ${formatTime(chosen.at)}`)))
			})
			return h('div', { className: 'dsh-llm-hub-keypool' },
				h('div', { className: 'dsh-llm-hub-keypool__head' },
					h('span', { className: 'dsh-llm-hub-keypool__title' }, t('keypoolTitle')),
					h('span', null, t('keypoolRound'))),
				h('div', { className: 'dsh-llm-hub-keypool__rows' }, rows))
		}

		/**
		 * 当前路由卡 —— 显示用户当前激活的 (provider, model) + 状态 + 推荐的 fallback。
		 *
		 * 不替用户切换：DSH 的 `conversation.input.model` 是 single + user-controlled
		 * slot，没有供插件改值的 setter（README 已经钉死这条）。这条卡只**告诉**
		 * 用户「当前这个不可用了，下一个可用的 fallback 是 X，你自己点一下」。
		 *
		 * 数据来源 `/api/dsh-llm-hub/routing/resolve`：POST 进来 active = (provider, model)，
		 * host 半按 settings.dsh-llm-hub.routing 的 primary + fallbacks[] 返回
		 * recommendation。
		 *
		 * 渲染形式：
		 *   - 当前 active + 状态 chip（与 health 卡共享样式）
		 *   - primary / fallback 候选列表（各自带状态 chip）
		 *   - recommendation ≠ active 时显式提示「建议切换到 X」
		 *   - 未配置 routing：显示「未配置主力模型」+ 引导文本
		 *   - 全不可用：显示「全部不可用」+ reason
		 *
		 * @param props - 注入的 `t`。
		 * @returns 当前路由卡；未配置时不渲染（让用户先配置再说）。
		 */
		function RoutingCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [report, setReport] = React.useState(null)
			const query = React.useCallback((active) => {
				fetch(ROUTING_URL, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ active: typeof active === 'string' && active.length > 0 ? active : null })
				})
					.then((res) => res.json())
					.then((body) => { setReport(body !== null && typeof body === 'object' ? body : null) })
					.catch(() => setReport(null))
			}, [])
			React.useEffect(() => { query(null) }, [query])
			if (report === null) {
				return h('div', { className: 'dsh-llm-hub-routing' },
					h('div', { className: 'dsh-llm-hub-routing__head' },
						h('span', { className: 'dsh-llm-hub-routing__title' }, t('routingTitle')),
						h('span', null, t('routingLoading'))))
			}
			if (report.ok !== true) return null
			const candidates = Array.isArray(report.candidates) ? report.candidates : []
			if (candidates.length === 0) {
				ensureStyle()
				return h('div', { className: 'dsh-llm-hub-routing' },
					h('div', { className: 'dsh-llm-hub-routing__head' },
						h('span', { className: 'dsh-llm-hub-routing__title' }, t('routingTitle')),
						h('span', null, t('routingUnconfigured'))))
			}
			ensureStyle()
			const active = report.active
			const recommendation = report.recommendation
			const activeKey = active === null ? null : `${active.provider}/${active.model}`
			const recKey = recommendation === null ? null : `${recommendation.provider}/${recommendation.model}`
			const showSuggestion = recommendation !== null && recKey !== activeKey
			const chipClass = (state) => `dsh-llm-hub-health__chip dsh-llm-hub-health__chip--${state ?? 'unknown'}`
			const head = h('div', { className: 'dsh-llm-hub-routing__head' },
				h('span', { className: 'dsh-llm-hub-routing__title' }, t('routingTitle')),
				active !== null
					? h('span', { className: 'dsh-llm-hub-routing__active' },
						`${t('routingActive')}: ${active.provider}/${active.model}`,
						h('span', { className: chipClass(active.state), style: { marginLeft: '6px' } }, active.state))
					: null)
			const rows = candidates.map((entry, index) => h('div', { key: `${entry.provider}/${entry.model}/${index}`, className: 'dsh-llm-hub-routing__row' },
				h('span', { className: 'dsh-llm-hub-routing__role' }, index === 0 ? t('routingPrimary') : `${t('routingFallback')} ${index}`),
				h('span', { className: 'dsh-llm-hub-routing__name' }, `${entry.provider}/${entry.model}`),
				h('span', { className: chipClass(entry.state) }, entry.state)))
			const footer = showSuggestion
				? h('div', { className: 'dsh-llm-hub-routing__suggestion' },
					h('span', null, `${t('routingSuggestion')} `),
					h('strong', null, `${recommendation.provider}/${recommendation.model}`))
				: (typeof report.reason === 'string' && report.reason.length > 0
					? h('div', { className: 'dsh-llm-hub-routing__reason' }, report.reason)
					: null)
			return h('div', { className: 'dsh-llm-hub-routing' }, head, h('div', { className: 'dsh-llm-hub-routing__rows' }, rows), footer)
		}

		/**
		 * 格式化 token 数字 —— 大数带千分位，>9999 折成 1.2万。
		 * @param value - token 数。
		 * @returns 人话短文本。
		 */
		function formatTokens(value) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0'
			if (value < 10000) return String(Math.floor(value))
			return `${(value / 10000).toFixed(value < 100000 ? 2 : 1)}万`
		}

		/**
		 * 本月用量卡。
		 *
		 * 显示 input / output / cache tokens + 调用次数 + 前 5 个最常用模型。
		 * 不算钱 —— open source DSH 没收 chat 文本定价接口，每个 provider 写硬编码价目表
		 * 既过时又快塌。把 token 数留给用户对照官方价目表，导出按钮拿整张 CSV。
		 *
		 * @param props - 注入的 `t`。
		 * @returns 月度用量卡；统计未启用时返回 null（harness 一览照常显示）。
		 */
		function UsageCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [report, setReport] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [feedback, setFeedback] = React.useState(null)
			React.useEffect(() => {
				let alive = true
				fetch(USAGE_URL, { headers: { accept: 'application/json' } })
					.then((res) => res.json())
					.then((body) => { if (alive) setReport(body !== null && typeof body === 'object' ? body : { ready: false }) })
					.catch(() => { if (alive) setReport({ ready: false }) })
				return () => { alive = false }
			}, [])
			if (report === null) return null
			if (report.ready !== true) {
				// 用量统计未启用：照实说，不占位。
				ensureStyle()
				return h('div', { className: 'dsh-llm-hub-usage' },
					h('div', { className: 'dsh-llm-hub-usage__head' },
						h('span', { className: 'dsh-llm-hub-usage__title' }, t('usageTitle')),
						h('span', null, t('usageDisabled'))))
			}
			ensureStyle()
			const current = report.current
			const topModels = Array.isArray(current?.topModels) ? current.topModels : []
			const exportCsv = () => {
				setBusy(true)
				setFeedback(null)
				fetch(USAGE_EXPORT_URL, { headers: { accept: 'text/csv' } })
					.then((res) => res.text())
					.then((text) => {
						navigator.clipboard?.writeText(text).then(
							() => setFeedback('ok'),
							() => setFeedback('fail'),
						)
					})
					.catch(() => setFeedback('fail'))
					.finally(() => setBusy(false))
			}
			const clearRecords = () => {
				if (!window.confirm(t('usageClearConfirm'))) return
				setBusy(true)
				fetch('/api/dsh-llm-hub/usage/clear', {
					method: 'POST',
					headers: { accept: 'application/json' }
				})
					.then(() => setReport((prev) => ({ ...prev, current: { ...(prev?.current ?? {}), calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, topModels: [] } })))
					.catch(() => {})
					.finally(() => setBusy(false))
			}
			const facts = []
			if (current) {
				facts.push(h('span', { key: 'calls', className: 'dsh-llm-hub-usage__tag' }, `${current.calls ?? 0} ${t('usageCalls')}`))
				facts.push(h('span', { key: 'in', className: 'dsh-llm-hub-usage__tag' }, `${t('usageInput')} ${formatTokens(current.inputTokens)}`))
				facts.push(h('span', { key: 'out', className: 'dsh-llm-hub-usage__tag' }, `${t('usageOutput')} ${formatTokens(current.outputTokens)}`))
				if ((current.cacheReadTokens ?? 0) > 0 || (current.cacheWriteTokens ?? 0) > 0) {
					facts.push(h('span', { key: 'cache', className: 'dsh-llm-hub-usage__tag' }, `${t('usageCache')} ${formatTokens((current.cacheReadTokens ?? 0) + (current.cacheWriteTokens ?? 0))}`))
				}
				facts.push(h('span', { key: 'total', className: 'dsh-llm-hub-usage__tag' }, `${t('usageTotal')} ${formatTokens(current.totalTokens)}`))
			}
			const topSection = topModels.length > 0
				? h('div', { className: 'dsh-llm-hub-usage__top' },
					h('div', { className: 'dsh-llm-hub-usage__title' }, t('usageTopModels')),
					topModels.map((row, index) => h('div', { key: `${row.provider}/${row.model}/${index}`, className: 'dsh-llm-hub-usage__top-row' },
						h('span', null, `${row.provider}/${row.model}`),
						h('small', null, `${row.calls} ${t('usageCalls')}`))))
				: h('div', null, t('usageNoData'))
			return h('div', { className: 'dsh-llm-hub-usage' },
				h('div', { className: 'dsh-llm-hub-usage__head' },
					h('span', { className: 'dsh-llm-hub-usage__title' }, t('usageTitle')),
					h('div', { className: 'dsh-llm-hub-usage__facts' }, facts)),
				topSection,
				h('div', { className: 'dsh-llm-hub-usage__actions' },
					h('button', {
						type: 'button',
						className: 'dsh-llm-hub-foot__link',
						disabled: busy,
						onClick: exportCsv
					}, feedback === 'ok' ? t('usageExported') : feedback === 'fail' ? t('usageExportFail') : t('usageExport')),
					h('button', {
						type: 'button',
						className: 'dsh-llm-hub-foot__link',
						disabled: busy || (current?.calls ?? 0) === 0,
						onClick: clearRecords
					}, t('usageClear'))))
		}

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
			// harness 一览排在 footer 那行之上（order 更小）：它讲的是「能派给谁」，
			// 属于能力信息；footer 那行是插件自身的版本与链接，属于元信息。
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-health',
				order: 70,
				locale: NS,
				inject: () => ({ t, availability })
			}, HealthCard))
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-keypool',
				order: 73,
				locale: NS,
				inject: () => ({ t })
			}, KeyPoolCard))
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-routing',
				order: 75,
				locale: NS,
				inject: () => ({ t })
			}, RoutingCard))
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-usage',
				order: 80,
				locale: NS,
				inject: () => ({ t })
			}, UsageCard))
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-harness',
				order: 90,
				locale: NS,
				inject: () => ({ t })
			}, HarnessRow))
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
