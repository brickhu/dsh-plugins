/**
 * Host half of dsh-links-panel.
 *
 * Almost everything lives in `lib/client.js`: the right-sidebar tab type, URL
 * extraction, grouping and rendering. This half exists for the one thing the
 * renderer cannot do itself — read a page's `<title>`: browsers block
 * cross-origin reads, so the Host resolves titles through the `web` service and
 * serves them to the panel over a same-origin route.
 *
 *   GET /dsh-links/meta?urls=["https://a","https://b"]  ->  {"titles":{...}}
 *
 * The route is intentionally small and defensive: GET only, http(s) URLs only,
 * bounded batch size, bounded response, and a short in-memory cache. Without the
 * `web` service the plugin stays inactive rather than failing the profile.
 *
 * @see lib/client.js
 */
/** Resolve names locally so a dead domain is recognised without waiting for a fetch. */
import { lookup } from 'node:dns/promises'

export const inject = ['web', 'webServer']

/** Serializes every outbound request this plugin makes: one at a time, always. */
let outboundChain = Promise.resolve()
/**
 * Run one network task after all previously queued ones finished.
 * @param {() => Promise<any>} task - work that touches the network.
 * @returns {Promise<any>} the task result.
 */
function withOutboundLock(task) {
	const run = outboundChain.then(task, task)
	outboundChain = run.then(
		() => undefined,
		() => undefined,
	)
	return run
}

/** Host build stamp, echoed to the panel so a stale bundle is detectable. */
export const BUILD = 'v0.72.1'
/**
 * The desktop browser reaches the network through the system proxy; the Host's own
 * Node requests bypass it. Detect that proxy so probes can use the same route.
 * @returns {Promise<string>} curl-compatible proxy URL, or '' when none is configured.
 */
let systemProxyPromise = null
async function systemProxy() {
	if (systemProxyPromise !== null) return systemProxyPromise
	systemProxyPromise = (async () => {
		const fromEnv =
			process.env.DSH_LINKS_PROXY ||
			process.env.HTTPS_PROXY ||
			process.env.https_proxy ||
			process.env.HTTP_PROXY ||
			process.env.http_proxy ||
			process.env.ALL_PROXY ||
			process.env.all_proxy ||
			''
		if (fromEnv !== '') return fromEnv
		try {
			const { execFile } = await import('node:child_process')
			const output = await new Promise((resolve) => {
				execFile('scutil', ['--proxy'], { timeout: 2000 }, (error, stdout) => resolve(error ? '' : String(stdout || '')))
			})
			if (output === '') return ''
			const pick = (name) => {
				const enabled = new RegExp(`${name}Enable\\s*:\\s*1`).test(output)
				const host = new RegExp(`${name}Proxy\\s*:\\s*([\\w.-]+)`).exec(output)
				const port = new RegExp(`${name}Port\\s*:\\s*(\\d+)`).exec(output)
				if (!enabled || host === null || port === null) return ''
				const scheme = name === 'SOCKS' ? 'socks5h' : 'http'
				return `${scheme}://${host[1]}:${port[1]}`
			}
			return pick('HTTPS') || pick('SOCKS') || pick('HTTP') || ''
		} catch (error) {
			return ''
		}
	})()
	return systemProxyPromise
}

/**
 * Fetch a URL as text through curl and the system proxy.
 * @param {string} url - absolute URL.
 * @param {string} proxy - curl proxy argument ('' for direct).
 * @returns {Promise<string | null>} response body text.
 */
async function curlText(url, proxy) {
	try {
		const { execFile } = await import('node:child_process')
		const args = ['-sS', '-L', '--max-time', '10', '--connect-timeout', '6', '-A', 'Mozilla/5.0 (compatible; DSH-Links/1.0)', url]
		if (proxy !== '') args.unshift('-x', proxy)
		const stdout = await new Promise((resolve) => {
			execFile('curl', args, { maxBuffer: 4 * 1024 * 1024 }, (error, output) => resolve(error ? null : output))
		})
		return typeof stdout === 'string' ? stdout : null
	} catch (error) {
		return null
	}
}

