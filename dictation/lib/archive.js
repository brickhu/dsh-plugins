/**
 * Removed exercises.
 *
 * Removing a practice is not the same as forgetting it. The generated sentences
 * go, the progress goes, but the article source and the metadata needed to try
 * again stay here: title, CEFR, source URL/label/licence, timestamps. The archive
 * page can then regenerate a fresh exercise from that source at the same level.
 *
 * Only metadata is kept. The source URL is the expensive-to-recreate thing; the
 * model can write new sentences from it, and keeping a stale copy of the old
 * exercise would just be a second book.
 *
 * @module dsh-english-dictation/archive
 */

import fs from 'node:fs'
import path from 'node:path'
import { countWords } from './article.js'

/**
 * Re-apply the archived source metadata to a freshly ingested row, so a
 * regenerated NASA article still says NASA/Public domain instead of looking
 * like an anonymous custom link.
 * @param {object} row - row returned by `sources.ingest`.
 * @param {object} record - archive record.
 * @returns {object} row with the archived source fields.
 */
export function withArchivedSource(row, record) {
	const source = record && record.source && typeof record.source === 'object' ? record.source : null
	if (source === null) return row
	return {
		...row,
		provider: source.provider || row.provider,
		source: source.label || row.source,
		url: source.url || row.url,
		license: source.license || row.license,
		attribution: source.attribution || row.attribution,
		title: source.title || row.title,
	}
}

/**
 * Create the archive store.
 * @param {{dir: string, now?: () => Date}} options - profile storage dir and clock.
 * @returns {object} archive operations.
 */
export function createArchive(options) {
	const base = path.join(options.dir, 'archive')
	const now = typeof options.now === 'function' ? options.now : () => new Date()

	/** Read one record file, or null. */
	function read(file) {
		try {
			const record = JSON.parse(fs.readFileSync(file, 'utf8'))
			return record && typeof record.id === 'string' && record.id !== '' ? record : null
		} catch (error) {
			return null
		}
	}

	/**
	 * Every removed exercise, newest removal first.
	 * @returns {object[]} archive records.
	 */
	function list() {
		let names = []
		try {
			names = fs.readdirSync(base)
		} catch (error) {
			return []
		}
		return names
			.filter((name) => name.endsWith('.json'))
			.map((name) => read(path.join(base, name)))
			.filter(Boolean)
			.sort((left, right) => String(right.removedAt || '').localeCompare(String(left.removedAt || '')))
	}

	/**
	 * One record by unit id.
	 * @param {string} id - removed unit id.
	 * @returns {object|null} record.
	 */
	function get(id) {
		const wanted = String(id ?? '')
		if (wanted === '') return null
		return read(path.join(base, `${wanted}.json`))
	}

	/**
	 * Archive a unit's source and metadata. The caller deletes the unit itself.
	 * @param {object} unit - saved unit being removed.
	 * @returns {object} archive record.
	 */
	function save(unit) {
		const source = unit && unit.source && typeof unit.source === 'object' ? unit.source : null
		const sentences = Array.isArray(unit && unit.sentences) ? unit.sentences : []
		const record = {
			id: String(unit.id),
			title: String(unit.title || ''),
			cefr: String(unit.cefr || ''),
			link: String(unit.link || ''),
			source,
			sourceUrl: String((source && source.url) || unit.link || ''),
			builtin: Boolean(source && source.provider === 'builtin'),
			publishedAt: String(unit.publishedAt || ''),
			generatedAt: String(unit.generatedAt || ''),
			removedAt: new Date(now()).toISOString(),
			sentences: sentences.length,
			words: sentences.reduce((sum, sentence) => sum + countWords(sentence && sentence.en), 0),
			questions: Array.isArray(unit.questions) ? unit.questions.slice(0, 8) : [],
		}
		fs.mkdirSync(base, { recursive: true })
		fs.writeFileSync(path.join(base, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
		return record
	}

	/**
	 * Drop one record after it was regenerated.
	 * @param {string} id - unit id.
	 * @returns {boolean} true when a record existed.
	 */
	function remove(id) {
		const wanted = String(id ?? '')
		if (wanted === '') return false
		try {
			fs.rmSync(path.join(base, `${wanted}.json`), { force: true })
			return true
		} catch (error) {
			return false
		}
	}

	return { list, get, save, remove }
}
