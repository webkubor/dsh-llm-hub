/**
 * dsh-llm-hub —— Host（Node）半。
 *
 * 给 DSH 的 **DeepSeek 官方直连路由**（`deepseek-official`）补两件官方适配器
 * 自己没做的事：
 *
 *   1. **模型发现**：`ctx.llm.registerModelDiscovery('llm-deepseek', ...)`，
 *      让 Models 页的「获取可用模型」按钮对官方直连生效。
 *   2. **余额查询**：`GET /api/dsh-llm-hub/balance`，转发 DeepSeek 的
 *      `GET /user/balance`，供 client 半渲染余额卡。
 *   3. **pi-ai 旁路补缺**：`/api/dsh-llm-hub/pi-ai/{status,probe,catalog}`，按
 *      `llm-pi-ai` 段里各 provider 的 baseURL/apiKeyEnv 拉网关模型目录。官方
 *      `dsh-llm-pi-ai` 自己占用了 discovery 坑（DUPLICATE_DISCOVERY 抢不了），
 *      且其 LISTABLE_PROTOCOLS 不含 anthropic-messages —— modelgo 这类网关的
 *      官方「获取可用模型」天然失效，这里不改官方行、只旁路补上。
 *
 * ## 为什么占得住
 *
 * `registerModelDiscovery` 按 settings 命名空间索引，**每个命名空间只允许一个
 * 注册**（第二次抛 `DUPLICATE_DISCOVERY`）。而 `@deepseek-ai/dsh-llm-deepseek`
 * 从未注册过发现 —— `0.1.2-rc.1` 与 `0.1.5-rc.2` 两版实测 `discover` 均零命中。
 * 所以 `llm-deepseek` 这个槽是空的，本插件占上即可，**不改动 DSH 任何文件**。
 *
 * ## 连接事实
 *
 * baseURL 与 apiKey 的解析顺序与适配器自身一致，且**每次调用惰性读取**设置段：
 * 插件 apply 时该段可能尚未注册（启动竞态），而适配器本身也是按请求重新解析的 ——
 * 惰性读才能让两边看到同一份文档修订。
 *
 * @module dsh-llm-hub/host
 */

/** 官方直连适配器拥有的 settings 命名空间。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyHarness, harnessReport } from './harness.js'

const NS = 'llm-deepseek'
/** 适配器自身的公网端点默认值。 */
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** 适配器自身的凭据引用默认值。 */
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** 调用方给的端点不得让我们无上限缓冲。 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
/** client 半读取余额的路由。 */
const BALANCE_PATH = '/api/dsh-llm-hub/balance'
/** 官方 pi-ai 适配器拥有的 settings 命名空间；这里只旁路读取，绝不注册 discovery。 */
const PIAI_NS = 'llm-pi-ai'
/** pi-ai 旁路三路由：静态状态 / 网关探测 / 目录明细。 */
const PIAI_STATUS_PATH = '/api/dsh-llm-hub/pi-ai/status'
const PIAI_PROBE_PATH = '/api/dsh-llm-hub/pi-ai/probe'
const PIAI_CATALOG_PATH = '/api/dsh-llm-hub/pi-ai/catalog'
const PIAI_BALANCE_PATH = '/api/dsh-llm-hub/pi-ai/balance'
const PIAI_MODELS_PATH = '/api/dsh-llm-hub/pi-ai/models'
const META_PATH = '/api/dsh-llm-hub/meta'
/** harness 探测自检路由；宿主 info 日志不落盘，靠它从外部确认注册结果。 */
const HARNESS_PATH = '/api/dsh-llm-hub/harness'
/** 模型下拉可用性：读缓存 / 强制全量重探。 */
const AVAILABILITY_PATH = '/api/dsh-llm-hub/availability'
const AVAILABILITY_RECHECK_PATH = '/api/dsh-llm-hub/availability/recheck'
/** 探针结论的保鲜期；过期后下次读取顺手在后台重探，不阻塞下拉。 */
const AVAILABILITY_TTL_MS = 5 * 60 * 1000
/** 一轮探测最长允许在途的时间；超过就允许再开一轮（超时兜底的兜底）。 */
const STUCK_PROBE_MS = 60 * 1000
/** 运行期失败标记的保鲜期：充值/续期后不必等手动刷新。 */
const RUNTIME_TTL_MS = 10 * 60 * 1000
/**
 * 外部请求的超时上界。
 *
 * `fetch` 默认**没有**超时：网关接了 TCP 却不回包（或回一半就停）会让这一轮探测永远不结束，
 * 于是 `probing` 一直 true、判定再也不刷新 —— 表现为「面板停在旧结论上，下拉跟着旧结论走」。
 * 2026-09-16 实测踩到过一次。
 */
const REQUEST_TIMEOUT_MS = 6000
/**
 * 给一次外部请求加超时，并保留调用方自己的取消。
 * @param signal - 调用方取消信号（可选）。
 * @returns 与外层取消、超时二者取先到的信号。
 */
function timeoutSignal(signal) {
	if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return signal
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	if (signal === undefined) return timeout
	if (typeof AbortSignal.any !== 'function') return timeout
	return AbortSignal.any([signal, timeout])
}

/** 官方直连适配器的 provider id（见 @deepseek-ai/dsh-llm-deepseek 的 PROVIDER）。 */
const DEEPSEEK_PROVIDER = 'deepseek-official'

/**
 * 取候选里第一个可用的去空白字符串。
 * @param candidates - 按优先级排列的值。
 * @returns 去空白后的值，全不可用时为 `undefined`。
 */
function label(...candidates) {
	for (const candidate of candidates) {
		if (typeof candidate !== 'string') continue
		const trimmed = candidate.trim()
		if (trimmed.length > 0) return trimmed
	}
	return undefined
}

/**
 * 取候选里第一个可用的正整数。
 * @param candidates - 原始容量字段，按优先级排列。
 * @returns 向下取整后的容量，全不可用时为 `undefined`。
 */
function capacity(...candidates) {
	for (const candidate of candidates) {
		if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return Math.floor(candidate)
	}
	return undefined
}

/**
 * 取候选里第一个可用的**非负**数值。
 *
 * 与 {@link capacity} 分开是必要的：上下文长度 / 最大 token 的 0 是「没填」，
 * 而百分比字段的 0 是**实义** —— 「剩余 0%」就是「用尽」。2026-09-16 实测：
 * 共用 capacity 时 MiniMax 的 `current_interval_remaining_percent: 0` 被当成缺字段
 * 丢掉，于是「余量为零」的账号照样留在模型下拉里。
 * @param candidates - 原始百分比字段，按优先级排列。
 * @returns 第一个非负有限数，全不可用时为 `undefined`。
 */
function percentage(...candidates) {
	for (const candidate of candidates) {
		if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate
	}
	return undefined
}

/**
 * 把一份 OpenAI 风格的模型列表映射成发现候选。
 * @param body - 已解码的响应体。
 * @returns 按端点顺序排列的候选，跳过没有可用 id 的条目。
 * @throws {Error} 当载荷没有 `data` 数组时。
 */
function readListing(body) {
	const data = body?.data
	if (!Array.isArray(data)) throw new Error('the model listing has no "data" array')
	const models = []
	for (const raw of data) {
		const id = label(raw?.id)
		if (id === undefined) continue
		const modelName = label(raw?.name, raw?.display_name)
		const contextWindow = capacity(raw?.context_window, raw?.context_length)
		const maxTokens = capacity(raw?.max_output_tokens, raw?.max_tokens)
		models.push({
			id,
			...(modelName === undefined ? {} : { name: modelName }),
			...(contextWindow === undefined ? {} : { contextWindow }),
			...(maxTokens === undefined ? {} : { maxTokens })
		})
	}
	return models
}

/**
 * 读取响应体，超出上限则拒绝。先看声明长度（诚实的服务器免于传输），
 * 真正生效的是累计字节数。
 * @param response - 流式响应。
 * @param url - 用于拒绝信息的 URL。
 * @returns 解码后的正文。
 * @throws {Error} 当正文超过 {@link MAX_RESPONSE_BYTES} 时。
 */
