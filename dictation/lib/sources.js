/**
 * Where an exercise comes from.
 *
 * The plugin ships no article bank, and the sources must be reachable from
 * mainland China without a proxy — that is a hard product constraint, not a
 * preference. It rules out Wikipedia/Wikimedia, VOA, the Guardian and most
 * learner-news sites (all blocked or without a licence that allows rewriting),
 * and leaves a small set of public-domain and openly licensed feeds:
 *
 *   NASA · NOAA · NIST · WHO · Our World in Data · PLOS ONE · Frontiers
 *
 * Every provider declares its licence so the page can show attribution, and
 * every provider is fetched independently: one dead feed degrades the list, it
 * does not break it. Feeds are merged, deduplicated and sorted by publication
 * time, because the add page is one time-ordered stream — topic diversity comes
 * from having several providers, not from grouping the list by source.
 *
 * Polls merge into a durable timeline (`lib/feed.js`): an article that leaves a
 * feed's window stays in the list, keeps its read state, and is pruned only by
 * age or the hard cap. That is what makes the add page behave like an RSS
 * reader instead of re-showing the same one poll's worth of rows.
 *
 * A feed usually carries a teaser, not the article. `article()` therefore
 * fetches the linked page when the feed text is too short, and runs the shared
 * prose extraction over it.
 */

import crypto from 'node:crypto'
import path from 'node:path'
import { extractArticleText, parseFeed } from './rss.js'
import { createFeedStore } from './feed.js'

/**
 * A browser-shaped User-Agent.
 *
 * Several providers sit behind a WAF that rejects anything else with a 403
 * (NOAA is the strict one; the same URL returns 200 for a browser). The plugin
 * is acting for the learner in their browser, so it identifies itself as the
 * browser it is embedded in rather than as a bot — and it stays polite by
 * caching, limiting the per-source cap and asking for one page per article.
 */
export const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 12000
const CACHE_MS = 10 * 60 * 1000
/** How many fetched article bodies stay in memory (never on disk). */
const PAGE_TEXT_CACHE = 40
/** Words kept from a source before the rewrite prompt sees it. */
export const SOURCE_TEXT_WORDS = 1600

/** The licences a row can carry, with the label the page prints. */
export const LICENSES = {
	'public-domain': {
		id: 'public-domain',
		label: 'Public domain',
		url: 'https://www.usa.gov/government-works',
	},
	'cc-by-4.0': {
		id: 'cc-by-4.0',
		label: 'CC BY 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
	},
	'cc-by-nc-sa-3.0-igo': {
		id: 'cc-by-nc-sa-3.0-igo',
		label: 'CC BY-NC-SA 3.0 IGO',
		url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/igo/',
	},
}

/**
 * The providers, in the order their rows appear when timestamps tie.
 *
 * `mode: 'feed'` means the feed carries the article body (WHO ships its whole
 * release, PLOS its abstract); every other provider needs the linked page.
 * `cap` keeps one prolific feed from owning the time-ordered list.
 */
export const SOURCE_PROVIDERS = [
	{
		id: 'nasa',
		label: 'NASA',
		topic: 'science',
		license: 'public-domain',
		attribution: { label: 'NASA', url: 'https://www.nasa.gov/' },
		feeds: ['https://www.nasa.gov/feed/', 'https://science.nasa.gov/feed/'],
		mode: 'page',
		cap: 20,
	},
	{
		id: 'noaa',
		label: 'NOAA',
		topic: 'environment',
		license: 'public-domain',
		attribution: { label: 'NOAA', url: 'https://www.noaa.gov/' },
		feeds: ['https://www.noaa.gov/rss.xml'],
		mode: 'page',
		cap: 20,
	},
	{
		id: 'nist',
		label: 'NIST',
		topic: 'technology',
		license: 'public-domain',
		attribution: { label: 'NIST', url: 'https://www.nist.gov/' },
		feeds: ['https://www.nist.gov/news-events/news/rss.xml'],
		mode: 'page',
		cap: 20,
	},
	{
		id: 'who',
		label: 'WHO',
		topic: 'health',
		license: 'cc-by-nc-sa-3.0-igo',
		attribution: { label: 'World Health Organization', url: 'https://www.who.int/' },
		feeds: ['https://www.who.int/rss-feeds/news-english.xml'],
		mode: 'feed',
		cap: 20,
	},
	{
		id: 'owid',
		label: 'Our World in Data',
		topic: 'society',
		license: 'cc-by-4.0',
		attribution: { label: 'Our World in Data', url: 'https://ourworldindata.org/' },
		feeds: ['https://ourworldindata.org/atom.xml'],
		mode: 'page',
		cap: 20,
	},
	{
		id: 'plos',
		label: 'PLOS ONE',
		topic: 'science',
		license: 'cc-by-4.0',
		attribution: { label: 'PLOS ONE', url: 'https://journals.plos.org/plosone/' },
		feeds: ['https://journals.plos.org/plosone/feed/atom'],
		mode: 'feed',
		cap: 20,
	},
	{
		id: 'frontiers',
		label: 'Frontiers',
		topic: 'psychology',
		license: 'cc-by-4.0',
		attribution: { label: 'Frontiers', url: 'https://www.frontiersin.org/' },
		feeds: ['https://www.frontiersin.org/journals/psychology/rss'],
		mode: 'page',
		cap: 20,
	},
]

