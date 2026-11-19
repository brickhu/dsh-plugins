/**
 * A small RSS-reader-style store for source articles.
 *
 * A feed is not a query: articles arrive over days, the reader keeps what it
 * has seen and merges the next poll into it. `createSources` used to return
 * only the current poll, so the page showed the same handful of rows forever
 * and dropped anything that rotated out of the feed window. This store keeps a
 * durable timeline on disk: a merge adds unseen URLs, updates the ones the feed
 * still carries, keeps the read state, and prunes old entries. The list can then
 * be a real history, ordered by publication time, instead of one poll's cap.
 *
 * It is deliberately tiny: a JSON file, no index, at most a few hundred rows.
 *
 * @module dsh-english-dictation/feed
 */

import fs from 'node:fs'
import path from 'node:path'

/** Keep roughly six weeks of articles; feeds rarely go back further. */
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000
/** Hard cap so a pathological feed cannot grow the file without bound. */
const MAX_ITEMS = 1200

/** Publication time of one row, or null when the feed had no usable date. */
function timeOf(value) {
	const time = Date.parse(String(value ?? ''))
	return Number.isNaN(time) ? null : time
}

/**
 * Create the article store.
 *
 * @param {object} [options] - creation options.
 * @param {string|null} [options.file] - JSON file; null keeps it in memory (tests).
 * @param {Function} [options.now] - clock (tests inject one).
 * @param {number} [options.maxAgeMs] - drop entries older than this.
 * @param {number} [options.maxItems] - hard cap on stored rows.
 * @returns {object} store with merge/list/get/markRead.
 */
export function createFeedStore({ file = null, now = Date.now, maxAgeMs = MAX_AGE_MS, maxItems = MAX_ITEMS } = {}) {
	/** @type {Map<string, object>} URL → row, so one article is one entry. */
	const rows = new Map()
	let loaded = false

	function load() {
		if (loaded) return
		loaded = true
		if (file === null) return
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
			for (const row of Array.isArray(raw && raw.items) ? raw.items : []) {
				if (row && typeof row.url === 'string' && row.url !== '' && typeof row.id === 'string') rows.set(row.url, row)
			}
		} catch (error) {
			/* no store yet, or a corrupt one: start clean */
		}
	}

	function save() {
		if (file === null) return
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true })
			const temp = `${file}.tmp`
			const payload = { version: 1, updatedAt: new Date(now()).toISOString(), items: Array.from(rows.values()) }
			fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`)
			fs.renameSync(temp, file)
		} catch (error) {
			/* the timeline is still usable in memory */
		}
	}

	function prune() {
		const cutoff = now() - maxAgeMs
		for (const [url, row] of rows) {
			const published = timeOf(row.publishedAt)
			if (published !== null && published < cutoff) rows.delete(url)
		}
		if (rows.size > maxItems) {
			const oldest = Array.from(rows.entries())
				.sort((left, right) => (timeOf(left[1].publishedAt) ?? 0) - (timeOf(right[1].publishedAt) ?? 0))
				.slice(0, rows.size - maxItems)
			for (const [url] of oldest) rows.delete(url)
		}
	}

	/**
	 * Merge one poll into the timeline.
	 *
	 * New URLs are added as unread; an existing URL keeps its read state and
	 * first-seen time while its title/summary/date are refreshed. Nothing is
	 * deleted just because a feed stopped carrying it.
	 * @param {object[]} poll - rows from one `sources.list()` call.
	 * @returns {{added: number, total: number}} new rows and the timeline size.
	 */
	function merge(poll) {
		load()
		const fetchedAt = new Date(now()).toISOString()
		let added = 0
		for (const row of Array.isArray(poll) ? poll : []) {
			if (!row || typeof row.url !== 'string' || row.url === '' || typeof row.id !== 'string') continue
			const existing = rows.get(row.url)
			if (existing) {
				rows.set(row.url, {
					...existing,
					...row,
					firstSeenAt: existing.firstSeenAt || fetchedAt,
					readAt: existing.readAt || null,
				})
			} else {
				rows.set(row.url, { ...row, firstSeenAt: fetchedAt, readAt: null })
				added += 1
			}
		}
		prune()
		save()
		return { added, total: rows.size }
	}

	/**
	 * The timeline, newest first, with a `read` boolean for the page.
	 * @returns {object[]} rows.
	 */
	function list() {
		load()
		return Array.from(rows.values())
			.map((row) => ({ ...row, read: typeof row.readAt === 'string' && row.readAt !== '' }))
			.sort((left, right) => {
				const a = timeOf(right.publishedAt)
				const b = timeOf(left.publishedAt)
				if (a === null && b === null) return String(left.source || '').localeCompare(String(right.source || ''))
				if (a === null) return 1
				if (b === null) return -1
				return a - b
			})
	}

	/**
	 * One row by id, read flag included.
	 * @param {string} id - article id.
	 * @returns {object|null} row.
	 */
	function get(id) {
		load()
		const wanted = String(id ?? '')
		for (const row of rows.values()) {
			if (row.id === wanted) return { ...row, read: typeof row.readAt === 'string' && row.readAt !== '' }
		}
		return null
	}

	/**
	 * Mark one article read; re-marking is a no-op.
	 * @param {string} id - article id.
	 * @returns {boolean} true when the row exists.
	 */
	function markRead(id) {
		load()
		const wanted = String(id ?? '')
		for (const [url, row] of rows) {
			if (row.id !== wanted) continue
			if (typeof row.readAt !== 'string' || row.readAt === '') {
				rows.set(url, { ...row, readAt: new Date(now()).toISOString() })
				save()
			}
			return true
		}
		return false
	}

	return { merge, list, get, markRead, size: () => rows.size }
}