/**
 * Route the Host's own fetches through the desktop proxy when one is configured.
 * @returns {Promise<void>} resolution once the dispatcher is installed (or skipped).
 */
let proxyInstalled = false
async function installProxyDispatcher() {
	if (proxyInstalled) return
	proxyInstalled = true
	const proxy = await systemProxy()
	if (proxy === '' || proxy.startsWith('socks')) return
	try {
		const { ProxyAgent, setGlobalDispatcher } = await import('undici')
		setGlobalDispatcher(new ProxyAgent(proxy))
	} catch (error) {
		/* undici or the proxy URL is unavailable: stay direct */
	}
}

/**
 * AI titles route: asks the mounted model service to describe what each site is,
 * for links the conversation never titled.
 */
export const AI_TITLES_ROUTE_PATH = '/dsh-links/titles'
/** URLs per AI title request. */
const AI_TITLES_BATCH = 8

/**
 * Ask the model service for short descriptive titles.
 * @param {object} ctx - host context.
 * @param {string[]} urls - absolute URLs.
 * @returns {Promise<Record<string, string>>} title by URL.
 */
async function generateTitles(ctx, urls) {
	const llm = ctx && ctx.llm
	if (!llm || typeof llm.stream !== 'function' || typeof llm.listProviders !== 'function') {
		throw new Error('model service unavailable')
	}
	const providers = llm.listProviders()
	const first = Array.isArray(providers) ? providers[0] : undefined
	const provider = first && (first.provider || first.id || first.name)
	const model = first && (first.model || (Array.isArray(first.models) && first.models[0] && (first.models[0].id || first.models[0].model)))
	if (!provider || !model) throw new Error('no model route configured')
	const prompt = `你是链接整理助手。下面每行一个 URL，请为每个 URL 写一个中文标题（不超过 24 个字），说明这个网站/页面是做什么的。只输出 JSON 数组，格式：[{"url":"...","title":"..."}]，不要输出其它内容。\n${urls.map((url) => `- ${url}`).join('\n')}`
	const chunks = llm.stream({
		provider,
		model,
		maxTokens: 600,
		system: '你只输出 JSON 数组，不要解释。',
		messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
	})
	let text = ''
	for await (const chunk of chunks) {
		if (!chunk || typeof chunk !== 'object') continue
		if (chunk.type === 'text-delta') text += chunk.text || chunk.delta || ''
		else if (typeof chunk.text === 'string' && chunk.type !== 'block-start') text += chunk.text
	}
	const match = /\[[\s\S]*\]/.exec(text)
	const parsed = match ? JSON.parse(match[0]) : []
	const titles = {}
	if (Array.isArray(parsed)) {
		for (const entry of parsed) {
			if (entry && typeof entry.url === 'string' && typeof entry.title === 'string' && entry.title.trim() !== '') {
				titles[entry.url] = entry.title.trim()
			}
		}
	}
	if (Object.keys(titles).length === 0) throw new Error('model returned no titles')
	return titles
}

/**
 * Answer `GET /dsh-links/titles?urls=…`.
 * @param {object} ctx - host context.
 * @param {object} req - request.
 * @param {object} res - response.
 * @returns {Promise<void>} completion.
 */
async function handleTitlesRequest(ctx, req, res) {
	try {
		if (req.method !== 'GET') {
			res.writeHead(405, { allow: 'GET' })
			res.end()
			return
		}
		const urls = parseRequestedUrls(req.url).slice(0, AI_TITLES_BATCH)
		if (urls.length === 0) {
			res.writeHead(400)
			res.end()
			return
		}
		const titles = await withOutboundLock(() => generateTitles(ctx, urls))
		const payload = JSON.stringify({ titles, build: BUILD })
		res.writeHead(200, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(payload),
			'cache-control': 'no-store',
		})
		res.end(payload)
	} catch (error) {
		if (!res.headersSent) res.writeHead(503)
		res.end(String((error && error.message) || error))
	}
}