async function readBounded(response, url) {
	const oversized = () => new Error(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`)
	const declared = Number(response.headers.get('content-length') ?? NaN)
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
		await response.body?.cancel()
		throw oversized()
	}
	if (response.body === null || response.body === undefined) return ''
	const reader = response.body.getReader()
	const chunks = []
	let total = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel()
				throw oversized()
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock?.()
	}
	const merged = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		merged.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new TextDecoder().decode(merged)
}

/**
 * 写一帧 JSON 响应（禁缓存）。
 * @param response - 出站响应。
 * @param status - HTTP 状态码。
 * @param payload - 可序列化载荷。
 */
function sendJson(response, status, payload) {
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store'
	})
	response.end(JSON.stringify(payload))
}

export const name = 'dsh-llm-hub'
/** 发现注册表在 llm 服务上；余额路由在 webServer 上。两者都是硬依赖。 */
export const inject = ['llm', 'webServer']

/**
 * 注册模型发现与余额路由。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {

	/**
	 * 当前已解析的 `llm-deepseek` 设置段。
	 *
	 * 每次调用惰性重读：apply 时该段可能尚未注册，而适配器本身也按请求重解析
	 * 连接事实 —— 惰性读才能让两边看同一份修订。
	 * @returns 已解析的设置段；不可用时为 `undefined`。
	 */
	const sectionOf = () => {
		const settings = ctx.get('settings')
		if (settings === undefined) return undefined
		try {
			const value = settings.get(NS)
			return value !== null && typeof value === 'object' ? value : undefined
		} catch {
			// 命名空间尚未注册时会抛 —— 那是正常启动竞态，不是失败。
			return undefined
		}
	}

	/**
	 * 巡检 settings 段里 `models: []` 的 provider，去对应网关拉一份目录写回。
	 * 启动时跑一次，避免 settings.yaml 里留 `models: []` 这个事实空头；下次 reload / 重启
	 * 时 pi-ai 自己的 onChange 会按 settings 重新注册 model 目录。
	 * 不覆写用户显式填的 models（length > 0 视为已指定）；fetch 失败 best-effort 跳过。
	 * @param source - settings 段 llm-pi-ai 下的整段内容（settings.get(PIAI_NS) 的返回值）。
	 * @returns 要写回的 { providerId: profileWithModels }，空对象表示没东西要写。
	 */
	const populateEmptyProviderModels = async (source) => {
		if (source === undefined || source.providers === undefined) return {}
		const updates = {}
		for (const [provider, profile] of Object.entries(source.providers)) {
			if (!Array.isArray(profile.models) || profile.models.length !== 0) continue
			if (profile.baseURL === undefined || profile.baseURL === '' || profile.apiKeyEnv === undefined) continue
			try {
				const { baseURL, apiKey } = await connectionFacts({
					provider,
					baseURL: profile.baseURL,
					apiKeyEnv: profile.apiKeyEnv
				})
				const url = `${baseURL}/models`
				const headers = { accept: "application/json" }
				if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
				const response = await fetch(url, { method: 'GET', headers, signal: timeoutSignal() })
				if (!response.ok) continue
				const body = await readBounded(response, url)
				const models = readListing(JSON.parse(body))
				if (models.length > 0) {
					updates[provider] = { ...profile, models }
				}
			} catch {
				/* best-effort */
			}
		}
		return updates
	}

	/**
	 * 解析本次调用要用的连接事实。
	 * @param request - 可选的一次性覆盖（发现草稿会带 baseURL / apiKey）。
	 * @returns baseURL、凭据引用与可用密钥。
	 */
	const connectionFacts = async (request = {}) => {
		const section = sectionOf() ?? {}
		const baseURL = (label(
			request.baseURL,
			section.baseURL,
			process.env.DEEPSEEK_BASE_URL,
			DEFAULT_BASE_URL
		) ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
		const ref = label(request.apiKeyEnv, section.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
		const explicit = label(request.apiKey)
		let apiKey = explicit
		if (apiKey === undefined) {
			const credentials = ctx.get('credentials')
			if (credentials !== undefined) {
				const hit = await credentials.resolve(ref)
				apiKey = label(hit?.value)
			}
		}
		if (apiKey === undefined) apiKey = label(process.env[ref])
		return { baseURL, ref, apiKey }
	}

	/**
	 * GET 一个 DeepSeek 端点并解析 JSON。
	 * @param path - 端点路径，如 `/models`。
	 * @param request - 可选的连接事实覆盖。
	 * @param signal - 调用方取消。
	 * @returns 解析后的 JSON。
	 */
	const getJson = async (path, request, signal) => {
		const { baseURL, apiKey } = await connectionFacts(request)
		const url = `${baseURL}${path}`
		const headers = { accept: 'application/json' }
		if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
		let response
		try {
			response = await fetch(url, {
				method: 'GET',
				headers,
				signal: timeoutSignal(signal)
			})
		} catch (error) {
			if (signal?.aborted) throw new Error('the request was cancelled')
			throw new Error(`could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (!response.ok) {
			const hint = response.status === 401 || response.status === 403 ? '; check the API key' : ''
			throw new Error(`${url} answered ${response.status}${hint}`)
		}
		const text = await readBounded(response, url)
		try {
			return JSON.parse(text)
		} catch {
			throw new Error(`${url} did not answer with JSON`)
		}
	}

	//#region 1) 模型发现
	ctx.llm.registerModelDiscovery(NS, async (request, signal) => readListing(await getJson('/models', request, signal)))
	//#endregion

	//#region 2) 余额路由
	/**
	 * 把上游余额载荷整理成 client 半要的形状。
	 *
	 * 上游是 `{ is_available, balance_infos: [{ currency, total_balance,
	 * granted_balance, topped_up_balance }] }`，金额是**字符串**（避免浮点误差），
	 * 所以这里原样保留字符串，只在必要时解析。
	 * @param body - 上游载荷。
	 * @returns 精简后的载荷。
	 */
	const shapeBalance = (body) => {
		const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
		return {
			isAvailable: body?.is_available === true,
			balances: infos
				.filter((info) => info !== null && typeof info === 'object')
				.map((info) => ({
					currency: label(info.currency) ?? '',
					total: label(info.total_balance) ?? '0',
					granted: label(info.granted_balance) ?? '0',
					toppedUp: label(info.topped_up_balance) ?? '0'
				}))
		}
	}

	/**
	 * 只允许同源浏览器读取。余额是账户信息，即使服务绑在 loopback 也不该
	 * 被跨站页面读走。
	 * @param request - 进来的请求。
	 * @returns 是否放行。
	 */
	const sameOrigin = (request) => {
		const site = request.headers['sec-fetch-site']
		if (typeof site === 'string') return site === 'same-origin' || site === 'none'
		return true
	}

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: BALANCE_PATH,
		handler: async (request, response) => {
			const send = (status, payload) => {
				response.writeHead(status, {
					'content-type': 'application/json; charset=utf-8',
					'cache-control': 'no-store'
				})
				response.end(JSON.stringify(payload))
			}
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405, { allow: 'GET, HEAD' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				send(403, { ok: false, error: 'cross-origin balance reads are refused' })
				return
			}
			try {
				const payload = shapeBalance(await getJson('/user/balance'))
				if (request.method === 'HEAD') {
					response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
					response.end()
					return
				}
				send(200, { ok: true, ...payload })
			} catch (error) {
				send(502, { ok: false, error: error instanceof Error ? error.message : String(error) })
			}
		}
	}), 'dsh-llm-hub: balance route')
	//#endregion

	//#region 3) pi-ai 旁路补缺
	// 官方 dsh-llm-pi-ai 占着自己的 discovery 坑，且 LISTABLE_PROTOCOLS 只认
	// openai-completions / openai-responses：modelgo（anthropic-messages）与
	// 无 baseURL 的 zai-coding-cn 官方发现天然失效。这里不注册 discovery，
	// 只提供 status / probe / catalog 三条旁路路由，全部只读、可逆、同源受限。

	/**
	 * 枚举 `llm-pi-ai` 段里的全部 provider。
	 *
	 * 判定目标必须从**设置段**来，而不是 `ctx.llm.listProviders()` —— 后者正是本插件
	 * 过滤器的输出，拿它当目标会变成「隐藏即永久」。
	 * @returns [providerId, profile] 列表；段不可读时为空数组。
	 */
	const piaiProviders = () => {
		const settings = ctx.get('settings')
		if (settings === undefined) return []
		try {
			const section = settings.get(PIAI_NS)
			const providers = section !== null && typeof section === 'object' ? section.providers : undefined
			if (providers === null || typeof providers !== 'object') return []
			return Object.entries(providers).filter(([, profile]) => profile !== null && typeof profile === 'object')
		} catch {
			// 命名空间尚未注册（启动竞态）——安静降级
			return []
		}
	}

	/**
	 * 惰性读取 `llm-pi-ai` 段里某个 provider 的 profile。
	 * @param provider - 段内 providers 键名，如 `modelgo`。
	 * @returns 该 provider 的原始 profile；不可用时为 `undefined`。
	 */
	const piaiProfileOf = (provider) => {
		if (typeof provider !== 'string' || provider.length === 0) return undefined
		const settings = ctx.get('settings')
		if (settings === undefined) return undefined
		try {
			const section = settings.get(PIAI_NS)
			const providers = section !== null && typeof section === 'object' ? section.providers : undefined
			const profile = providers !== null && typeof providers === 'object' ? providers[provider] : undefined
			return profile !== null && typeof profile === 'object' ? profile : undefined
		} catch {
			// 命名空间尚未注册（官方 pi-ai 适配器未就绪的启动竞态）——安静降级。
			return undefined
		}
	}

	/**
	 * 解析某 provider 本次调用的连接事实：baseURL 与可用密钥。
	 * 与 deepseek 侧一致：先凭据服务，再进程环境，全程惰性。
	 * @param profile - 段内原始 profile。
	 * @param request - 调用方一次性覆盖（apiKey / baseURL）。
	 * @returns baseURL（去尾斜杠）、凭据引用与可用密钥。
	 */
	const piaiConnection = async (profile, request = {}) => {
		const baseURL = label(request.baseURL, profile?.baseURL)?.replace(/\/+$/, '')
		const ref = label(profile?.apiKeyEnv)
		let apiKey = label(request.apiKey)
		if (apiKey === undefined && ref !== undefined) {
			const credentials = ctx.get('credentials')
			if (credentials !== undefined) {
				const hit = await credentials.resolve(ref).catch(() => undefined)
				apiKey = label(hit?.value)
			}
		}
		if (apiKey === undefined && ref !== undefined) apiKey = label(process.env[ref])
		return { baseURL, ref, apiKey }
	}

	/**
	 * 已知服务商的官方 baseURL —— settings 里没填时用它兜底。
	 *
	 * 2026-09-15 owner 指出的矛盾：智谱的余额能查通（余额适配器自带 hostFor，
	 * 硬编码了 open.bigmodel.cn），探测却说「未配置 baseURL，无法探测」——
	 * 同一个 provider，一条路知道它在哪、另一条说不知道。地址是公开且固定的，
	 * 没理由因为用户没在设置里抄一遍就拒绝探测。
	 *
	 * 只收地址公开且固定的服务商；自建网关（ModelGo 等）不进这张表，
	 * 它们的地址因人而异，猜不得。
	 */
	const KNOWN_GATEWAY_BASE = {
		'zai-coding-cn': 'https://open.bigmodel.cn/api/paas/v4',
		zhipu: 'https://open.bigmodel.cn/api/paas/v4',
		'zai-coding': 'https://api.z.ai/api/paas/v4',
		minimax: 'https://api.minimaxi.com/v1',
		moonshot: 'https://api.moonshot.cn/v1',
		stepfun: 'https://api.stepfun.com/v1'
	}

	/**
	 * GET 网关模型目录，`/v1/models` 与 `/models` 依 baseURL 形态自动回退
	 * （modelgo 实测 `/models` 404、`/v1/models` 200；以 `/v1` 结尾的 base 只试
	 * `/models`），并测量到首个可用响应的耗时。
	 * @param profile - 段内原始 profile。
	 * @param request - 调用方一次性覆盖。
	 * @returns 统一结果：`ok=true` 带 models，`ok=false` 带 code 与 error。
	 */
	const piaiListing = async (profile, request = {}, provider) => {
		const conn = await piaiConnection(profile, request)
		const { ref, apiKey } = conn
		const baseURL = conn.baseURL ?? KNOWN_GATEWAY_BASE[String(provider ?? '')]
		if (baseURL === undefined) {
			return { ok: false, code: 'NO_BASE_URL', ref, error: '该 provider 没有配置 baseURL，无法访问网关目录' }
		}
		const candidates = baseURL.endsWith('/v1') ? [`${baseURL}/models`] : [`${baseURL}/v1/models`, `${baseURL}/models`]
		const startedAt = Date.now()
		let lastError
		for (const url of candidates) {
			try {
				const response = await fetch(url, {
					method: 'GET',
					headers: { accept: 'application/json', ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }) },
					signal: timeoutSignal()
				})
				if (response.status === 404) {
					lastError = `${url} answered 404`
					continue
				}
				if (!response.ok) {
					const hint = response.status === 401 || response.status === 403 ? '; check the API key' : ''
					return { ok: false, code: 'HTTP_ERROR', status: response.status, latencyMs: Date.now() - startedAt, ref, error: `${url} answered ${response.status}${hint}` }
				}
				const text = await readBounded(response, url)
				let body
				try {
					body = JSON.parse(text)
				} catch {
					return { ok: false, code: 'BAD_JSON', latencyMs: Date.now() - startedAt, ref, error: `${url} did not answer with JSON` }
				}
				let models
				try {
					models = readListing(body)
				} catch (error) {
					return { ok: false, code: 'BAD_PAYLOAD', latencyMs: Date.now() - startedAt, ref, error: error instanceof Error ? error.message : String(error) }
				}
				return { ok: true, url, latencyMs: Date.now() - startedAt, ref, models }
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error)
			}
		}
		return { ok: false, code: 'UNREACHABLE', latencyMs: Date.now() - startedAt, ref, error: lastError }
	}

	/**
	 * 把 `llm-pi-ai` 段里某 provider 的静态事实整理给 client 半。
	 * @param provider - 段内 providers 键名。
	 * @returns 含已配模型数与 keyConfigured 的载荷。
	 */
	const piaiStatus = async (provider) => {
		const profile = piaiProfileOf(provider)
		if (profile === undefined) return { ok: false, error: `llm-pi-ai 段里没有 "${provider ?? ''}" 这个 provider` }
		const { baseURL, ref, apiKey } = await piaiConnection(profile)
		const models = Array.isArray(profile.models) ? profile.models : []
		return {
			ok: true,
			provider,
			displayName: label(profile.displayName) ?? provider,
			api: label(profile.api),
			// baseURL 也走已知网关兜底 —— 否则会出现「余额查得通、探测说没地址」这种
			// 自相矛盾的显示（2026-09-15 owner 指出）。source 让前端能区分是人填的
			// 还是我们兜的，必要时可以提示。
			baseURL: baseURL ?? KNOWN_GATEWAY_BASE[String(provider ?? '')],
			baseURLSource: baseURL !== undefined ? 'settings' : (KNOWN_GATEWAY_BASE[String(provider ?? '')] !== undefined ? 'known' : 'none'),
			apiKeyEnv: ref,
			keyConfigured: apiKey !== undefined,
			modelCount: models.length,
			// 已配置的 id 列表：前端拉到网关目录后要据此把「已经在用的」默认勾上，
			// 光有数量做不到这件事。
			modelIds: models.map((m) => (m !== null && typeof m === 'object' ? m.id : m)).filter((id) => typeof id === 'string'),
			balanceAdapter: balanceAdapterFor(provider, profile) ?? null
		}
	}

	/**
	 * 余额/配额适配器表 —— 只收各 provider **公开文档化或实测可用**的开放端点，
	 * 鉴权形态与响应字段均按 2026-09 实测核对：
	 *
	 * - minimax  `GET /v1/token_plan/remains`（Bearer）→ `model_remains[]` 百分比余量
	 * - zhipu    `GET {host}/api/monitor/usage/quota/limit`（裸 key）→ `data.limits[]`，
	 *   国内 coding 套餐 host 是 open.bigmodel.cn，国际站是 api.z.ai；
	 *   未购套餐时返回 `{success:false, msg:'当前用户不存在coding plan'}` —— 如实透传
	 * - moonshot `GET /v1/users/me/balance`（Bearer）→ `data.total_balance` 现金
	 * - stepfun  `GET /v1/accounts`（Bearer）→ `balance / total_cash_balance / total_voucher_balance`
	 *
	 * ModelGo 等自建网关没有开放计费路由（`/v1/dashboard/billing/*` 实测 404），
	 * 匹配不到适配器时如实报 `supported:false`，绝不猜端点。
	 */
	const BALANCE_ADAPTERS = {
		minimax: {
			kind: 'plan',
			meaning: 'remain',
			defaultBase: 'https://api.minimaxi.com',
			path: (base) => `${base.endsWith('/v1') ? base : `${base}/v1`}/token_plan/remains`,
			auth: 'bearer',
			shape: (body) => {
				const rows = Array.isArray(body?.model_remains) ? body.model_remains : []
				const items = []
				for (const row of rows) {
					if (row === null || typeof row !== 'object') continue
					const percent = percentage(row.current_interval_remaining_percent)
					if (percent === undefined) continue
					items.push({
						label: label(row.model_name) ?? 'plan',
						percent,
						weeklyPercent: percentage(row.current_weekly_remaining_percent)
					})
				}
				return { items }
			}
		},
		zhipu: {
			kind: 'quota',
			meaning: 'used',
			hostFor: (provider) => (provider.includes('cn') || provider.includes('bigmodel') ? 'https://open.bigmodel.cn' : 'https://api.z.ai'),
			path: (base) => `${base}/api/monitor/usage/quota/limit`,
			auth: 'raw',
			shape: (body) => {
				if (body?.success === false || (typeof body?.code === 'number' && body.code !== 200)) {
					return { unavailable: label(body?.msg) ?? 'quota unavailable' }
				}
				const limits = Array.isArray(body?.data?.limits) ? body.data.limits : []
				const items = []
				for (const lim of limits) {
					if (lim === null || typeof lim !== 'object') continue
					const tier = lim.type === 'TOKENS_LIMIT' && lim.unit === 3 ? '5h'
						: lim.type === 'TOKENS_LIMIT' && lim.unit === 6 ? 'week'
						: lim.type === 'TIME_LIMIT' ? 'tools'
						: undefined
					if (tier === undefined) continue
					const percent = percentage(lim.percentage)
					if (percent === undefined) continue
					items.push({ label: tier, percent })
				}
				return { level: label(body?.data?.level), items }
			}
		},
		moonshot: {
			kind: 'cash',
			defaultBase: 'https://api.moonshot.cn',
			path: (base) => `${base}/v1/users/me/balance`,
			auth: 'bearer',
			shape: (body) => {
				const total = label(body?.data?.total_balance) ?? label(body?.data?.available_balance)
				if (total === undefined) return { unavailable: 'no balance field in answer' }
				return { items: [{ label: 'balance', amount: total, currency: 'CNY' }] }
			}
		},
		stepfun: {
			kind: 'cash',
			defaultBase: 'https://api.stepfun.com',
			path: (base) => `${base}/v1/accounts`,
			auth: 'bearer',
			shape: (body) => {
				const total = label(body?.balance)
				if (total === undefined) return { unavailable: 'no balance field in answer' }
				return { items: [{ label: 'balance', amount: total, currency: 'CNY', voucher: label(body?.total_voucher_balance) }] }
			}
		}
	}

	/**
	 * 按 provider id 与 baseURL 猜测适用的余额适配器。
	 * @param provider - 段内 providers 键名。
	 * @param profile - 段内原始 profile。
	 * @returns 适配器键名；无匹配时为 `undefined`。
	 */
	const balanceAdapterFor = (provider, profile) => {
		const haystack = `${provider} ${label(profile?.baseURL) ?? ''}`.toLowerCase()
		if (haystack.includes('minimax')) return 'minimax'
		if (haystack.includes('zhipu') || haystack.includes('zai') || haystack.includes('bigmodel') || haystack.includes('glm')) return 'zhipu'
		if (haystack.includes('moonshot') || haystack.includes('kimi')) return 'moonshot'
		if (haystack.includes('step')) return 'stepfun'
		return undefined
	}

	/**
	 * 查询某 provider 的余额/配额。统一信封：`{ ok, kind, available, items?, reason? }`；
	 * 匹配不到适配器给 `{ ok, supported:false }`，无 key / 上游失败都折叠成 `available:false`
	 * 加人话 reason，绝不把异常直接抛给浏览器。
	 * @param provider - 段内 providers 键名。
	 * @returns 余额信封载荷。
	 */
	const piaiBalance = async (provider) => {
		const profile = piaiProfileOf(provider)
		if (profile === undefined) return { ok: false, error: `llm-pi-ai 段里没有 "${provider ?? ''}" 这个 provider` }
		const adapterName = balanceAdapterFor(provider, profile)
		if (adapterName === undefined) return { ok: true, provider, supported: false }
		const adapter = BALANCE_ADAPTERS[adapterName]
		const { ref, apiKey } = await piaiConnection(profile)
		if (apiKey === undefined) {
			return { ok: true, provider, kind: adapter.kind, available: false, reason: '还没填 API key' }
		}
		const host = adapter.hostFor !== undefined ? adapter.hostFor(provider) : (label(profile?.baseURL)?.replace(/\/+$/, '') ?? adapter.defaultBase)
		// 设置页是给用人看的，不是给写代码的人看的 —— reason 一律是人话，技术细节走 detail。
		// 2026-09-15 owner 指出：智谱没配 baseURL 时，卡片上直接印出
		// 「could not reach /api/monitor/usage/quota/limit: Failed to parse URL from ...」，
		// 那是 fetch 的原始异常，对着它读的人既不知道发生了什么，也不知道该做什么。
		const fail = (reason, detail) => ({ ok: true, provider, kind: adapter.kind, available: false, reason, detail })
		if (host === undefined || host === null || !/^https?:\/\//i.test(String(host))) {
			// 最常见的一种：没填服务地址，URL 拼出来是相对路径，fetch 直接抛解析错误。
			// 与其让它抛，不如提前说清楚缺什么。
			return fail('未填写服务地址，查不了余额')
		}
		const url = adapter.path(host)
		// 拼完再验一次：zhipu 的 path 曾经写成 () => '/api/...'，把 base 参数整个丢掉，
		// 于是 hostFor 明明给对了域名，fetch 拿到的仍是相对路径。适配器是一张表，
		// 表里任何一行写错都不该让用户看见一句 Failed to parse URL。
		if (!/^https?:\/\//i.test(url)) {
			return fail('这家服务商的余额接口暂时用不了', `adapter ${adapterName} produced a non-absolute url: ${url}`)
		}
		const headers = { accept: 'application/json' }
		headers.authorization = adapter.auth === 'raw' ? apiKey : `Bearer ${apiKey}`
		let response
		try {
			response = await fetch(url, { method: 'GET', headers, signal: timeoutSignal() })
		} catch (error) {
			return fail('连不上服务商', `${url}: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (!response.ok) {
			const hint = response.status === 401 || response.status === 403 ? 'API key 可能无效或没有查询余额的权限'
				: response.status === 404 ? '这家服务商没有提供余额查询接口'
				: '服务商暂时没有返回余额'
			return fail(hint, `${url} answered ${response.status}`)
		}
		const text = await readBounded(response, url)
		let body
		try {
			body = JSON.parse(text)
		} catch {
			return fail('服务商返回的内容看不懂', `${url} did not answer with JSON`)
		}
		const shaped = adapter.shape(body)
		if (shaped.unavailable !== undefined) {
			return { ok: true, provider, kind: adapter.kind, available: false, reason: shaped.unavailable }
		}
		return { ok: true, provider, kind: adapter.kind, adapter: adapterName, meaning: adapter.meaning, level: shaped.level, items: shaped.items ?? [] }
	}

	/**
	 * 三条旁路路由共用的注册体：只放行 GET/HEAD，只放行同源。
	 * @param path - 精确路由路径。
	 * @param respond - 由 query.provider 算出载荷的异步函数。
	 * @param tag - ctx.effect 的注册标签。
	 */
	const registerPiaiRoute = (path, respond, tag) => ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path,
		handler: async (request, response) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405, { allow: 'GET, HEAD' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin reads are refused' })
				return
			}
			if (request.method === 'HEAD') {
				response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
				response.end()
				return
			}
			try {
				const raw = String(request.url ?? '')
				const qIndex = raw.indexOf('?')
				const provider = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1)).get('provider')
				const payload = await respond(provider)
				sendJson(response, 200, payload)
			} catch (error) {
				sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
			}
		}
	}), tag)

	registerPiaiRoute(PIAI_STATUS_PATH, piaiStatus, 'dsh-llm-hub: pi-ai status route')
	registerPiaiRoute(PIAI_PROBE_PATH, async (provider) => {
		const status = await piaiStatus(provider)
		if (!status.ok) return status
		const listing = await piaiListing(piaiProfileOf(provider), {}, provider)
		return listing.ok
			? { ok: true, provider, reachable: true, latencyMs: listing.latencyMs, remoteCount: listing.models.length, sample: listing.models.slice(0, 5).map((model) => model.id) }
			: { ok: true, provider, reachable: false, code: listing.code, latencyMs: listing.latencyMs, error: listing.error }
	}, 'dsh-llm-hub: pi-ai probe route')
	registerPiaiRoute(PIAI_CATALOG_PATH, async (provider) => {
		const listing = await piaiListing(piaiProfileOf(provider), {}, provider)
		return listing.ok ? { ok: true, provider, latencyMs: listing.latencyMs, models: listing.models } : listing
	}, 'dsh-llm-hub: pi-ai catalog route')
	/**
	 * 插件自己的元信息 —— 版本、仓库、反馈入口。
	 *
	 * 2026-09-15 owner：「人家写的插件都有（GitHub / 问题反馈 / 检查更新），你也加上，
	 * 不然别人没有反馈，没法闭环」。版本号从 package.json 读，不在前端硬编码 ——
	 * 硬编码的版本每次发版都要记得改一次，而忘记改的那次没人会发现。
	 */
	// 本包是 ESM（package.json type: module），没有 require —— 用 import.meta.url
	// 定位自己再读同级的 package.json。第一版写了 require('../package.json')，
	// 装上去直接 `require is not defined`，而这种错只在运行时暴露。
	const pluginMeta = () => {
		try {
			const here = fileURLToPath(new URL('../package.json', import.meta.url))
			const pkg = JSON.parse(readFileSync(here, 'utf8'))
			return { ok: true, name: pkg.name, version: pkg.version, homepage: pkg.homepage, issues: pkg.bugs?.url }
		} catch (error) {
			return { ok: false, error: '读不到插件元信息', detail: error instanceof Error ? error.message : String(error) }
		}
	}
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: META_PATH,
		handler: async (request, response) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405, { allow: 'GET, HEAD' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin reads are refused' })
				return
			}
			sendJson(response, 200, pluginMeta())
		}
	}), 'dsh-llm-hub: meta route')

	registerPiaiRoute(PIAI_BALANCE_PATH, piaiBalance, 'dsh-llm-hub: pi-ai balance route')

	/**
	 * 把勾选的模型 id 写回 `llm-pi-ai.providers.<id>.models`。
	 *
	 * 这是本插件唯一的写操作 —— 拉到网关目录却只能"复制全部 id"再手工粘回配置文件，
	 * 等于把最后一公里留给了人。2026-09-15 owner：「模型页面里没地方显示当前网关
	 * 支持的模型，无法自己选择」。
	 *
	 * 写入纪律：
	 * - 只接受 POST + 同源（与读路由同一套 sameOrigin）
	 * - 只动 models 一个字段，profile 其余部分原样保留 —— 不替换整段
	 * - 已配置的模型保留其 name/contextWindow 等既有字段，新加的只写 id 与 name
	 */
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: PIAI_MODELS_PATH,
		handler: async (request, response) => {
			if (request.method !== 'POST') {
				response.writeHead(405, { allow: 'POST' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin writes are refused' })
				return
			}
			let payload
			try {
				const chunks = []
				for await (const chunk of request) chunks.push(chunk)
				payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
			} catch {
				sendJson(response, 400, { ok: false, error: '请求内容不是合法 JSON' })
				return
			}
			const provider = label(payload?.provider)
			const ids = Array.isArray(payload?.ids) ? payload.ids.filter((id) => typeof id === 'string' && id.length > 0) : undefined
			if (provider === undefined || ids === undefined) {
				sendJson(response, 400, { ok: false, error: '缺少 provider 或 ids' })
				return
			}
			const settings = ctx.get('settings')
			if (settings === undefined) {
				sendJson(response, 500, { ok: false, error: '设置服务不可用' })
				return
			}
			const profile = piaiProfileOf(provider)
			if (profile === undefined) {
				sendJson(response, 404, { ok: false, error: `llm-pi-ai 段里没有 "${provider}" 这个 provider` })
				return
			}
			// 保留既有模型的完整定义（contextWindow / maxTokens / input 等都是人填的，
			// 不能因为一次勾选就抹平）；新增的只有 id。
			const existing = Array.isArray(profile.models) ? profile.models : []
			const byId = new Map(existing.filter((m) => m !== null && typeof m === 'object' && typeof m.id === 'string').map((m) => [m.id, m]))
			const models = ids.map((id) => byId.get(id) ?? { id, name: id })
			try {
				await settings.update(PIAI_NS, { providers: { [provider]: { ...profile, models } } })
			} catch (error) {
				sendJson(response, 500, { ok: false, error: '写入设置失败', detail: error instanceof Error ? error.message : String(error) })
				return
			}
			sendJson(response, 200, { ok: true, provider, count: models.length })
		}
	}), 'dsh-llm-hub: pi-ai models write route')
	//#endregion

	//#region 4) 模型可用性（composer 下拉门禁）
	// 目标：composer 的模型下拉只列「当前确实能用」的分组。
	//
	// 判定纪律（2026-09-16 owner：「我默认我的下拉里都是可用的」）：
	//   · **只认确凿证据**：凭据解析不到、网关明确 401/403/402、余额确凿为 0、
	//     配额确凿用尽、最近一次真实请求因鉴权/欠费失败。
	//   · **拿不准一律放行**（fail-open）：探测超时、404、协议不支持目录端点、
	//     余额接口查不通 —— 全都记 `unknown` 而不隐藏。误藏一个能用的模型，
	//     比多显示一个不能用的更糟：前者让人以为插件坏了。
	//   · 服务端只管判定；「从下拉里摘掉」在 client 半做（目录无法在 host 侧过滤）。

	/** provider -> 探针判定（凭据 / 探测 / 余额）。 */
	const baseVerdicts = new Map()
	/** provider -> 最近一次运行期失败判定（真实请求的鉴权/欠费错误）。 */
	const runtimeMarks = new Map()
	/** provider -> 最近一次真实请求成功的时刻。 */
	const successAt = new Map()
	/** 全量重探的去重句柄。 */
	let probeAll = null
	/** 探针代际：手动重探会 +1，让在途的旧探针彻底作废。 */
	let probeGeneration = 0
	/** 本轮流探的起始时刻；配合 REQUEST_TIMEOUT_MS 兜住「理论上不会发生」的卡死。 */
	let probeStartedAt = 0
	/** 上次全量重探完成时刻；0 表示还没成功过。 */
	let lastProbeAt = 0

	const describeError = (error) => (error instanceof Error ? error.message : String(error))

	/**
	 * 官方直连（deepseek-official）的判定：凭据 → 目录探测 → 余额。
	 * @returns 判定结果（不含 provider/displayName）。
	 */
	const probeDeepseek = async () => {
		const { baseURL, ref, apiKey } = await connectionFacts()
		if (apiKey === undefined) {
			return { state: 'unavailable', code: 'CREDENTIAL_MISSING', source: 'credential', reason: `没配 API key（${ref} 解析不到），请求会直接失败` }
		}
		const url = `${baseURL}/models`
		let response
		try {
			response = await fetch(url, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` }, signal: timeoutSignal() })
		} catch (error) {
			return { state: 'unknown', code: 'UNREACHABLE', source: 'probe', reason: `探测不到 ${baseURL}：${describeError(error)}` }
		}
		if (response.status === 401 || response.status === 403) {
			return { state: 'unavailable', code: 'AUTH_REJECTED', source: 'probe', reason: `API key 被拒（HTTP ${response.status}）` }
		}
		if (response.status === 402) {
			return { state: 'unavailable', code: 'PAYMENT_REQUIRED', source: 'probe', reason: '账户欠费（HTTP 402）' }
		}
		if (!response.ok && response.status !== 404) {
			return { state: 'unknown', code: 'HTTP_ERROR', source: 'probe', reason: `${url} 返回 HTTP ${response.status}` }
		}
		// 余额：官方直连有公开的 /user/balance，is_available=false 就是「调不了」。
		// 查不通不构成隐藏理由 —— 那只说明余额接口这次没通。
		try {
			const body = shapeBalance(await getJson('/user/balance'))
			if (body.isAvailable !== true) {
				return { state: 'unavailable', code: 'ACCOUNT_UNAVAILABLE', source: 'balance', reason: '账户不可用（/user/balance 报 is_available=false）' }
			}
			const total = Number(body.balances[0]?.total ?? NaN)
			if (Number.isFinite(total) && total <= 0) {
				return { state: 'unavailable', code: 'BALANCE_EMPTY', source: 'balance', reason: '账户余额为 0' }
			}
		} catch {
			// 静默：余额查不通 ≠ 模型不可用
		}
		return { state: 'available', code: 'OK', source: 'probe', reason: '' }
	}

	/**
	 * 从余额/配额信封里判断「确凿用尽」。
	 * 只认能算出来的数字，不认识的字句（如「当前用户不存在 coding plan」）一律不算。
	 * @param provider - 段内 providers 键名。
	 * @returns 用尽的判定；无法确凿判定时为 `undefined`。
	 */
	const exhaustedFromBalance = async (provider) => {
		let envelope
		try {
			envelope = await piaiBalance(provider)
		} catch {
			return undefined
		}
		if (envelope === null || typeof envelope !== 'object' || envelope.ok !== true || envelope.supported === false) return undefined
		// available=false 只表示「这次余额查询没成功」；原因千差万别（没 key、查不通、
		// 没有套餐），除开 key 缺失（已由凭据那步覆盖）都不构成隐藏理由。
		if (envelope.available === false) return undefined
		const items = Array.isArray(envelope.items) ? envelope.items : []
		if (envelope.kind === 'cash') {
			const amount = items[0]?.amount
			if (typeof amount !== 'string' || amount.trim() === '') return undefined
			const value = Number(amount)
			if (Number.isFinite(value) && value <= 0) {
				return { state: 'unavailable', code: 'BALANCE_EMPTY', source: 'balance', reason: `账户余额为 0（${items[0]?.currency ?? ''}）` }
			}
			return undefined
		}
		const used = envelope.meaning === 'used'
		for (const item of items) {
			// `meaning: 'remain'` 的适配器还可能带一个周维度的余量：任一为 0 都表示
			// 现在发不出请求（MiniMax 的 5h 窗口用尽但周余量还在，或反过来）。
			const fields = used ? [item?.percent] : [item?.percent, item?.weeklyPercent]
			for (const percent of fields) {
				if (typeof percent !== 'number') continue
				if ((used && percent >= 100) || (!used && percent <= 0)) {
					return { state: 'unavailable', code: 'QUOTA_EXHAUSTED', source: 'balance', reason: `${label(item?.label) ?? '配额'}已用尽` }
				}
			}
		}
		return undefined
	}

	/**
	 * pi-ai 路由的判定：凭据 → 网关探测 → 余额/配额。
	 * @param provider - 段内 providers 键名。
	 * @returns 判定结果（不含 provider/displayName）。
	 */
	const probePiai = async (provider) => {
		const profile = piaiProfileOf(provider)
		if (profile === undefined) return { state: 'unknown', code: 'NOT_CONFIGURED', source: 'probe', reason: '设置里没有这个 provider' }
		const { ref, apiKey } = await piaiConnection(profile)
		// ref 未配置 = 官方 pi-ai 眼里「刻意不鉴权」的路由，不能按缺 key 处理。
		if (ref !== undefined && apiKey === undefined) {
			return { state: 'unavailable', code: 'CREDENTIAL_MISSING', source: 'credential', reason: `apiKeyEnv 指向的 ${ref} 解析不到，请求会直接失败` }
		}
		const listing = await piaiListing(profile, {}, provider)
		if (!listing.ok && listing.code === 'HTTP_ERROR') {
			if (listing.status === 401 || listing.status === 403) {
				return { state: 'unavailable', code: 'AUTH_REJECTED', source: 'probe', reason: `网关拒绝了这个 key（HTTP ${listing.status}）` }
			}
			if (listing.status === 402) {
				return { state: 'unavailable', code: 'PAYMENT_REQUIRED', source: 'probe', reason: '网关要求付费（HTTP 402）' }
			}
			return { state: 'unknown', code: 'HTTP_ERROR', source: 'probe', reason: `网关返回 HTTP ${listing.status}` }
		}
		const exhausted = await exhaustedFromBalance(provider)
		if (exhausted !== undefined) return exhausted
		if (!listing.ok) {
			// 404 / 连不上 / 协议不支持目录端点 —— 都不足以断言模型不可用。
			return { state: 'unknown', code: listing.code ?? 'PROBE_UNKNOWN', source: 'probe', reason: listing.error ?? '网关探测无结论' }
		}
		return { state: 'available', code: 'OK', source: 'probe', reason: '' }
	}

	/**
	 * 判定目标 —— **全部来自设置段**，与 `ctx.llm.listProviders()` 解耦。
	 *
	 * 为什么不用路由表：`listProviders()` 就是本插件过滤器的输出，拿它当目标，
	 * 被隐藏的 provider 就再也不会进入下一轮探测 —— 「隐藏即永久」。2026-09-16 实测：
	 * minimax 被隐藏之后，之后每一轮探测的目标里都没有它，`checkedAt` 一路前进、
	 * 它的判定却永远停在旧值，「充值/换 key 后恢复」于是永远不成立。
	 * 设置段没有这个问题：它只反映「人配了什么」，与可用性判定互不影响。
	 * @returns 目标清单（id / ns / displayName）。
	 */
	const availabilityTargets = () => {
		const targets = []
		for (const [id, profile] of piaiProviders()) {
			targets.push({ id, ns: PIAI_NS, displayName: label(profile.displayName) ?? id })
		}
		// 官方直连：llm-deepseek 段存在就说明适配器挂上了（段由适配器自己注册）。
		const deepseek = sectionOf()
		if (deepseek !== undefined) {
			targets.push({ id: DEEPSEEK_PROVIDER, ns: NS, displayName: label(deepseek.displayName) ?? 'DeepSeek 官方直连' })
		}
		return targets
	}

	/**
	 * 全量重探。
	 *
	 * 去重：并发调用（例如下拉连开两次）共享同一个 promise。
	 * 强制（`force`，手动重探用）：作废在途探针并重开一轮 —— 否则「清空 → 等在途旧探针
	 * → 旧探针只写回它还没走完的那部分」会留下空洞。2026-09-16 实测：凭据类判定不走网络、
	 * 瞬间完成，于是它可能在清空**之前**就写完了，recheck 之后反而找不到 modelgo。
	 * 代际令牌让被取代的旧探针彻底闭嘴，不再写回任何结论。
	 * @param force - 是否作废在途探针并强制重开一轮。
	 * @returns 本轮（或复用的那轮）的 promise。
	 */
	const refreshAvailability = async (force = false) => {
		if (!force && probeAll !== null) return probeAll
		const generation = ++probeGeneration
		probeStartedAt = Date.now()
		const run = (async () => {
			const targets = availabilityTargets()
			const before = hiddenProviders()
			await Promise.all(targets.map(async (target) => {
				let outcome
				try {
					outcome = target.ns === NS ? await probeDeepseek() : await probePiai(target.id)
				} catch (error) {
					outcome = { state: 'unknown', code: 'PROBE_FAILED', source: 'probe', reason: describeError(error) }
				}
				// 已经被新一轮取代：这份结论过期了，丢掉。
				if (generation !== probeGeneration) return
				baseVerdicts.set(target.id, { provider: target.id, displayName: target.displayName, ns: target.ns, checkedAt: Date.now(), ...outcome })
			}))
			if (generation !== probeGeneration) return
			// 清掉真正从路由表里消失的 provider。判据必须是**原始路由表**，不是本轮的
			// targets：targets 还要求设置段里能读到 profile，而那是会瞬时缺失的
			// （2026-09-16 实测：某一轮只剩 deepseek+zai 两个目标，清理就把 minimax/modelgo
			// 的判定一起删了 —— 面板显示「已隐藏 0」，下拉里它们又冒出来）。
			// 目标来自设置段，所以「不在 targets 里」就等于「人把它删了」，清掉判定是对的。
			if (targets.length > 0) {
				const live = new Set(targets.map((target) => target.id))
				for (const id of [...baseVerdicts.keys()]) if (!live.has(id)) baseVerdicts.delete(id)
			}
			// 一个目标都没找到（启动竞态：设置段还没注册）不算探过 —— 否则 5 分钟内不再重试。
			if (targets.length > 0) lastProbeAt = Date.now()
			announceHiddenChange(before)
		})()
		probeAll = run.finally(() => {
			if (generation === probeGeneration) probeAll = null
		})
		return probeAll
	}

	/** 缓存过期就在后台补一次，绝不阻塞当前读取。 */
	const ensureAvailabilityFresh = () => {
		if (Date.now() - lastProbeAt <= AVAILABILITY_TTL_MS) return
		// 有一轮卡了很久（超时没生效、或将来改坏了），不能因此永远不再探。
		const stuck = probeAll !== null && Date.now() - probeStartedAt > STUCK_PROBE_MS
		refreshAvailability(stuck).catch(() => {})
	}

	/** 把真实请求的失败/成功折成运行期标记。 */
	const classifyFailure = (failure) => {
		const code = typeof failure?.code === 'string' ? failure.code : ''
		const status = typeof failure?.status === 'number' ? failure.status : undefined
		// MISSING_CREDENTIAL 也归这一类：pi-ai 解析不到 apiKeyEnv 时抛的就是它，
		// 与「key 无效」对使用者的意义一样 —— 这条路由现在调不了。
		if (code === 'INVALID_CREDENTIAL' || code === 'MISSING_CREDENTIAL' || status === 401 || status === 403) {
			return { code: 'AUTH_REJECTED', reason: '最近一次请求被拒（API key 缺失、无效或已过期）' }
		}
		if (code === 'QUOTA_EXCEEDED' || status === 402) {
			return { code: 'QUOTA_EXHAUSTED', reason: '最近一次请求因余额/配额耗尽失败' }
		}
		return undefined
	}

	/** 汇总：运行期标记优先于探针判定，真实成功又覆盖运行期失败。 */
	const currentAvailability = () => {
		const now = Date.now()
		const merged = new Map()
		for (const [id, verdict] of baseVerdicts) merged.set(id, verdict)
		for (const [id, mark] of [...runtimeMarks]) {
			if (now - mark.at >= RUNTIME_TTL_MS) {
				runtimeMarks.delete(id)
				continue
			}
			if ((successAt.get(id) ?? 0) > mark.at) continue
			const base = merged.get(id)
			merged.set(id, {
				provider: id,
				displayName: base?.displayName ?? id,
				ns: base?.ns ?? PIAI_NS,
				state: 'unavailable',
				code: mark.code,
				reason: mark.reason,
				source: 'runtime',
				checkedAt: mark.at
			})
		}
		for (const [id, at] of successAt) {
			const base = merged.get(id)
			if (base === undefined || base.state === 'available') continue
			if (now - at >= RUNTIME_TTL_MS || at <= base.checkedAt) continue
			merged.set(id, { ...base, state: 'available', code: 'RECOVERED', reason: '', source: 'runtime', checkedAt: at })
		}
		return [...merged.values()].sort((left, right) => left.provider.localeCompare(right.provider))
	}

	/** 当前该从下拉里摘掉的 provider 集合。 */
	const hiddenProviders = () => {
		const hidden = new Set()
		for (const verdict of currentAvailability()) {
			if (verdict.state === 'unavailable') hidden.add(verdict.provider)
		}
		return hidden
	}

	const sameHidden = (left, right) => left.size === right.size && [...left].every((id) => right.has(id))

	/**
	 * 隐藏集合变了就通知客户端重拉模型目录。
	 *
	 * 客户端的目录是**缓存**的（`ModelCatalogDirectory.load()` 在 `ready` 时直接返回旧值），
	 * 只在 `llm/adapters-updated` / `settings/document-updated` / `credentials/reference-updated`
	 * 三个 host 事件上刷新。我们的过滤改变了 `llm.listProviders()` 的结果，却没有事件可说 ——
	 * 不补这一下，下拉要等下一次无关刷新才跟上（2026-09-16 实测：判 MiniMax 不可用后，
	 * 设置页面板已更新，下拉里它还在）。语义上这正是该事件声明的意思：
	 * 「provider 拓扑变了，消费者重读 `listProviders()`」。
	 * @param before - 变更前的隐藏集合。
	 */
	const announceHiddenChange = (before) => {
		const after = hiddenProviders()
		if (sameHidden(before, after)) return
		try {
			ctx.emit('llm/adapters-updated')
		} catch {
			// 通知失败不影响判定本身
		}
	}

	/** client 半要的载荷：全量判定 + 需要摘掉的 id 列表。 */
	const availabilityPayload = () => {
		const providers = currentAvailability()
		return {
			ok: true,
			checkedAt: lastProbeAt,
			probing: probeAll !== null,
			providers,
			hidden: providers.filter((verdict) => verdict.state === 'unavailable').map((verdict) => verdict.provider)
		}
	}

	// 真实请求的失败与成功 —— 这是「没有余额了」最可靠的信号：目录探测常常照样 200，
	// 只有真发一次才知道。观察者只读，必须原样 next() 把控制权交回去。
	ctx.on('agent/request-error', (payload, next) => {
		try {
			const classified = classifyFailure(payload?.failure)
			if (classified !== undefined && typeof payload?.provider === 'string') {
				const before = hiddenProviders()
				runtimeMarks.set(payload.provider, { ...classified, at: Date.now() })
				announceHiddenChange(before)
			}
		} catch {
			// 观察者绝不影响请求本身
		}
		return next()
	}, { global: true })

	ctx.on('llm/stream', (options, next) => {
		const provider = typeof options?.provider === 'string' ? options.provider : undefined
		const inner = next()
		if (provider === undefined) return inner
		return (async function* observeProviderOutcome() {
			for await (const chunk of inner) {
				if (chunk?.type === 'finish') {
					try {
						const kind = chunk.reason?.kind
						const before = hiddenProviders()
						if (kind === 'error' || kind === 'aborted') {
							const classified = classifyFailure(chunk.reason?.failure)
							if (classified !== undefined) runtimeMarks.set(provider, { ...classified, at: Date.now() })
						} else {
							successAt.set(provider, Date.now())
							runtimeMarks.delete(provider)
						}
						announceHiddenChange(before)
					} catch {
						// 记不上就算了，不能因为记账把流弄坏
					}
				}
				yield chunk
			}
		})()
	}, { global: true })

	// 配置/凭据一变，旧判定立刻作废（下次读取即重探）。
	//
	// `settings/document-updated` 是**必须**的那一条：改 `apiKeyEnv` / `baseURL` 这类
	// 不出现在 provider 目录事实里的字段时，`llm/adapters-updated` 根本不会发 ——
	// 2026-09-16 实测：把坏 key 改回好 key，判定一直停在「未配 Key」，直到 5 分钟 TTL 过期，
	// 也就是「充值了却不恢复」。这也正是 owner 明确要的那条路径。
	const invalidateAvailability = () => {
		lastProbeAt = 0
	}
	ctx.on('settings/document-updated', invalidateAvailability, { global: true })
	ctx.on('credentials/reference-updated', invalidateAvailability, { global: true })
	ctx.on('credentials/record-updated', invalidateAvailability, { global: true })
	// ⚠️ 刻意**不**监听 `llm/adapters-updated`：那个事件正是我们自己用来通知客户端重拉目录的
	//    （见 announceHiddenChange）。监听它 = 自己的广播把自己的判定缓存打回未探状态，
	//    每次隐藏集合变化都会白白多探一轮。provider 增删本来就会改设置文档，
	//    `settings/document-updated` 已经覆盖那种情况。

	ctx.effect(() => {
		const timer = setTimeout(() => {
			refreshAvailability().catch(() => {})
		}, 1500)
		return () => clearTimeout(timer)
	}, 'dsh-llm-hub: initial availability probe')

	// 把不可用的 provider 从 llm 服务的路由表里摘掉。
	//
	// 这是**唯一**能一次影响所有消费方的缝：composer 模型下拉、`/model` 弹窗、
	// 子代理选择器、ACP 全都读 `ctx.llm.listProviders()`，在 host 侧过滤一次，
	// 四处自然一致 —— 而客户端是过滤不了的。
	//
	// 为什么不去客户端包：`ctx.modelDirectories` 是 cordis 的 inject 追踪代理，
	// 读出来的方法被包成 traceable proxy，我们的 fiber 缺 `remote.session` 注入，
	// 一调用就 `cannot get property "remote.session" without inject`；2026-09-16 实测
	// 包装它会把官方模型座位整个打崩（座位从 composer 里消失）。host 侧这里
	// `ctx.get('llm')` 拿到的是**真实例**，补丁是纯函数式包装、只做减法、随插件卸载还原。
	//
	// 设置页不受影响：它读的是 configurable-provider 目录（`listConfigurableProviders`），
	// 所以被隐藏的分组在 设置 → 模型 里照常看得见、也照常能编辑。
	const installProviderFilter = () => {
		const service = ctx.get('llm')
		if (service === null || service === undefined || typeof service.listProviders !== 'function') {
			ctx.logger?.warn?.('dsh-llm-hub: 取不到 llm 服务，模型可用性过滤未安装')
			return () => {}
		}
		const original = service.listProviders
		const filtered = function (...args) {
			const providers = original.apply(this, args)
			if (!Array.isArray(providers)) return providers
			const hidden = hiddenProviders()
			if (hidden.size === 0) return providers
			return providers.filter((provider) => !hidden.has(provider?.id))
		}
		// ⚠️ 不要用 `service.listProviders !== filtered` 校验「写进去了没有」：
		// cordis 的服务访问返回 traceable 代理，每次读方法都是一个新的包装对象，永远不相等。
		// 上一版就是被这个假阴性坑的 —— 它把自己判成「赋值未生效」，顺手清掉了探针用的
		// 未过滤表，于是探针改读**过滤后**的路由表，隐藏的 provider 再也不会被重探
		// （2026-09-16 实测：minimax 被隐藏后再也没恢复）。改看真实例上的属性描述符。
		let installed = false
		try {
			service.listProviders = filtered
			const descriptor = Object.getOwnPropertyDescriptor(service, 'listProviders')
			installed = descriptor === undefined || descriptor.value === filtered
		} catch (error) {
			ctx.logger?.warn?.(`dsh-llm-hub: 包不住 llm.listProviders，模型可用性过滤未安装：${describeError(error)}`)
			return () => {}
		}
		if (!installed) {
			ctx.logger?.warn?.('dsh-llm-hub: llm.listProviders 赋值未生效，模型可用性过滤未安装')
			return () => {}
		}
		return () => {
			try {
				service.listProviders = original
			} catch {
				// 还原失败：进程退出即消失，不做补救
			}
		}
	}
	ctx.effect(() => installProviderFilter(), 'dsh-llm-hub: hide unavailable providers from llm.listProviders')

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: AVAILABILITY_PATH,
		handler: async (request, response) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405, { allow: 'GET, HEAD' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin reads are refused' })
				return
			}
			ensureAvailabilityFresh()
			if (request.method === 'HEAD') {
				response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
				response.end()
				return
			}
			sendJson(response, 200, availabilityPayload())
		}
	}), 'dsh-llm-hub: availability route')

	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: AVAILABILITY_RECHECK_PATH,
		handler: async (request, response) => {
			if (request.method !== 'POST') {
				response.writeHead(405, { allow: 'POST' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin writes are refused' })
				return
			}
			// 手动重探 = 全部作废重来：运行期标记也清掉，否则「充值了却还藏着」。
			runtimeMarks.clear()
			successAt.clear()
			baseVerdicts.clear()
			lastProbeAt = 0
			try {
				await refreshAvailability(true)
			} catch (error) {
				sendJson(response, 502, { ok: false, error: describeError(error) })
				return
			}
			sendJson(response, 200, availabilityPayload())
		}
	}), 'dsh-llm-hub: availability recheck route')
	//#endregion

	// settings.yaml 里 modelgo 那种 pi-ai provider 把 `models:` 留成空列表时，
	// 启动时主动去网关拉一份目录写回去 —— settings.yaml 里就不再留空列表。下次 reload /
	// 重启不需要重做这件事（pi-ai 自己的 onChange 会按 settings 重新注册 model 目录）。
	//
	// 写入前再 `get` 一次当前段，把期间用户已经填上的 provider 过滤掉 —— 避免
	// fetch 期间（几百毫秒到几秒）用户在外部编辑 settings.yaml 之后，被 fetch 前的
	// 快照结果覆盖。
	ctx.inject(["settings"], (settingsCtx) => {
		void (async () => {
			try {
				// modelgo 这种 pi-ai 风格 provider 在 'llm-pi-ai' namespace 下；
				// dsh-llm-hub 自己的 NS 是 'llm-deepseek'，但写回属于跨 namespace 兜底：
				// plugin 不是 pi-ai 的 owner，只是借用 settings 服务给 pi-ai 段补一份目录。
				const source = settingsCtx.settings.get(PIAI_NS)
				const updates = await populateEmptyProviderModels(source)
				if (Object.keys(updates).length === 0) return
				const current = settingsCtx.settings.get(PIAI_NS)
				for (const provider of Object.keys(updates)) {
					const live = current?.providers?.[provider]
					if (Array.isArray(live?.models) && live.models.length > 0) {
						delete updates[provider]
					}
				}
				if (Object.keys(updates).length === 0) return
				await settingsCtx.settings.update(PIAI_NS, { providers: updates })
				ctx.logger.info(`llm-deepseek: wrote back discovered models for ${Object.keys(updates).join(', ')}`)
			} catch (err) {
				ctx.logger.warn(`llm-deepseek: settings patch on boot failed: ${err?.message ?? err}`)
			}
		})()
	})

	// ── harness 子代理 ────────────────────────────────────────────────────────
	//
	// 把本机装好的外部 agent CLI（codex / claude / agy）注册成子代理提供方，详见
	// `./harness.js`。
	//
	// 为什么用**局部注入**而不是加进模块顶部的 `inject` 数组：`inject` 是硬依赖，
	// 少一个服务整个插件就不加载 —— 那会让「宿主没装子代理栈」的部署连余额和模型
	// 发现一起失去。局部注入只让 harness 这一段跟着服务走，缺了就不启用。
	ctx.inject(['subagents', 'subprocess'], (scope) => {
		applyHarness(scope).catch((error) => {
			scope.logger?.warn?.(`dsh-llm-hub: harness 探测失败：${error?.message ?? error}`)
		})
	})

	// 自检路由：`GET /api/dsh-llm-hub/harness` 报告探到了什么、注册了几个。
	//
	// 为什么需要它：宿主的 `info` 级日志**不落盘**（实测 launchd.log 里只有
	// event-dispatch / mcp / web url 三行），所以「provider 到底注册上了没有」
	// 从外部无从确认，只能靠在会话里真跑一次委派 —— 那要花钱调模型。这条路由
	// 让同一份判定可读，也是 client 半渲染 harness 卡的数据源。
	ctx.effect(() => ctx.webServer.register({
		kind: 'exact',
		path: HARNESS_PATH,
		handler: (request, response) => {
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				response.writeHead(405, { allow: 'GET, HEAD' })
				response.end()
				return
			}
			if (!sameOrigin(request)) {
				sendJson(response, 403, { ok: false, error: 'cross-origin reads are refused' })
				return
			}
			if (request.method === 'HEAD') {
				response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
				response.end()
				return
			}
			const report = harnessReport()
			sendJson(response, 200, {
				ok: true,
				probedAt: report.probedAt,
				// 还没探完（启动竞态）时 entries 是空的 —— 明说，不要让读者以为「一个都没装」。
				probed: report.probedAt > 0,
				harnesses: report.entries
			})
		}
	}), 'dsh-llm-hub: harness 自检路由')
}
