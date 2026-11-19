/**
 * Source favicons for the add page.
 *
 * The add page shows where an article came from, and a favicon reads faster
 * than a word. The browser cannot fetch these itself: some provider sites only
 * answer `/favicon.ico` on a custom path, the DSH page's CSP is not ours to
 * widen, and a direct hotlink would leak the learner's requests to each site.
 * So the Host resolves the icon once, caches the bytes next to the profile and
 * serves them from our own route; the page only ever sees a same-origin URL.
 *
 * Resolution: fetch the provider's homepage, read its `<link rel="icon">`
 * (NOAA, NIST and PLOS all use a custom path), then try `/favicon.ico`. Only
 * known providers are accepted, only `image/*` bodies are kept, and the result
 * stays under 512 KB.
 *
 * @module dsh-english-dictation/favicon
 */

import fs from 'node:fs'
import path from 'node:path'
import { PROVIDER_BY_ID, USER_AGENT } from './sources.js'

/** Refresh a cached icon after this long. */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000
/** Do not retry a provider that just failed for this long. */
const RETRY_MS = 6 * 60 * 60 * 1000
/** Give up above this size; every provider icon is well below it. */
const MAX_BYTES = 512 * 1024
/** One page or icon request must finish inside this window. */
const FETCH_TIMEOUT_MS = 8000

const IMAGE_TYPES = new Map([
	['image/png', 'png'],
	['image/svg+xml', 'svg'],
	['image/x-icon', 'ico'],
	['image/vnd.microsoft.icon', 'ico'],
	['image/webp', 'webp'],
	['image/jpeg', 'jpg'],
	['image/gif', 'gif'],
])

/** Attributes of one `<link>` tag, lower-cased names. */
function attributesOf(tag) {
	const attributes = {}
	for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g)) {
		attributes[match[1].toLowerCase()] = match[2]
	}
	return attributes
}

/**
 * Icon URLs declared by a homepage, best candidate first.
 *
 * Ordinary `rel="icon"` beats `apple-touch-icon`, a PNG/SVG beats an ICO, and a
 * larger declared size beats a smaller one. `/favicon.ico` is always the last
 * resort, so a page without any `<link>` still works.
 * @param {string} html - homepage markup.
 * @param {string} homepage - absolute homepage URL.
 * @returns {string[]} at most four absolute candidate URLs.
 */