/** The route the Client calls; keep in sync with `TITLE_ROUTE` in client.js. */
export const ROUTE_PATH = '/dsh-links/meta'
/** Host-level favicon fetch: returns the icon bytes as a data URL. */
export const FAVICON_ROUTE_PATH = '/dsh-links/favicon'
/** Largest favicon accepted, in bytes. */
const FAVICON_MAX_BYTES = 64 * 1024

/**
 * Fetch one favicon URL through the Host network (curl + system proxy) and return it
 * as a data URL. Binary data is not readable through `ctx.web`, so curl does the work.
 * @param {string} url - absolute http(s) favicon URL.
 * @returns {Promise<{dataUrl: string} | null>} data URL or null.
 */
async function fetchFaviconDataUrl(url) {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
	} catch (error) {
		return null
	}
	const proxy = await systemProxy()
	try {
		const { execFile } = await import('node:child_process')
		const args = ['-sS', '-L', '--max-time', '8', '--connect-timeout', '5', '-A', 'Mozilla/5.0 (compatible; DSH-Links/1.0)', url]
		if (proxy !== '') args.unshift('-x', proxy)
		const stdout = await new Promise((resolve) => {
			execFile('curl', args, { maxBuffer: FAVICON_MAX_BYTES * 2, encoding: 'buffer' }, (error, output) => resolve(error ? null : output))
		})
		if (!Buffer.isBuffer(stdout) || stdout.length === 0 || stdout.length > FAVICON_MAX_BYTES) return null
		let mime = ''
		if (stdout[0] === 0x89 && stdout[1] === 0x50) mime = 'image/png'
		else if (stdout[0] === 0x47 && stdout[1] === 0x49) mime = 'image/gif'
		else if (stdout[0] === 0xff && stdout[1] === 0xd8) mime = 'image/jpeg'
		else if (stdout[0] === 0x52 && stdout[1] === 0x49) mime = 'image/webp'
		else if (stdout[0] === 0x00 && stdout[1] === 0x00) mime = 'image/x-icon'
		else if (stdout.slice(0, 300).toString('utf8').indexOf('<svg') >= 0) mime = 'image/svg+xml'
		if (mime === '') return null
		return { dataUrl: `data:${mime};base64,${stdout.toString('base64')}` }
	} catch (error) {
		return null
	}
}

/**
 * Answer `GET /dsh-links/favicon?url=…` with a data URL.
 * @param {object} req - request.
 * @param {object} res - response.
 * @returns {Promise<void>} completion.
 */
async function handleFaviconRequest(req, res) {
	try {
		if (req.method !== 'GET') {
			res.writeHead(405, { allow: 'GET' })
			res.end()
			return
		}
		const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
		const target = requestUrl.searchParams.get('url') || ''
		if (target === '') {
			res.writeHead(400)
			res.end()
			return
		}
		const icon = await withOutboundLock(() => fetchFaviconDataUrl(target))
		if (!icon) {
			res.writeHead(404)
			res.end()
			return
		}
		const payload = JSON.stringify({ dataUrl: icon.dataUrl })
		res.writeHead(200, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(payload),
			'cache-control': 'no-store',
		})
		res.end(payload)
	} catch (error) {
		if (!res.headersSent) res.writeHead(500)
		res.end()
	}
}
/** Most URLs one request may ask about. */
export const MAX_BATCH = 12
/** Longest accepted title, in characters. */
export const MAX_TITLE = 160
/** Longest accepted URL, matching the `web` service's own limit. */
const MAX_URL = 2048
/** Cache size and lifetimes: positive results live a day, misses ten minutes. */
const CACHE_LIMIT = 500
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000
const DEAD_TTL_MS = 60 * 60 * 1000
const NEGATIVE_TTL_MS = 10 * 60 * 1000
/** Per-page fetch budget; a slow site must not hold the whole batch. */
const FETCH_TIMEOUT_MS = 8000
/** Outbound pages resolved one at a time: metadata must stay linear and quiet. */
const PROBE_CONCURRENCY = 1
/** How long the local name check may take before the fetch decides instead. */
const DNS_TIMEOUT_MS = 2500