/** Providers by id, for validation and tests. */
export const PROVIDER_BY_ID = new Map(SOURCE_PROVIDERS.map((provider) => [provider.id, provider]))

/**
 * Trim a text to at most `max` words, on a word boundary.
 * @param {string} text - prose.
 * @param {number} max - word limit.
 * @returns {string} trimmed prose.
 */
export function trimWords(text, max) {
	const words = String(text ?? '').split(/\s+/).filter(Boolean)
	if (words.length <= max) return words.join(' ')
	return `${words.slice(0, max).join(' ')}`
}

/**
 * Normalize fetched prose: drop URLs, bracketed references and page debris,
 * collapse whitespace.
 * @param {string} text - raw text.
 * @returns {string} clean prose.
 */
export function cleanSourceText(text) {
	return String(text ?? '')
		// PLOS puts its author line in front of the abstract ("by A, B, C
		// Introduction …"); the names are not part of the article's language.
		.replace(/^\s*by\s+[\s\S]{0,320}?\bIntroduction\b\s+/i, '')
		.replace(/https?:\/\/\S+/gi, ' ')
		.replace(/www\.\S+/gi, ' ')
		.replace(/\[\d{1,3}\]/g, ' ')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.replace(/\n{2,}/g, '\n')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.split(/\s+/).filter(Boolean).length >= 3)
		.join('\n')
		.trim()
}

/** Stable, opaque id for one source article. */
/**
 * One article's stable id: the hash of its URL.
 *
 * The generated exercise uses the same value as its unit id, so the add page
 * can match an article to the book by id instead of by URL string alone.
 * @param {string} url - article URL.
 * @returns {string} 12 hex characters.
 */
function idOf(url) {
	return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 12)
}

/** A timestamp in ms, or null when the feed's date cannot be parsed. */
function timeOf(publishedAt) {
	if (typeof publishedAt !== 'string' || publishedAt === '') return null
	const at = Date.parse(publishedAt)
	return Number.isFinite(at) ? at : null
}

/** The ISO form of a feed date, or '' when unusable. */
function isoOf(publishedAt) {
	const at = timeOf(publishedAt)
	return at === null ? '' : new Date(at).toISOString()
}

/** Decode the handful of entities a `<title>` carries. */
function decodeTitle(text) {
	return String(text ?? '')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&nbsp;/gi, ' ')
		.replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
		.replace(/\s+/g, ' ')
		.trim()
}

/** A page's title: og:title first, then `<title>`. */
function pageTitleOf(html) {
	const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
		|| /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html)
	if (og) return decodeTitle(og[1]).slice(0, 200)
	const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
	return tag ? decodeTitle(tag[1]).slice(0, 200) : ''
}

/**
 * Whether a pasted URL is safe for the Host to fetch: http(s) and not a
 * loopback/private address. Custom links are the one place the page names a
 * URL for the Host, so the Host refuses to become an SSRF probe.
 */
