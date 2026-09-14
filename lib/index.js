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
		const ref = label(section.apiKeyEnv) ?? DEFAULT_API_KEY_ENV
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
				...(signal === undefined ? {} : { signal })
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
	 * GET 网关模型目录，`/v1/models` 与 `/models` 依 baseURL 形态自动回退
	 * （modelgo 实测 `/models` 404、`/v1/models` 200；以 `/v1` 结尾的 base 只试
	 * `/models`），并测量到首个可用响应的耗时。
	 * @param profile - 段内原始 profile。
	 * @param request - 调用方一次性覆盖。
	 * @returns 统一结果：`ok=true` 带 models，`ok=false` 带 code 与 error。
	 */
	const piaiListing = async (profile, request = {}) => {
		const { baseURL, ref, apiKey } = await piaiConnection(profile, request)
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
					headers: { accept: 'application/json', ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }) }
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
			baseURL,
			apiKeyEnv: ref,
			keyConfigured: apiKey !== undefined,
			modelCount: models.length
		}
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
		const listing = await piaiListing(piaiProfileOf(provider))
		return listing.ok
			? { ok: true, provider, reachable: true, latencyMs: listing.latencyMs, remoteCount: listing.models.length, sample: listing.models.slice(0, 5).map((model) => model.id) }
			: { ok: true, provider, reachable: false, code: listing.code, latencyMs: listing.latencyMs, error: listing.error }
	}, 'dsh-llm-hub: pi-ai probe route')
	registerPiaiRoute(PIAI_CATALOG_PATH, async (provider) => {
		const listing = await piaiListing(piaiProfileOf(provider))
		return listing.ok ? { ok: true, provider, latencyMs: listing.latencyMs, models: listing.models } : listing
	}, 'dsh-llm-hub: pi-ai catalog route')
	//#endregion
}