/** HTML entities that appear inside titles often enough to matter. */
const NAMED_ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
}

/**
 * Decode the character references a `<title>` can contain.
 * @param {string} text - raw title text.
 * @returns {string} decoded text.
 */
export function decodeEntities(text) {
	return String(text).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body) => {
		try {
			if (body[0] === '#') {
				const hex = body[1] === 'x' || body[1] === 'X'
				const value = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
				if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return match
				return String.fromCodePoint(value)
			}
			const named = NAMED_ENTITIES[body.toLowerCase()]
			return named === undefined ? match : named
		} catch (error) {
			return match
		}
	})
}

/**
 * Read the document title out of an HTML body.
 * @param {unknown} html - fetched body text.
 * @returns {string} the title, or '' when the page has none.
 */
export function extractTitle(html) {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''))
	if (match === null) return ''
	const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
	if (title === '') return ''
	return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title
}

/**
 * Read the page's declared icon: `<link rel="icon">`, `shortcut icon`, or an
 * Apple touch icon. Returned absolute, because the panel renders it with an
 * `<img>` and a site's own `/favicon.ico` is often missing or wrong.
 * @param {unknown} html - fetched body text.
 * @param {string} pageUrl - final page URL, for resolving relative hrefs.
 * @returns {string} the icon URL, or '' when the page declares none.
 */
export function extractIcon(html, pageUrl) {
	const source = String(html || '')
	const link = /<link\b[^>]*>/gi
	let match
	while ((match = link.exec(source)) !== null) {
		const tag = match[0]
		const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)
		if (rel === null || !/\bicon\b/i.test(rel[1])) continue
		const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)
		if (href === null) continue
		let resolved
		try {
			resolved = new URL(href[1], pageUrl)
		} catch (error) {
			continue
		}
		if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
		return resolved.toString()
	}
	return ''
}

/**
 * Accept only a plain public http(s) URL: the `web` service performs its own
 * address and redirect checks, but credentials and non-http schemes must not
 * reach it at all.
 * @param {unknown} value - candidate from the request.
 * @returns {string | null} the URL text, or null when unacceptable.
 */
