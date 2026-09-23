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
				showKeyHint: '点击复制完整 Key · 眼睛图标查看原密码',
				hideKeyHint: '点击复制完整 Key · 眼睛图标收起脱敏',
				showKeyUnavailable: '点击复制（当前凭据受安全保护仅展示脱敏标识）',
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
				keypoolActiveTip: '当前优先使用',
				keypoolNextTip: '下次轮换目标',
				heroTitle: 'LLM 矩阵概览',
				heroProviders: '活跃提供方',
				heroModels: '可用模型',
				heroFastest: '最优延迟',
				heroSecurity: '凭据防护',
				heroSecSafe: '零明文脱敏中',
				presetsTitle: '⚡ 热门大模型一键装配',
				presetsSub: '点击主流服务商快速复制 YAML 配置模板与直达控制台',
				presetsCopied: '已复制配置片段',
				presetsCopyBtn: '复制 YAML',
				presetsDocsBtn: '获取 Key ↗',
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
				usageNoData: '本月还没有记录',
				suiteTitle: 'Webkubor DSH 扩展家族',
				suiteDesc: '一键构建完整智能体开发环境',
				suiteActive: '已激活',
				suiteCopyInstall: '复制安装',
				suiteCopied: '已复制命令'
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
				showKeyHint: 'Click to copy full key · Eye icon to reveal',
				hideKeyHint: 'Click to copy full key · Eye icon to mask',
				showKeyUnavailable: 'Click to copy masked key',
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
				keypoolActiveTip: 'Currently active',
				keypoolNextTip: 'Next target',
				heroTitle: 'LLM Matrix Overview',
				heroProviders: 'Active providers',
				heroModels: 'Models',
				heroFastest: 'Fastest ping',
				heroSecurity: 'Key security',
				heroSecSafe: 'Masked in memory',
				presetsTitle: '⚡ Popular LLM Quick Presets',
				presetsSub: 'One-click YAML config snippets and official key links',
				presetsCopied: 'YAML snippet copied',
				presetsCopyBtn: 'Copy YAML',
				presetsDocsBtn: 'Get Key ↗',
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
				usageNoData: 'no calls this month yet',
				suiteTitle: 'Webkubor DSH Plugin Suite',
				suiteDesc: 'One-click full agent development environment',
				suiteActive: 'Active',
				suiteCopyInstall: 'Copy install',
				suiteCopied: 'Command copied'
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
				'@keyframes dsh-llm-hub-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
				'.dsh-llm-hub-spin{animation:dsh-llm-hub-spin 1s linear infinite;display:inline-block}',
				// 清爽无边框 List Card 容器：自然融入宿主，呼吸感通透
				'.dsh-llm-hub-card{display:flex;flex-direction:column;gap:6px;margin-top:4px;',
				'padding:4px 0 2px 0;border:none;background:transparent;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-card__meta{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;min-width:0}',
				'.dsh-llm-hub-card__tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
				'.dsh-llm-hub-meta-sep{opacity:.35;font-size:10px;user-select:none;margin:0 1px}',
				'.dsh-llm-hub-meta-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
				'.dsh-llm-hub-card__actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:2px}',
				'.dsh-llm-hub-card__btn-group{display:flex;align-items:center;gap:5px;flex-wrap:wrap}',
				'.dsh-llm-hub-card__status-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}',
				// 兼容旧 balance 容器类名
				'.dsh-llm-hub-balance{display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
				'margin-top:4px;padding:4px 0;border:none;background:transparent;',
				'font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-balance--stack{flex-direction:column;align-items:stretch;gap:6px}',
				'.dsh-llm-hub-balance__facts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
				'.dsh-llm-hub-balance-label{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:500}',
				'.dsh-llm-hub-amount{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);',
				'font-variant-numeric:tabular-nums;letter-spacing:-0.2px}',
				'.dsh-llm-hub-amount.is-low{color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-subtext{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8}',
				'.dsh-llm-hub-warn{color:var(--dsw-alias-state-warn-primary);font-size:11px}',
				'.dsh-llm-hub-error{color:var(--dsw-alias-state-error-primary);font-size:11px}',
				// 去掉粗糙灰底框，改用轻量排版标签
				'.dsh-llm-hub-tag{display:inline-flex;align-items:center;gap:3px;padding:0 2px;',
				'border:none;background:transparent;',
				'color:var(--dsw-alias-label-secondary);font-size:11.5px;white-space:nowrap;line-height:16px}',
				'.dsh-llm-hub-tag--muted{opacity:.65}',
				'.dsh-llm-hub-warn-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border-radius:3px;',
				'border:.5px solid var(--dsw-alias-state-warn-primary);background:rgba(234,179,8,.08);',
				'color:var(--dsw-alias-state-warn-primary);font-size:10.5px}',
				// 现代 Ghost 微操作按钮：去硬框、低视觉干扰
				'.dsh-llm-hub-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:3px;',
				'height:22px;padding:0 6px;font:inherit;font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary);',
				'background:transparent;cursor:pointer;border:.5px solid var(--dsw-alias-border-l1);',
				'border-radius:4px;white-space:nowrap;transition:all .15s ease}',
				'.dsh-llm-hub-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);',
				'background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
				'.dsh-llm-hub-btn:disabled{cursor:default;opacity:.45}',
				// API Key 徽章：透明极简底色，精致内联 SVG
				'.dsh-llm-hub-key-badge{box-sizing:border-box;display:inline-flex;align-items:center;',
				'height:20px;padding:0 3px 0 6px;gap:3px;border-radius:4px;flex:0 0 auto;',
				'border:.5px solid var(--dsw-alias-border-l1);background:transparent;',
				'color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;',
				'font-size:10.5px;cursor:pointer;user-select:none;transition:all .15s ease;max-width:260px}',
				'.dsh-llm-hub-quota-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
				'.dsh-llm-hub-key-badge:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);',
				'background:var(--dsw-alias-bg-layer-2)}',
				'.dsh-llm-hub-key-badge.is-copied{border-color:var(--dsw-alias-state-success-primary,#10b981);',
				'color:var(--dsw-alias-state-success-primary,#10b981);background:rgba(16,185,129,.08)}',
				'.dsh-llm-hub-key-badge__text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1}',
				'.dsh-llm-hub-key-badge__copied{display:inline-flex;align-items:center;gap:3px;font-weight:500}',
				'.dsh-llm-hub-key-badge__btn{display:inline-flex;align-items:center;justify-content:center;',
				'width:16px;height:16px;padding:0;border:0;background:0 0;color:inherit;cursor:pointer;',
				'border-radius:3px;opacity:.65;transition:all .12s ease;flex:none}',
				'.dsh-llm-hub-key-badge__btn:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}',
				'.dsh-llm-hub-key-badge__btn.is-active{opacity:1;color:var(--dsw-alias-brand-primary)}',
				// 直接融入 Provider 行的健康与延迟微徽章
				'.dsh-llm-hub-health-badge{display:inline-flex;align-items:center;gap:4.5px;font-size:11px;',
				'font-variant-numeric:tabular-nums;line-height:1;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-health-badge.is-ok{color:var(--dsw-alias-state-success-primary,#10b981)}',
				'.dsh-llm-hub-health-badge.is-err{color:var(--dsw-alias-state-error-primary,#ef4444)}',
				'.dsh-llm-hub-health-dot{width:5px;height:5px;border-radius:50%;flex:none}',
				'.dsh-llm-hub-health-dot.is-ok{background:var(--dsw-alias-state-success-primary,#10b981);box-shadow:0 0 4px rgba(16,185,129,.4)}',
				'.dsh-llm-hub-health-dot.is-err{background:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 4px rgba(239,68,68,.4)}',
				// 状态指示条与小圆点（保留以兼容历史与测试）
				'.dsh-llm-hub-status-text{display:inline-flex;align-items:center;gap:5px;font-size:11px;',
				'color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-status-text.is-err{color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-status-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none}',
				'.dsh-llm-hub-status-dot.is-ok{background:var(--dsw-alias-state-success-primary,#10b981);',
				'box-shadow:0 0 5px rgba(16,185,129,.5)}',
				'.dsh-llm-hub-status-dot.is-err{background:var(--dsw-alias-state-error-primary);',
				'box-shadow:0 0 5px rgba(239,68,68,.5)}',
				'.dsh-llm-hub-dot-sep{opacity:.35;margin:0 1px}',
				// harness
				'.dsh-llm-hub-harness{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;',
				'font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-harness__chip{display:inline-flex;align-items:center;gap:4px;',
				'padding:2px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l1);',
				'background:transparent}',
				'.dsh-llm-hub-harness__chip--missing{opacity:.45}',
				'.dsh-llm-hub-harness__dot{width:5px;height:5px;border-radius:50%;',
				'background:var(--dsw-alias-label-secondary);flex:none}',
				'.dsh-llm-hub-harness__dot--ready{background:var(--dsw-alias-state-success-primary,#10b981)}',
				'.dsh-llm-hub-harness__name{color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-harness__state{opacity:.75}',
				// 目录选择器 Drawer
				'.dsh-llm-hub-picker{margin-top:6px;padding:8px 10px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
				'.dsh-llm-hub-picker__head{display:flex;align-items:center;justify-content:space-between;',
				'gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
				'.dsh-llm-hub-picker__list{max-height:200px;overflow-y:auto;display:flex;',
				'flex-direction:column;gap:2px}',
				'.dsh-llm-hub-picker__item{display:flex;align-items:center;gap:6px;font-size:11.5px;',
				'line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}',
				'.dsh-llm-hub-picker__id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
				'.dsh-llm-hub-picker__tag{font-size:10.5px;padding:0 4px;border-radius:3px;',
				'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3)}',
				// 页脚
				'.dsh-llm-hub-foot{display:flex;align-items:center;gap:10px;margin-top:10px;',
				'padding:2px 2px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.75}',
				'.dsh-llm-hub-foot__name{font-variant-numeric:tabular-nums;opacity:.9}',
				'.dsh-llm-hub-foot__link{color:var(--dsw-alias-label-link);text-decoration:none;',
				'border:0;background:0 0;padding:0;font:inherit;font-size:11px;cursor:pointer}',
				'.dsh-llm-hub-foot__link:hover{text-decoration:underline}',
				'.dsh-llm-hub-chip{box-sizing:border-box;display:inline-flex;align-items:center;height:20px;padding:0 6px;',
				'border-radius:10px;font-size:10.5px;line-height:14px;white-space:nowrap;',
				'border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-chip--hidden{border-color:var(--dsw-alias-state-error-primary);',
				'color:var(--dsw-alias-state-error-primary)}',
				'.dsh-llm-hub-foot__hidden{color:var(--dsw-alias-state-error-primary)}',
				// 用量卡：紧凑通透，不再沉重
				'.dsh-llm-hub-usage{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:transparent;',
				'font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-usage__head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-usage__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-usage__facts{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
				'.dsh-llm-hub-usage__tag{display:inline-flex;align-items:center;gap:3px;padding:0 5px;',
				'border-radius:3px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:10.5px}',
				'.dsh-llm-hub-usage__top{display:flex;flex-direction:column;gap:2px;margin-top:2px}',
				'.dsh-llm-hub-usage__top-row{display:flex;justify-content:space-between;gap:8px;',
				'color:var(--dsw-alias-label-primary);font-size:11px}',
				'.dsh-llm-hub-usage__top-row small{color:var(--dsw-alias-label-secondary);opacity:.8}',
				'.dsh-llm-hub-usage__actions{display:flex;gap:10px;flex-wrap:wrap;padding-top:4px;border-top:.5px solid var(--dsw-alias-border-l1)}',
				// 健康看板：样式保留以兼容
				'.dsh-llm-hub-health{display:none}',
				// 当前路由卡
				'.dsh-llm-hub-routing{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:transparent;',
				'font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-routing__head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-routing__title{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-routing__active{color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-routing__rows{display:flex;flex-direction:column;gap:2px}',
				'.dsh-llm-hub-routing__row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 4px}',
				'.dsh-llm-hub-routing__role{display:inline-flex;align-items:center;height:16px;padding:0 5px;',
				'border-radius:3px;border:.5px solid var(--dsw-alias-border-l2);',
				'background:transparent;font-size:10px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-routing__name{color:var(--dsw-alias-label-primary);font-weight:600}',
				'.dsh-llm-hub-routing__suggestion{color:var(--dsw-alias-state-warn-primary);padding-top:2px}',
				'.dsh-llm-hub-routing__reason{color:var(--dsw-alias-state-error-primary);padding-top:2px}',
				// 多账号 key 轮换
				'.dsh-llm-hub-keypool{display:flex;flex-direction:column;gap:6px;margin-top:10px;',
				'padding:8px 10px;border-radius:6px;',
				'border:.5px solid var(--dsw-alias-border-l1);background:transparent;',
				'font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
				'.dsh-llm-hub-keypool__head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}',
				'.dsh-llm-hub-keypool__title{color:var(--dsw-alias-label-primary);font-weight:600;display:inline-flex;align-items:center;gap:5px}',
				'.dsh-llm-hub-keypool__rows{display:flex;flex-direction:column;gap:3px}',
				'.dsh-llm-hub-keypool__row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#1c1f24);border:.5px solid var(--dsw-alias-border-l1)}',
				'.dsh-llm-hub-keypool__row.is-active{border-color:var(--dsw-alias-state-success-primary,#10b981);box-shadow:0 0 8px rgba(16,185,129,.15)}',
				'.dsh-llm-hub-keypool__name{color:var(--dsw-alias-label-primary);font-weight:600;min-width:120px;font-family:ui-monospace,SFMono-Regular,monospace}',
				'.dsh-llm-hub-keypool__meta{font-size:10.5px;opacity:.7}',
				'.dsh-llm-hub-keypool__chosen{display:flex;align-items:baseline;gap:4px;',
				'color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-keypool__chosen small{color:var(--dsw-alias-label-secondary);opacity:.75;font-size:10.5px}',
				'.dsh-llm-hub-keypool__pending{color:var(--dsw-alias-label-secondary);opacity:.6}',
				// Hero 全景统计大横条
				'.dsh-llm-hub-hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin:12px 0 6px 0}',
				'.dsh-llm-hub-hero__card{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.02));backdrop-filter:blur(6px)}',
				'.dsh-llm-hub-hero__num{font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,monospace;letter-spacing:-0.3px;line-height:1.2}',
				'.dsh-llm-hub-hero__label{font-size:10.5px;color:var(--dsw-alias-label-secondary);opacity:.85}',
				// 热门大模型一键装配 Hub
				'.dsh-llm-hub-presets{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:8px 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l1);background:transparent}',
				'.dsh-llm-hub-presets__head{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;user-select:none}',
				'.dsh-llm-hub-presets__title{color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px;display:inline-flex;align-items:center;gap:5px}',
				'.dsh-llm-hub-presets__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-top:6px}',
				'.dsh-llm-hub-presets__item{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:5px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.02));cursor:pointer;transition:all .15s ease}',
				'.dsh-llm-hub-presets__item:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6);transform:translateY(-1px);background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.05))}',
				'.dsh-llm-hub-presets__name{font-weight:600;font-size:11.5px;color:var(--dsw-alias-label-primary)}',
				'.dsh-llm-hub-presets__desc{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.75;line-height:1.3}',
				'.dsh-llm-hub-presets__detail{margin-top:6px;padding:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.2));border:.5px solid var(--dsw-alias-border-l1);font-size:11px}',
				'.dsh-llm-hub-presets__code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:10px;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);margin:4px 0}',
				// 延迟高亮胶囊
				'.dsh-llm-hub-latency-badge{display:inline-flex;align-items:center;gap:3.5px;padding:1px 5px;border-radius:3px;font-size:10.5px;font-variant-numeric:tabular-nums;line-height:1}',
				'.dsh-llm-hub-latency-badge.is-fast{background:rgba(16,185,129,.08);color:var(--dsw-alias-state-success-primary,#10b981);border:.5px solid rgba(16,185,129,.2)}',
				'.dsh-llm-hub-latency-badge.is-normal{background:rgba(234,179,8,.08);color:var(--dsw-alias-state-warn-primary,#eab308);border:.5px solid rgba(234,179,8,.2)}',
				'.dsh-llm-hub-latency-badge.is-slow{background:rgba(239,68,68,.08);color:var(--dsw-alias-state-error-primary,#ef4444);border:.5px solid rgba(239,68,68,.2)}',
				// Webkubor 插件全家桶互导矩阵
				'.dsh-suite-dock{margin-top:14px;padding:14px 16px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,0.03));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,0.08));border-radius:10px;backdrop-filter:blur(10px)}',
				'.dsh-suite-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px}',
				'.dsh-suite-title{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary);margin:0;display:flex;align-items:center;gap:6px}',
				'.dsh-suite-desc{font-size:10.5px;color:var(--dsw-alias-label-tertiary);letter-spacing:.2px}',
				'.dsh-suite-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}',
				'.dsh-suite-card{display:flex;flex-direction:column;justify-content:space-between;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,0.02));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,0.05));transition:all .2s cubic-bezier(0.16,1,0.3,1)}',
				'.dsh-suite-card:hover{transform:translateY(-1px);border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 4px 14px rgba(0,0,0,0.15)}',
				'.dsh-suite-card-top{display:flex;align-items:center;gap:6px;margin-bottom:4px}',
				'.dsh-suite-card-icon{font-size:15px;line-height:1}',
				'.dsh-suite-card-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);text-decoration:none}',
				'.dsh-suite-card-desc{font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.4;margin-bottom:8px;flex:1}',
				'.dsh-suite-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:auto;font-size:10.5px}',
				'.dsh-suite-badge-active{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-state-success-primary,#10b981);font-weight:600;font-size:10.5px}',
				'.dsh-suite-badge-active-dot{width:5px;height:5px;border-radius:50%;background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.6)}',
				'.dsh-suite-btn-action{cursor:pointer;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:550;background:var(--dsw-alias-interactive-bg-subtle,rgba(255,255,255,0.06));border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);transition:all .15s;text-decoration:none;display:inline-flex;align-items:center;gap:3px}',
				'.dsh-suite-btn-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.12));border-color:var(--dsw-alias-border-l1)}',
				'.dsh-suite-link{color:var(--dsw-alias-label-tertiary);text-decoration:none;font-size:10px;display:inline-flex;align-items:center}',
				'.dsh-suite-link:hover{color:var(--dsw-alias-label-primary)}'
			].join('')
			document.head.appendChild(style)
		}

		/** 矢量 SVG 线条图标集合（彻底杜绝系统 emoji） */
		function EyeIcon() {
			return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
				h('path', { d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' }),
				h('circle', { cx: 12, cy: 12, r: 3 })
			)
		}
		function EyeOffIcon() {
			return h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
				h('path', { d: 'M9.88 9.88a3 3 0 1 0 4.24 4.24' }),
				h('path', { d: 'M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68' }),
				h('path', { d: 'M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61' }),
				h('line', { x1: 2, y1: 2, x2: 22, y2: 22 })
			)
		}
		function CopyIcon() {
			return h('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
				h('rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }),
				h('path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' })
			)
		}
		function CheckIcon() {
			return h('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' },
				h('polyline', { points: '20 6 9 17 4 12' })
			)
		}
		function RefreshIcon(props) {
			return h('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', className: props?.spinning ? 'dsh-llm-hub-spin' : undefined },
				h('path', { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
				h('path', { d: 'M3 3v5h5' }),
				h('path', { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16' }),
				h('path', { d: 'M16 21h5v-5' })
			)
		}

		/**
		 * API Key 脱敏展示与一键复制徽章。
		 * - 默认展示首尾可见的脱敏串（如 mgk_li····8cV9）
		 * - 矢量 Eye 图标切换查看/收起完整明文
		 * - 点击徽章或 Copy 图标一键复制完整 Key，并有绿色无缝状态反馈
		 */
		function ApiKeyBadge(props) {
			const apiKey = typeof props.apiKey === 'string' && props.apiKey.trim() !== '' ? props.apiKey.trim() : null
			const keyMasked = typeof props.keyMasked === 'string' && props.keyMasked.trim() !== '' ? props.keyMasked.trim() : null
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [revealed, setRevealed] = React.useState(false)
			const [copied, setCopied] = React.useState(false)

			if (apiKey === null && keyMasked === null) {
				return h('span', { className: 'dsh-llm-hub-tag dsh-llm-hub-tag--muted' }, t('keyMissing'))
			}

			const rawDisplay = revealed ? (apiKey ?? keyMasked) : (keyMasked ?? '••••••••')
			const display = rawDisplay.replace(/•+/g, '····')

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
				if (apiKey === null) return
				setRevealed((prev) => !prev)
			}

			return h('div', {
				className: 'dsh-llm-hub-key-badge' + (copied ? ' is-copied' : ''),
				title: copied ? t('copiedKey') : (apiKey === null ? t('showKeyUnavailable') : (revealed ? t('hideKeyHint') : t('showKeyHint'))),
				onClick: copyKey
			},
				copied
					? h('span', { className: 'dsh-llm-hub-key-badge__copied' },
						h(CheckIcon, null),
						h('span', null, t('copiedKey'))
					)
					: h('span', { className: 'dsh-llm-hub-key-badge__text' }, display),
				!copied && apiKey !== null ? h('button', {
					type: 'button',
					className: 'dsh-llm-hub-key-badge__btn' + (revealed ? ' is-active' : ''),
					title: revealed ? t('hideKey') : t('showKey'),
					onClick: toggleReveal
				}, revealed ? h(EyeOffIcon, null) : h(EyeIcon, null)) : null,
				!copied ? h('button', {
					type: 'button',
					className: 'dsh-llm-hub-key-badge__btn',
					title: t('copiedKey'),
					onClick: copyKey
				}, h(CopyIcon, null)) : null
			)
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
			const [isRefreshing, setIsRefreshing] = React.useState(false)
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
				setState((prev) => (prev.status === 'ok' ? prev : { status: 'loading' }))
				setIsRefreshing(true)
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
					.finally(() => {
						setIsRefreshing(false)
					})
			}, [keyConfigured])

			React.useEffect(() => {
				load()
			}, [load])

			const primary = state.status === 'ok' && Array.isArray(state.balances) ? state.balances[0] : undefined

			// 余额预警：无条件在最外层声明 Hook，遵从 Rules of Hooks！
			React.useEffect(() => {
				if (!primary || typeof primary.total !== 'string') return
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
			}, [primary?.total, primary?.currency])

			if (state.status === 'nokey') {
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-warn' }, t('noKey')),
						h('span', { className: 'dsh-llm-hub-subtext' }, t('noKeyHint'))
					)
				)
			}

			if (state.status === 'loading' || state.status === 'idle') {
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-subtext' }, t('loading'))
					)
				)
			}

			if (state.status === 'error') {
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-error' }, `${t('failed')}: ${state.error}`),
						h('button', {
							type: 'button',
							className: 'dsh-llm-hub-btn',
							onClick: load
						}, h(RefreshIcon, { spinning: isRefreshing }), t('retry'))
					)
				)
			}

			if (!primary) {
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-subtext' }, t('loading'))
					)
				)
			}

			const symbol = primary.currency === 'CNY' ? '¥' : primary.currency === 'USD' ? '$' : `${primary.currency} `
			const breakdown = []
			if (primary.granted !== '0' && primary.granted !== '0.00') breakdown.push(`${t('granted')} ${symbol}${primary.granted}`)
			if (primary.toppedUp !== '0' && primary.toppedUp !== '0.00') breakdown.push(`${t('toppedUp')} ${symbol}${primary.toppedUp}`)

			return h('div', { className: 'dsh-llm-hub-card' },
				h('div', { className: 'dsh-llm-hub-card__meta' },
					h('div', { className: 'dsh-llm-hub-card__tags' },
						h('span', { className: 'dsh-llm-hub-balance-label' }, t('balance')),
						h('span', { className: 'dsh-llm-hub-amount' + (warning?.level === 'low' ? ' is-low' : '') }, `${symbol}${primary.total}`),
						h('span', { className: 'dsh-llm-hub-meta-sep' }, '·'),
						h('span', { className: 'dsh-llm-hub-meta-text' }, '官方直连'),
						h('span', { className: 'dsh-llm-hub-meta-sep' }, '·'),
						h('span', {
							className: 'dsh-llm-hub-health-badge ' + (state.isAvailable ? 'is-ok' : 'is-err'),
							title: state.isAvailable ? '官方接口连通正常' : t('unavailable')
						},
							h('span', { className: 'dsh-llm-hub-health-dot ' + (state.isAvailable ? 'is-ok' : 'is-err') }),
							state.isAvailable ? '连通正常' : t('unavailable')
						),
						breakdown.length > 0 ? h('span', { className: 'dsh-llm-hub-subtext' }, `(${breakdown.join(' · ')})`) : null,
						hiddenFromDropdown ? h('span', { className: 'dsh-llm-hub-chip dsh-llm-hub-chip--hidden' }, t('availabilityUnavailable')) : null
					),
					h('div', { className: 'dsh-llm-hub-card__btn-group' },
						h(ApiKeyBadge, {
							apiKey: state.apiKey,
							keyMasked: state.keyMasked,
							t
						}),
						h('button', {
							type: 'button',
							className: 'dsh-llm-hub-btn',
							disabled: isRefreshing,
							title: t('refresh'),
							onClick: load
						}, h(RefreshIcon, { spinning: isRefreshing }))
					)
				)
			)
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
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-subtext' }, t('statusLoading'))))
			}
			if (status.ok !== true) {
				return h('div', { className: 'dsh-llm-hub-card' },
					h('div', { className: 'dsh-llm-hub-card__meta' },
						h('span', { className: 'dsh-llm-hub-error' }, typeof status.error === 'string' ? status.error : t('statusFail'))))
			}

			// 元信息标签组（不重复展示外层已有的大标题，只呈现核心事实）
			const tags = []
			tags.push(h('span', { key: 'count', className: 'dsh-llm-hub-tag' }, `${t('configuredModels')} ${status.modelCount} ${t('modelsUnit')}`))
			if (typeof status.api === 'string' && status.api !== '') {
				const shortApi = status.api.replace('-messages', '').replace('-completions', '')
				tags.push(h('span', { key: 'api', className: 'dsh-llm-hub-tag', title: `${t('protocol')}: ${status.api}` }, shortApi))
			}
			if (typeof status.baseURL === 'string' && status.baseURL !== '') {
				let host = status.baseURL
				try { host = new URL(status.baseURL).host } catch {}
				tags.push(h('span', { key: 'sep2', className: 'dsh-llm-hub-meta-sep' }, '·'))
				tags.push(h('span', {
					key: 'base',
					className: 'dsh-llm-hub-meta-text',
					title: `${t('endpoint')}: ${status.baseURL}`
				}, host))
			}

			// 健康与延迟直接融入 Provider 行（消除冗余下方看板）
			const probing = probe !== null && probe.phase === 'loading'
			const probeDone = probe !== null && probe.phase === 'done'
			const latency = probeDone && typeof probe.body?.latencyMs === 'number'
				? probe.body.latencyMs
				: (typeof verdict?.latencyMs === 'number' ? verdict.latencyMs : null)
			const isReachable = probeDone
				? (probe.body?.ok === true && probe.body?.reachable === true)
				: (verdict === undefined || verdict.state !== 'unavailable')
			const errMsg = probeDone
				? (probe.body?.error ?? '')
				: (verdict?.state === 'unavailable' ? (verdict.reason ?? t('availabilityUnavailable')) : '')

			tags.push(h('span', { key: 'sep3', className: 'dsh-llm-hub-meta-sep' }, '·'))
			if (probing) {
				tags.push(h('span', { key: 'health', className: 'dsh-llm-hub-health-badge' }, h(RefreshIcon, { spinning: true }), t('probing')))
			} else if (isReachable) {
				const latencyClass = latency === null ? 'is-fast' : (latency < 300 ? 'is-fast' : (latency < 800 ? 'is-normal' : 'is-slow'))
				tags.push(h('span', {
					key: 'health',
					className: 'dsh-llm-hub-health-badge is-ok',
					title: latency !== null ? `连通正常 · 延迟 ${latency}ms` : '连通正常'
				},
					h('span', { className: 'dsh-llm-hub-health-dot is-ok' }),
					latency !== null
						? h('span', { className: `dsh-llm-hub-latency-badge ${latencyClass}` }, `${latency}ms`)
						: '正常'
				))
			} else {
				tags.push(h('span', {
					key: 'health',
					className: 'dsh-llm-hub-health-badge is-err dsh-llm-hub-chip--hidden',
					title: errMsg || t('availabilityUnavailable')
				},
					h('span', { className: 'dsh-llm-hub-health-dot is-err' }),
					t('availabilityUnavailable')
				))
			}

			const balanceText = renderBalance(balance, t)
			if (balanceText !== null) {
				tags.push(h('span', { key: 'sep4', className: 'dsh-llm-hub-meta-sep' }, '·'))
				tags.push(h('span', { key: 'bal', className: 'dsh-llm-hub-meta-text' }, balanceText))
				if (warning !== null && warning.level === 'low') {
					tags.push(h('span', { key: 'warn', className: 'dsh-llm-hub-warn-badge', title: warning.text }, '⚠️ 额度偏低'))
				}
			}

			// 收拢的操作按钮（Ghost 风格）
			const noBaseURL = status.baseURL === undefined || status.baseURL === ''
			const probeBtn = (key, label, busy, spinning, onClick) => h('button', {
				key,
				type: 'button',
				className: 'dsh-llm-hub-btn',
				disabled: busy,
				onClick
			}, spinning ? h(RefreshIcon, { spinning: true }) : null, label)

			const btnGroup = [
				h(ApiKeyBadge, {
					key: 'key',
					apiKey: status.apiKey,
					keyMasked: status.keyMasked,
					t
				})
			]

			if (!noBaseURL) {
				const pulling = catalog !== null && catalog.phase === 'loading'
				btnGroup.push(probeBtn('probe', probing ? t('probing') : t('probe'), probing, probing, runProbe))
				btnGroup.push(probeBtn('catalog', pulling ? t('pulling') : t('pullCatalog'), pulling, pulling, pullCatalog))
			}

			// 配额不可用时的上游原因不进正文，只留在 title 里
			const quotaNote = balance !== null && typeof balance === 'object' && balance.ok === true
				&& balance.available === false && typeof balance.reason === 'string' && balance.reason.length > 0
				? balance.reason
				: undefined

			let picker = null
			if (!noBaseURL && catalog !== null && catalog.phase === 'done') {
				const body = catalog.body
				if (body?.ok === true && Array.isArray(body.models)) {
					btnGroup.push(probeBtn('copy', copied ? t('copied') : t('copyIds'), false, false, copyIds))

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
							probeBtn('save', saveState === 'saving' ? t('saving') : saveState === 'done' ? t('saved') : saveState === 'fail' ? t('saveFail') : t('save'), saveState === 'saving', saveState === 'saving', saveModels)),
						h('div', { className: 'dsh-llm-hub-picker__list' },
							body.models.map((model) => {
								const alias = aliasesStore.aliasFor(provider, model.id)
								return h('label', {
									key: model.id,
									className: 'dsh-llm-hub-picker__item',
									title: model.id
								},
									h('input', { type: 'checkbox', checked: picked.has(model.id), onChange: () => toggle(model.id) }),
									h('span', { className: 'dsh-llm-hub-picker__id' }, alias === null ? model.id : `${alias} (${model.id})`),
									configured.has(model.id) ? h('span', { className: 'dsh-llm-hub-picker__tag' }, t('configured')) : null)
							})))
				} else {
					btnGroup.push(h('span', { key: 'cat-bad', className: 'dsh-llm-hub-error' }, `${t('failed')}: ${body?.error ?? ''}`))
				}
			}

			const actionsRight = []
			if (hiddenFromDropdown) {
				actionsRight.push(h('span', {
					key: 'hidden-chip',
					className: 'dsh-llm-hub-chip dsh-llm-hub-chip--hidden',
					title: typeof verdict?.reason === 'string' ? verdict.reason : ''
				}, t('availabilityUnavailable')))
			}

			return h('div', null,
				h('div', { className: 'dsh-llm-hub-card', title: quotaNote },
					h('div', { key: 'meta', className: 'dsh-llm-hub-card__meta' },
						h('div', { className: 'dsh-llm-hub-card__tags' }, tags),
						h('div', { className: 'dsh-llm-hub-card__btn-group dsh-llm-hub-actions' },
							btnGroup,
							actionsRight.length > 0 ? actionsRight : null
						)
					)
				),
				picker)
		}

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
		 * 健康看板卡：健康度已直接融合进 Provider 列表，下方不再冗余平铺整张大表。
		 * 保持组件注册以保证向前兼容。
		 */
		function HealthCard(props) {
			return null
		}

		/**
		 * 热门大模型预设库定义
		 */
		const PRESETS = [
			{
				id: 'deepseek',
				name: '🇨🇳 DeepSeek 官方',
				desc: 'V4.1 Flash / V4 Pro 极速官方直连',
				docUrl: 'https://platform.deepseek.com/api_keys',
				yaml: 'llm-deepseek:\n  keyPool:\n    llm-deepseek:\n      - name: "主账号"\n        env: DEEPSEEK_API_KEY\n  models:\n    - id: deepseek-flash\n      name: DeepSeek-V4.1-Flash\n    - id: deepseek-v4-pro\n      name: DeepSeek-V4-Pro'
			},
			{
				id: 'minimax',
				name: '⚡ MiniMax',
				desc: 'MiniMax-M3 百万上下文超强大模型',
				docUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
				yaml: 'minimax:\n  displayName: MiniMax\n  api: openai-completions\n  baseURL: https://api.minimaxi.com/v1\n  apiKeyEnv: MINIMAX_API_KEY\n  models:\n    - id: MiniMax-M3\n      name: MiniMax-M3\n    - id: MiniMax-M2.7\n      name: MiniMax-M2.7'
			},
			{
				id: 'zhipu',
				name: '🧠 智谱清言 GLM',
				desc: 'GLM-5 / GLM-4.7 国内 Coding 利器',
				docUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
				yaml: 'zai-coding-cn:\n  displayName: 智谱 GLM\n  api: openai-completions\n  baseURL: https://open.bigmodel.cn/api/paas/v4\n  apiKeyEnv: ZHIPU_API_KEY\n  models:\n    - id: glm-5-turbo\n    - id: glm-4.7'
			},
			{
				id: 'volc',
				name: '🌋 火山方舟 Ark',
				desc: '字节豆包 Doubao-1.5 多模态矩阵',
				docUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
				yaml: 'volcengine:\n  displayName: 火山方舟\n  api: openai-completions\n  baseURL: https://ark.cn-beijing.volces.com/api/v3\n  apiKeyEnv: ARK_API_KEY\n  models:\n    - id: doubao-1.5-pro-32k\n    - id: doubao-1.5-lite-32k'
			},
			{
				id: 'siliconflow',
				name: '🚀 硅基流动',
				desc: 'SiliconFlow 聚合开源高性价比模型',
				docUrl: 'https://cloud.siliconflow.cn/account/ak',
				yaml: 'siliconflow:\n  displayName: 硅基流动\n  api: openai-completions\n  baseURL: https://api.siliconflow.cn/v1\n  apiKeyEnv: SILICONFLOW_API_KEY\n  models:\n    - id: deepseek-ai/DeepSeek-V3\n    - id: Qwen/Qwen2.5-72B-Instruct'
			},
			{
				id: 'openrouter',
				name: '🌐 OpenRouter',
				desc: '聚合全球 Claude / GPT / Gemini 全模型',
				docUrl: 'https://openrouter.ai/keys',
				yaml: 'openrouter:\n  displayName: OpenRouter\n  api: openai-completions\n  baseURL: https://openrouter.ai/api/v1\n  apiKeyEnv: OPENROUTER_API_KEY\n  models:\n    - id: anthropic/claude-3.7-sonnet\n    - id: deepseek/deepseek-r1'
			}
		]

		/**
		 * 顶部 Hero 统计横条：4 核心极客 KPI
		 */
		function HeroOverviewCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const availability = props.availability
			const availabilityState = availability === undefined
				? { providers: [] }
				: React.useSyncExternalStore(availability.subscribe, availability.snapshot)

			const list = Array.isArray(availabilityState.providers) ? availabilityState.providers : []
			const totalProviders = list.length
			const readyProviders = list.filter((p) => p.state !== 'unavailable').length
			const totalModels = list.reduce((acc, p) => acc + (typeof p.modelCount === 'number' ? p.modelCount : 0), 0)

			const latencies = list.map((p) => p.latencyMs).filter((l) => typeof l === 'number' && l > 0)
			const minLatency = latencies.length > 0 ? Math.min(...latencies) : null

			ensureStyle()

			return h('div', { className: 'dsh-llm-hub-hero' },
				h('div', { className: 'dsh-llm-hub-hero__card' },
					h('span', { className: 'dsh-llm-hub-hero__num' }, totalProviders > 0 ? `${readyProviders} / ${totalProviders}` : '—'),
					h('span', { className: 'dsh-llm-hub-hero__label' }, t('heroProviders'))),
				h('div', { className: 'dsh-llm-hub-hero__card' },
					h('span', { className: 'dsh-llm-hub-hero__num' }, totalModels > 0 ? `${totalModels}` : '—'),
					h('span', { className: 'dsh-llm-hub-hero__label' }, t('heroModels'))),
				h('div', { className: 'dsh-llm-hub-hero__card' },
					h('span', { className: 'dsh-llm-hub-hero__num' }, minLatency !== null ? `${minLatency}ms` : '—'),
					h('span', { className: 'dsh-llm-hub-hero__label' }, t('heroFastest'))),
				h('div', { className: 'dsh-llm-hub-hero__card' },
					h('span', { className: 'dsh-llm-hub-hero__num' }, '🛡️ 100%'),
					h('span', { className: 'dsh-llm-hub-hero__label' }, t('heroSecSafe'))))
		}

		/**
		 * 热门大模型一键装配抽屉
		 */
		function QuickPresetsCard(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [expanded, setExpanded] = React.useState(false)
			const [selected, setSelected] = React.useState(null)
			const [copied, setCopied] = React.useState(false)

			ensureStyle()

			const copyYaml = (e, yaml) => {
				e.stopPropagation()
				navigator.clipboard?.writeText(yaml).then(() => {
					setCopied(true)
					setTimeout(() => setCopied(false), 2000)
				}).catch(() => {})
			}

			return h('div', { className: 'dsh-llm-hub-presets' },
				h('div', {
					className: 'dsh-llm-hub-presets__head',
					onClick: () => setExpanded((prev) => !prev)
				},
					h('span', { className: 'dsh-llm-hub-presets__title' },
						t('presetsTitle'),
						h('span', { style: { fontSize: '10px', opacity: 0.6 } }, expanded ? ' ▲ 收起' : ' ▼ 展开模版')),
					h('span', { className: 'dsh-llm-hub-subtext' }, t('presetsSub'))),
				expanded ? h('div', { className: 'dsh-llm-hub-presets__grid' },
					PRESETS.map((p) => h('div', {
						key: p.id,
						className: 'dsh-llm-hub-presets__item',
						onClick: () => setSelected(selected?.id === p.id ? null : p)
					},
						h('span', { className: 'dsh-llm-hub-presets__name' }, p.name),
						h('span', { className: 'dsh-llm-hub-presets__desc' }, p.desc)))) : null,
				expanded && selected !== null ? h('div', { className: 'dsh-llm-hub-presets__detail' },
					h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
						h('span', { style: { fontWeight: '600' } }, `${selected.name} 配置模版`),
						h('div', { style: { display: 'flex', gap: '6px' } },
							h('button', {
								type: 'button',
								className: 'dsh-llm-hub-btn',
								onClick: (e) => copyYaml(e, selected.yaml)
							}, copied ? t('presetsCopied') : t('presetsCopyBtn')),
							h('a', {
								href: selected.docUrl,
								target: '_blank',
								rel: 'noreferrer',
								className: 'dsh-llm-hub-btn',
								style: { textDecoration: 'none' }
							}, t('presetsDocsBtn')))),
					h('pre', { className: 'dsh-llm-hub-presets__code' }, selected.yaml)) : null)
		}

		/**
		 * 多账号 key 轮换卡：展示当前轮换池状态与活跃 Key
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
				const isActive = chosen !== null
				return h('div', {
					key: entry.provider,
					className: 'dsh-llm-hub-keypool__row' + (isActive ? ' is-active' : '')
				},
					h('span', { className: 'dsh-llm-hub-health-dot ' + (isActive ? 'is-ok' : '') }),
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
					h('span', { className: 'dsh-llm-hub-keypool__title' }, '🔄 ' + t('keypoolTitle')),
					h('span', { className: 'dsh-llm-hub-subtext' }, t('keypoolRound'))),
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
				return null
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
						`${t('routingActive')}: ${activeKey}`,
						h('span', { className: chipClass(active.state) }, active.state === 'available' ? '可用' : '不可用'))
					: h('span', null, t('routingUnconfigured')))
			const rows = candidates.map((entry) => h('div', { key: `${entry.provider}/${entry.model}`, className: 'dsh-llm-hub-routing__row' },
				h('span', { className: 'dsh-llm-hub-routing__role' }, entry.role === 'primary' ? t('routingPrimary') : t('routingFallback')),
				h('span', { className: 'dsh-llm-hub-routing__name' }, `${entry.provider}/${entry.model}`),
				h('span', { className: chipClass(entry.state) }, entry.state === 'available' ? '可用' : '不可用')))
			return h('div', { className: 'dsh-llm-hub-routing' },
				head,
				h('div', { className: 'dsh-llm-hub-routing__rows' }, rows),
				showSuggestion
					? h('div', { className: 'dsh-llm-hub-routing__suggestion' }, `${t('routingSuggestion')}: ${recKey}`)
					: null,
				recommendation === null && candidates.length > 0
					? h('div', { className: 'dsh-llm-hub-routing__reason' }, t('routingNoRecommendation'))
					: null)
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
		 * 用量卡 —— 本月调用与 token 统计。
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
				return null
			}
			ensureStyle()
			const current = report.current
			const hasCalls = (current?.calls ?? 0) > 0
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
			if (hasCalls) {
				facts.push(h('span', { key: 'calls', className: 'dsh-llm-hub-usage__tag' }, `${current.calls} ${t('usageCalls')}`))
				facts.push(h('span', { key: 'in', className: 'dsh-llm-hub-usage__tag' }, `${t('usageInput')} ${formatTokens(current.inputTokens)}`))
				facts.push(h('span', { key: 'out', className: 'dsh-llm-hub-usage__tag' }, `${t('usageOutput')} ${formatTokens(current.outputTokens)}`))
				if ((current.cacheReadTokens ?? 0) > 0 || (current.cacheWriteTokens ?? 0) > 0) {
					facts.push(h('span', { key: 'cache', className: 'dsh-llm-hub-usage__tag' }, `${t('usageCache')} ${formatTokens((current.cacheReadTokens ?? 0) + (current.cacheWriteTokens ?? 0))}`))
				}
				facts.push(h('span', { key: 'total', className: 'dsh-llm-hub-usage__tag' }, `${t('usageTotal')} ${formatTokens(current.totalTokens)}`))
			}
			return h('div', { className: 'dsh-llm-hub-usage' },
				h('div', { className: 'dsh-llm-hub-usage__head' },
					h('span', { className: 'dsh-llm-hub-usage__title' }, t('usageTitle')),
					hasCalls
						? h('div', { className: 'dsh-llm-hub-usage__facts' }, facts)
						: h('span', { className: 'dsh-llm-hub-subtext' }, t('usageNoData'))),
				hasCalls && topModels.length > 0
					? h('div', { className: 'dsh-llm-hub-usage__top' },
						h('div', { className: 'dsh-llm-hub-usage__title' }, t('usageTopModels')),
						topModels.map((row, index) => h('div', { key: `${row.provider}/${row.model}/${index}`, className: 'dsh-llm-hub-usage__top-row' },
							h('span', null, `${row.provider}/${row.model}`),
							h('small', null, `${row.calls} ${t('usageCalls')}`))))
					: null,
				hasCalls
					? h('div', { className: 'dsh-llm-hub-usage__actions' },
						h('button', {
							type: 'button',
							className: 'dsh-llm-hub-foot__link',
							disabled: busy,
							onClick: exportCsv
						}, feedback === 'ok' ? t('usageExported') : feedback === 'fail' ? t('usageExportFail') : t('usageExport')),
						h('button', {
							type: 'button',
							className: 'dsh-llm-hub-foot__link',
							disabled: busy,
							onClick: clearRecords
						}, t('usageClear')))
					: null)
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
		 * Webkubor DSH 扩展家族互导 Dock
		 */
		function WebkuborSuiteDock(props) {
			const t = typeof props.t === 'function' ? props.t : fallbackT
			const [copiedPkg, setCopiedPkg] = React.useState(null)

			ensureStyle()

			const suite = [
				{
					id: '@dsh-plugins/dsh-bloom-theme',
					aliases: ['dsh-bloom-theme', '@dsh-plugins/dsh-bloom-theme'],
					name: 'Bloom Theme',
					icon: '🌸',
					desc: '落霞 Bloom 极客质感毛玻璃主题与代码高亮',
					repo: 'https://github.com/webkubor/dsh-bloom-theme',
					pkg: '@dsh-plugins/dsh-bloom-theme'
				},
				{
					id: '@dsh-plugins/dsh-llm-hub',
					aliases: ['dsh-llm-hub', '@dsh-plugins/dsh-llm-hub'],
					name: 'LLM Hub',
					icon: '🎛️',
					desc: '多模型网关、余额配额、多Key轮换与极客大屏',
					repo: 'https://github.com/webkubor/dsh-llm-hub',
					pkg: '@dsh-plugins/dsh-llm-hub',
					isCurrent: true
				},
				{
					id: '@dsh-plugins/dsh-user-mirror',
					aliases: ['dsh-user-mirror', 'dsh-mirror', '@dsh-plugins/dsh-user-mirror'],
					name: 'User Mirror',
					icon: '🪞',
					desc: '用户角色数字画像、习惯偏好与记忆网络',
					repo: 'https://github.com/webkubor/dsh-mirror',
					pkg: '@dsh-plugins/dsh-user-mirror'
				},
				{
					id: '@dsh-plugins/dsh-env-inspector',
					aliases: ['dsh-env-inspector', '@dsh-plugins/dsh-env-inspector'],
					name: 'Env Inspector',
					icon: '🖥️',
					desc: '端口监听释放、CLI工具链与环境大屏',
					repo: 'https://github.com/webkubor/dsh-env-inspector',
					pkg: '@dsh-plugins/dsh-env-inspector'
				}
			]

			const handleCopy = (pkg) => {
				const cmd = `dsh plugin install ${pkg}`
				if (navigator.clipboard) {
					navigator.clipboard.writeText(cmd)
				}
				setCopiedPkg(pkg)
				setTimeout(() => setCopiedPkg(null), 2000)
			}

			return h('div', { className: 'dsh-suite-dock' },
				h('div', { className: 'dsh-suite-head' },
					h('h3', { className: 'dsh-suite-title' },
						h('span', null, '🌟'),
						t('suiteTitle')
					),
					h('span', { className: 'dsh-suite-desc' }, t('suiteDesc'))
				),
				h('div', { className: 'dsh-suite-cards' },
					...suite.map((item) => {
						const isInstalled = item.isCurrent
						const isCopied = copiedPkg === item.pkg

						return h('div', { key: item.id, className: 'dsh-suite-card' },
							h('div', { className: 'dsh-suite-card-top' },
								h('span', { className: 'dsh-suite-card-icon' }, item.icon),
								h('a', {
									href: item.repo,
									target: '_blank',
									rel: 'noopener noreferrer',
									className: 'dsh-suite-card-name'
								}, item.name)
							),
							h('div', { className: 'dsh-suite-card-desc' }, item.desc),
							h('div', { className: 'dsh-suite-card-bottom' },
								isInstalled ? (
									h('span', { className: 'dsh-suite-badge-active' },
										h('span', { className: 'dsh-suite-badge-active-dot' }),
										t('suiteActive')
									)
								) : (
									h('button', {
										type: 'button',
										className: 'dsh-suite-btn-action',
										onClick: () => handleCopy(item.pkg),
										title: `安装命令: dsh plugin install ${item.pkg}`
									}, isCopied ? `✓ ${t('suiteCopied')}` : `⚡ ${t('suiteCopyInstall')}`)
								),
								h('a', {
									href: item.repo,
									target: '_blank',
									rel: 'noopener noreferrer',
									className: 'dsh-suite-link'
								}, 'GitHub ↗')
							)
						)
					})
				)
			)
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
				id: 'dsh-llm-hub-hero',
				order: 60,
				locale: NS,
				inject: () => ({ t, availability })
			}, HeroOverviewCard))
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-presets',
				order: 65,
				locale: NS,
				inject: () => ({ t })
			}, QuickPresetsCard))
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
			ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
				name: 'settings.models.footer',
				id: 'dsh-llm-hub-suite',
				order: 110,
				locale: NS,
				inject: () => ({ t })
			}, WebkuborSuiteDock))
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