export function iconCandidates(html, homepage) {
	const base = new URL(homepage)
	const found = []
	for (const match of String(html ?? '').matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0]
		if (!/\brel\s*=\s*["'][^"']*icon/i.test(tag)) continue
		const attributes = attributesOf(tag)
		if (!attributes.href) continue
		if (/mask-icon/i.test(attributes.rel || '')) continue
		let url
		try {
			url = new URL(attributes.href, homepage)
		} catch (error) {
			continue
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
		// The icon must live on the provider's own site: a homepage that points at
		// an unrelated host is not trusted enough to fetch from here.
		const host = url.hostname
		if (host !== base.hostname && !host.endsWith(`.${base.hostname.replace(/^www\./, '')}`) && !base.hostname.endsWith(`.${host.replace(/^www\./, '')}`)) {
			continue
		}
		const size = Number((attributes.sizes || '').match(/\d+/)?.[0] || 0)
		found.push({ url: url.href, rel: attributes.rel || '', type: attributes.type || '', size })
	}
	found.sort((left, right) => {
		const leftApple = /apple-touch/i.test(left.rel) ? 1 : 0
		const rightApple = /apple-touch/i.test(right.rel) ? 1 : 0
		if (leftApple !== rightApple) return leftApple - rightApple
		const leftType = /image\/(png|svg)/i.test(left.type) ? 1 : 0
		const rightType = /image\/(png|svg)/i.test(right.type) ? 1 : 0
		if (leftType !== rightType) return rightType - leftType
		return right.size - left.size
	})
	const candidates = found.map((entry) => entry.url)
	candidates.push(new URL('/favicon.ico', base).href)
	return [...new Set(candidates)].slice(0, 4)
}

/**
 * Fetch one image with the provider-friendly UA and a hard timeout.
 * @param {string} url - absolute URL.
 * @param {Function} fetchImpl - fetch.
 * @returns {Promise<{type: string, bytes: Buffer, url: string}|null>} the image.
 */
async function fetchImage(url, fetchImpl) {
	try {
		const response = await fetchImpl(url, {
			headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
			redirect: 'follow',
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		})
		if (!response.ok) return null
		const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
		if (!IMAGE_TYPES.has(type)) return null
		const bytes = Buffer.from(await response.arrayBuffer())
		if (bytes.length === 0 || bytes.length > MAX_BYTES) return null
		return { type, bytes, url }
	} catch (error) {
		return null
	}
}

/**
 * Resolve and cache provider favicons.
 *
 * @param {object} options - creation options.
 * @param {string} options.dir - cache directory (inside the profile storage).
 * @param {Function} [options.fetch] - fetch implementation (tests inject one).
 * @param {Function} [options.now] - clock (tests inject one).
 * @returns {{get: (id: string) => Promise<{type: string, bytes: Buffer}|null>, dir: string}} cache.
 */
export function createFavicons({ dir, fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
	const indexFile = path.join(dir, 'index.json')
	/** @type {Map<string, {file: string, type: string, fetchedAt: number, url: string}>} */
	const entries = new Map()
	/** @type {Map<string, number>} */
	const failures = new Map()
	let indexLoaded = false

	function loadIndex() {
		if (indexLoaded) return
		indexLoaded = true
		try {
			const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
			for (const [id, entry] of Object.entries(raw || {})) {
				if (!entry || typeof entry.file !== 'string' || typeof entry.type !== 'string') continue
				entries.set(id, entry)
			}
		} catch (error) {
			/* a missing or corrupt index just means no cached icons */
		}
	}

	function saveIndex() {
		try {
			fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(indexFile, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`)
		} catch (error) {
			/* the cache is an optimisation, not a requirement */
		}
	}

	function cachedBytes(entry) {
		try {
			const bytes = fs.readFileSync(path.join(dir, entry.file))
			return bytes.length > 0 ? { type: entry.type, bytes } : null
		} catch (error) {
			return null
		}
	}

	async function resolve(id) {
		const provider = PROVIDER_BY_ID.get(id)
		if (!provider) return null
		const homepage = provider.attribution && provider.attribution.url
		if (typeof homepage !== 'string' || homepage === '') return null
		let html = ''
		try {
			const response = await fetchImpl(homepage, {
				headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
				redirect: 'follow',
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			})
			if (response.ok) html = await response.text()
		} catch (error) {
			html = ''
		}
		for (const candidate of iconCandidates(html, homepage)) {
			const image = await fetchImage(candidate, fetchImpl)
			if (image === null) continue
			const extension = IMAGE_TYPES.get(image.type) || 'bin'
			const file = `${id}.${extension}`
			try {
				fs.mkdirSync(dir, { recursive: true })
				fs.writeFileSync(path.join(dir, file), image.bytes)
			} catch (error) {
				return { type: image.type, bytes: image.bytes }
			}
			entries.set(id, { file, type: image.type, fetchedAt: now(), url: image.url })
			saveIndex()
			return { type: image.type, bytes: image.bytes }
		}
		return null
	}

	/**
	 * One provider's icon bytes, from cache when fresh.
	 * @param {string} id - provider id (`nasa`, `noaa`, …).
	 * @returns {Promise<{type: string, bytes: Buffer}|null>} icon or null.
	 */
	async function get(id) {
		if (typeof id !== 'string' || id === '') return null
		loadIndex()
		const entry = entries.get(id)
		if (entry && now() - Number(entry.fetchedAt || 0) < REFRESH_MS) {
			const cached = cachedBytes(entry)
			if (cached !== null) return cached
		}
		const failedAt = failures.get(id)
		if (failedAt !== undefined && now() - failedAt < RETRY_MS) {
			return entry ? cachedBytes(entry) : null
		}
		try {
			const resolved = await resolve(id)
			if (resolved !== null) return resolved
		} catch (error) {
			/* fall through to the negative cache */
		}
		failures.set(id, now())
		// A stale icon beats no icon when a refresh fails.
		return entry ? cachedBytes(entry) : null
	}

	return { get, dir }
}