export function acceptableUrl(value) {
	if (typeof value !== 'string') return null
	const text = value.trim()
	if (text === '' || text.length > MAX_URL) return null
	let parsed
	try {
		parsed = new URL(text)
	} catch (error) {
		return null
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
	if (parsed.username !== '' || parsed.password !== '') return null
	return parsed.toString()
}

/**
 * Read the requested URLs out of a request URL.
 * @param {string | undefined} requestUrl - the request's raw URL.
 * @returns {string[]} at most {@link MAX_BATCH} accepted URLs.
 */
export function parseRequestedUrls(requestUrl) {
	let search = ''
	try {
		search = new URL(requestUrl || '/', 'http://127.0.0.1').searchParams.get('urls') || ''
	} catch (error) {
		return []
	}
	let parsed
	try {
		parsed = JSON.parse(search)
	} catch (error) {
		return []
	}
	if (!Array.isArray(parsed)) return []
	const urls = []
	for (const value of parsed) {
		const accepted = acceptableUrl(value)
		if (accepted === null) continue
		urls.push(accepted)
		if (urls.length >= MAX_BATCH) break
	}
	return urls
}

/** HTTP statuses that mean the resource is gone rather than merely protected. */
const DEAD_STATUSES = new Set([404, 410])

/** Network causes that mean the host cannot be reached at all. */
const DEAD_CAUSES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'])

/** Probe reasons that prove the URL cannot be opened (rather than merely blocked here). */
const DEAD_REASONS = new Set(['gone', 'dns', 'refused', 'blocked'])

/**
 * Classify why a probe produced no page, from the provider's error shape. The
 * distinction matters: a 404 or an unresolvable name is a dead link, while a
 * timeout or a bot block only means this Host could not read the page.
 * @param {unknown} error - thrown failure.
 * @returns {string} a stable reason code.
 */
export function classifyFailure(error) {
	const code = error && typeof error.code === 'string' ? error.code : ''
	const cause = error && error.cause
	const causeCode = cause && typeof cause.code === 'string' ? cause.code : ''
	if (code === 'WEB_FETCH_TIMEOUT' || code === 'WEB_ABORTED') return 'timeout'
	if (code === 'WEB_BLOCKED_URL') return 'blocked'
	if (code === 'WEB_UNSUPPORTED_CONTENT_TYPE') return 'unsupported'
	if (code === 'WEB_FETCH_TOO_LARGE') return 'too-large'
	if (code === 'WEB_REDIRECT_BLOCKED') return 'redirect'
	if (code === 'WEB_PROVIDER_ERROR') {
		if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_NONAME') return 'dns'
		if (DEAD_CAUSES.has(causeCode)) return 'refused'
		return 'network'
	}
	return 'failed'
}

/**
 * Whether a URL's hostname does not resolve at all. A local lookup answers this
 * without a fetch, so a dead domain is recognised even when DNS is slow.
 * @param {string} url - accepted URL.
 * @returns {Promise<boolean>} true only when the name is known to be unregistered.
 */
async function hostUnresolvable(url) {
	let host
	try {
		host = new URL(url).hostname.replace(/^\[/, '').replace(/\]$/, '')
	} catch (error) {
		return false
	}
	if (host === '' || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.indexOf(':') >= 0) return false
	try {
		await Promise.race([
			lookup(host, { all: false }),
			new Promise((resolve) => setTimeout(resolve, DNS_TIMEOUT_MS, 'timeout')),
		])
		return false
	} catch (error) {
		const code = error && typeof error.code === 'string' ? error.code : ''
		return code === 'ENOTFOUND' || code === 'EAI_NONAME'
	}
}

/**
 * Whether a failed or non-successful fetch proves the page is gone. A timeout or
 * a 403 from bot protection proves nothing — the link still opens in a browser —
 * so only "not found" statuses and unresolvable/refused hosts count as dead.
 * @param {object | null} page - successful fetch result, when there was one.
 * @param {unknown} error - thrown failure, when the fetch did not complete.
 * @returns {boolean} true only when the page is provably gone.
 */
export function isDeadPage(page, error) {
	if (page !== null && page !== undefined) return DEAD_STATUSES.has(page.statusCode)
	const cause = error && error.cause
	const code = cause && typeof cause.code === 'string' ? cause.code : ''
	return DEAD_CAUSES.has(code)
}

/**
 * Probe one URL: fetch it once and report both its title and whether it is gone.
 * @param {object} ctx - host context.
 * @param {Map<string, {title: string, dead: boolean, icon: string, at: number}>} cache - probe cache.
 * @param {string} url - accepted URL.
 * @param {{refresh?: boolean}} [options] - `refresh` re-fetches instead of reusing the cache.
 * @returns {Promise<{title: string, dead: boolean, icon: string}>} the probe result.
 */
async function probePage(ctx, cache, url, options) {
	await installProxyDispatcher()
	const now = Date.now()
	const cached = options && options.refresh ? undefined : cache.get(url)
	if (cached !== undefined) {
		const ttl = cached.dead
			? DEAD_TTL_MS
			: cached.ok === false
				? NEGATIVE_TTL_MS
				: POSITIVE_TTL_MS
		if (now - cached.at < ttl) {
			return {
				title: cached.title,
				dead: cached.dead,
				icon: cached.icon || '',
				ok: cached.ok !== false,
				reason: cached.reason || (cached.ok === false ? 'failed' : 'ok'),
				status: typeof cached.status === 'number' ? cached.status : 0,
			}
		}
	}
	let page = null
	let error = null
	let title = ''
	let icon = ''
	let ok = false
	let reason = 'failed'
	if (await hostUnresolvable(url)) {
		const entry = { title: '', dead: true, icon: '', ok: false, reason: 'dns', at: now }
		cache.delete(url)
		if (cache.size >= CACHE_LIMIT) {
			const oldest = cache.keys().next()
			if (!oldest.done) cache.delete(oldest.value)
		}
		cache.set(url, entry)
		return { title: '', dead: true, icon: '', ok: false, reason: 'dns', status: 0 }
	}
	try {
		page = await ctx.web.fetch({ url }, AbortSignal.timeout(FETCH_TIMEOUT_MS))
		if (page && page.statusCode >= 200 && page.statusCode < 300 && page.body && page.body.kind === 'html') {
			ok = true
			reason = 'ok'
			title = extractTitle(page.body.content)
			icon = extractIcon(page.body.content, page.url || url)
		} else if (page !== null) {
			reason = DEAD_STATUSES.has(page.statusCode) ? 'gone' : 'http-error'
		} else {
			reason = classifyFailure(error)
		}
	} catch (failure) {
		error = failure
	}
	if (!ok) {
		// The browser reaches the network through the system proxy; fall back to curl so a
		// site reachable in the app is also readable by the Host.
		const proxy = await systemProxy()
		const html = await curlText(url, proxy)
		if (html && /<html|<head|<title|<!doctype/i.test(html.slice(0, 2000))) {
			ok = true
			reason = 'ok'
			title = extractTitle(html)
			icon = extractIcon(html, url)
		}
	}
	const dead = isDeadPage(page, error) || DEAD_REASONS.has(reason)
	cache.delete(url)
	if (cache.size >= CACHE_LIMIT) {
		const oldest = cache.keys().next()
		if (!oldest.done) cache.delete(oldest.value)
	}
	const status = page && typeof page.statusCode === 'number' ? page.statusCode : 0
	cache.set(url, { title, dead, icon, ok, reason, at: now, status })
	return { title, dead, icon, ok, reason, status }
}

/**
 * Answer `GET /dsh-links/meta` with `{ titles: { url: title } }`.
 * @param {object} ctx - host context.
 * @param {Map<string, {title: string, at: number}>} cache - title cache.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function handleMetaRequest(ctx, cache, req, res) {
	try {
		if (req.method !== 'GET') {
			res.writeHead(405, { allow: 'GET' })
			res.end()
			return
		}
		const urls = parseRequestedUrls(req.url)
		const refresh = /[?&]refresh=1(?:&|$)/.test(req.url || '')
		const pages = {}
		// Strictly one probe at a time, and one request at a time across the plugin.
		for (const url of urls) {
			pages[url] = await withOutboundLock(() => probePage(ctx, cache, url, { refresh }))
		}
		const payload = JSON.stringify({ pages, build: BUILD })
		res.writeHead(200, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(payload),
			'cache-control': 'no-store',
		})
		res.end(payload)
	} catch (error) {
		if (!res.headersSent) res.writeHead(500)
		res.end()
	}
}

/**
 * Host plugin body: register the metadata route.
 * @param {object} ctx - host context with the `web` and `webServer` services.
 */
export function apply(ctx) {
	const cache = new Map()
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: ROUTE_PATH,
				handler: (req, res) => handleMetaRequest(ctx, cache, req, res),
			}),
		'dsh-links: metadata route',
	)
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: FAVICON_ROUTE_PATH,
				handler: (req, res) => handleFaviconRequest(req, res),
			}),
		'dsh-links: favicon route',
	)
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: AI_TITLES_ROUTE_PATH,
				handler: (req, res) => handleTitlesRequest(ctx, req, res),
			}),
		'dsh-links: ai titles route',
	)
}