export function isFetchableUrl(value) {
	let parsed
	try {
		parsed = new URL(String(value ?? '').trim())
	} catch (error) {
		return false
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
	const host = parsed.hostname.toLowerCase()
	if (host === '' || host === 'localhost' || host.endsWith('.local') || host === '[::1]' || host === '::1') return false
	if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false
	if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
	if (/^0\./.test(host)) return false
	return true
}

/**
 * Create the source layer.
 * @param {{fetch?: Function, now?: () => number, cacheMs?: number, dir?: string}} [options] - overrides for tests.
 * @returns {{list: Function, get: Function, article: Function, markRead: Function}} source layer.
 */
export function createSources(options = {}) {
	const fetchImpl = typeof options.fetch === 'function' ? options.fetch : (...args) => fetch(...args)
	const now = typeof options.now === 'function' ? options.now : () => Date.now()
	const cacheMs = Number.isFinite(Number(options.cacheMs)) ? Number(options.cacheMs) : CACHE_MS
	// A feed reader keeps its articles: each poll merges into this timeline and
	// the page reads the history, so rows no longer vanish with the next poll.
	const feed = createFeedStore({
		file: typeof options.dir === 'string' && options.dir !== '' ? path.join(options.dir, 'sources.json') : null,
		now,
	})
	/** Last poll: status + timestamp. The rows live in `feed`. */
	let cache = { at: 0, status: [], fetchedAt: '' }
	/** Feed bodies by row id, so /sources stays small and article() stays fast. */
	const feedTexts = new Map()
	/** Page texts by row id. */
	const pageTexts = new Map()
	/** Rows pasted as a custom URL; memory only, generated right away. */
	const customRows = new Map()
	let inflight = null

	async function fetchText(url) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
		try {
			const response = await fetchImpl(url, {
				signal: controller.signal,
				redirect: 'follow',
				headers: {
				'user-agent': USER_AGENT,
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'accept-language': 'en-US,en;q=0.9',
			},
			})
			if (!response || response.ok === false) throw new Error(`http-${response && response.status}`)
			return await response.text()
		} finally {
			clearTimeout(timer)
		}
	}

	async function providerRows(provider) {
		const results = await Promise.allSettled(provider.feeds.map((feed) => fetchText(feed)))
		const rows = []
		let failure = ''
		let successes = 0
		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				failure = failure || String((result.reason && result.reason.message) || 'fetch-failed')
				return
			}
			successes += 1
			for (const item of parseFeed(result.value)) {
				if (!item.link || !item.title) continue
				const id = idOf(item.link)
				const text = cleanSourceText(item.text)
				if (text !== '') feedTexts.set(id, text)
				rows.push({
					id,
					provider: provider.id,
					source: provider.label,
					topic: provider.topic,
					title: item.title,
					url: item.link,
					publishedAt: isoOf(item.publishedAt),
					// The page only needs a one-line hook; the body is not sent.
					summary: String(item.summary || '').slice(0, 240),
					license: LICENSES[provider.license] || LICENSES['cc-by-4.0'],
					attribution: provider.attribution,
					words: text === '' ? 0 : text.split(/\s+/).filter(Boolean).length,
					feed: index,
				})
			}
		})
		// Deduplicate one provider's own feeds (NASA news and NASA science overlap).
		const seen = new Set()
		const unique = rows.filter((row) => (seen.has(row.url) ? false : (seen.add(row.url), true)))
		unique.sort((left, right) => (timeOf(right.publishedAt) || 0) - (timeOf(left.publishedAt) || 0))
		return {
			rows: unique.slice(0, provider.cap),
			status: {
				id: provider.id,
				label: provider.label,
				ok: successes > 0,
				count: Math.min(unique.length, provider.cap),
				error: successes > 0 ? '' : failure,
			},
		}
	}

	async function list(options = {}) {
		const force = options.force === true
		if (!force && now() - cache.at < cacheMs && cache.status.length > 0) {
			return { items: feed.list(), status: cache.status, fetchedAt: cache.fetchedAt, added: 0 }
		}
		if (inflight !== null) return inflight
		inflight = (async () => {
			const results = await Promise.all(SOURCE_PROVIDERS.map((provider) => providerRows(provider)))
			const status = results.map((result) => result.status)
			const merged = []
			const seen = new Set()
			for (const result of results) {
				for (const row of result.rows) {
					if (seen.has(row.url)) continue
					seen.add(row.url)
					merged.push(row)
				}
			}
			// Time order is the page's whole organizing principle. Rows without a
			// parseable date go last rather than being dropped.
			merged.sort((left, right) => {
				const a = timeOf(right.publishedAt)
				const b = timeOf(left.publishedAt)
				if (a === null && b === null) return left.source.localeCompare(right.source)
				if (a === null) return 1
				if (b === null) return -1
				if (a !== b) return a - b
				return left.source.localeCompare(right.source)
			})
			const items = merged.filter((row) => row.title !== '' && row.url !== '')
			// Drop feed bodies that are no longer on the list; page texts are kept
			// because they are expensive and bounded by the rows actually opened.
			const live = new Set(items.map((row) => row.id))
			for (const key of feedTexts.keys()) if (!live.has(key)) feedTexts.delete(key)
			const mergedFeed = feed.merge(items)
			cache = { at: now(), status, fetchedAt: new Date(now()).toISOString() }
			return { items: feed.list(), status, fetchedAt: cache.fetchedAt, added: mergedFeed.added }
		})()
		try {
			return await inflight
		} finally {
			inflight = null
		}
	}

	async function get(id) {
		const wanted = String(id || '')
		const custom = customRows.get(wanted)
		if (custom !== undefined) return custom
		const stored = feed.get(wanted)
		if (stored !== null) return stored
		// Not in the timeline yet (a stale page, or a row fetched this instant):
		// one forced poll merges it, then the store answers.
		await list({ force: true })
		return feed.get(wanted)
	}

	async function pageText(row) {
		const cached = pageTexts.get(row.id)
		if (cached !== undefined) return cached
		const html = await fetchText(row.url)
		const text = trimWords(cleanSourceText(extractArticleText(html)), SOURCE_TEXT_WORDS * 2)
		// Only the last few opened articles keep their prose: the timeline on disk
		// is metadata, and generating reuses this in-memory copy instead of a
		// second download.
		pageTexts.delete(row.id)
		pageTexts.set(row.id, text)
		if (pageTexts.size > PAGE_TEXT_CACHE) {
			const oldest = pageTexts.keys().next().value
			if (oldest !== undefined) pageTexts.delete(oldest)
		}
		return text
	}

	async function article(id) {
		const row = await get(id)
		if (row === null) return null
		const provider = PROVIDER_BY_ID.get(row.provider)
		const feedText = feedTexts.get(row.id) || ''
		let text = ''
		// Only a `feed`-mode provider (WHO ships its release, PLOS its abstract) is
		// trusted with feed text: on page-mode feeds `content:encoded` often carries
		// the site's navigation, and the page's main container is cleaner.
		if (provider && provider.mode === 'feed' && feedText.split(/\s+/).filter(Boolean).length >= 100) {
			text = feedText
		} else {
			try {
				text = await pageText(row)
			} catch (error) {
				// The feed might still have enough to work with; otherwise this is a
				// "no article text" case the page can explain.
				text = ''
			}
			if (text.split(/\s+/).filter(Boolean).length < 60 && feedText !== '') text = feedText
		}
		const cleaned = trimWords(cleanSourceText(text), SOURCE_TEXT_WORDS)
		if (cleaned.split(/\s+/).filter(Boolean).length < 40) {
			throw Object.assign(new Error('no-article-text'), { code: 'no-article-text' })
		}
		return { ...row, text: cleaned, textWords: cleaned.split(/\s+/).filter(Boolean).length }
	}

	/**
	 * Ingest a URL pasted by the learner and return a source row for it.
	 *
	 * The row is kept in memory only: it is generated immediately, and saving
	 * arbitrary web pages to the article timeline is not what the timeline is
	 * for. The fetched page text is cached, so the generate call does not fetch
	 * the same URL twice.
	 * @param {string} value - absolute http(s) URL.
	 * @returns {Promise<object>} source row.
	 */
	async function ingest(value) {
		const raw = String(value ?? '').trim()
		if (!isFetchableUrl(raw)) throw Object.assign(new Error('bad-url'), { code: 'bad-url' })
		const parsed = new URL(raw)
		let html = ''
		try {
			html = await fetchText(parsed.href)
		} catch (error) {
			throw Object.assign(new Error('fetch-failed'), { code: 'fetch-failed' })
		}
		const text = trimWords(cleanSourceText(extractArticleText(html)), SOURCE_TEXT_WORDS)
		const words = text.split(/\s+/).filter(Boolean).length
		if (words < 40) throw Object.assign(new Error('no-article-text'), { code: 'no-article-text' })
		const host = parsed.hostname.replace(/^www\./i, '')
		const id = idOf(parsed.href)
		const row = {
			id,
			provider: 'custom',
			source: host,
			topic: 'other',
			title: pageTitleOf(html) || host,
			url: parsed.href,
			publishedAt: new Date(now()).toISOString(),
			summary: text.slice(0, 240),
			license: { id: 'unknown', label: 'Unknown' },
			attribution: { label: host, url: parsed.origin },
			words,
			custom: true,
		}
		customRows.set(id, row)
		pageTexts.set(id, text)
		return row
	}

	/**
	 * Remember that one source article was read (its preview was opened).
	 * @param {string} id - article id.
	 * @returns {boolean} true when the timeline knows the row.
	 */
	function markRead(id) {
		return feed.markRead(id)
	}

	return { list, get, article, markRead, ingest }
}
