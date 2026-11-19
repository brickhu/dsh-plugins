/**
 * Keyless dictionary lookup (Baidu, then Youdao) for per-word Chinese glosses.
 *
 * The Host asks for the candidate senses of a word; the model only picks which
 * sense fits the sentence, so the annotation itself always comes from a
 * dictionary and never from a hallucinated gloss.
 */
const BAIDU = 'https://fanyi.baidu.com/sug'
const YOUDAO = 'https://dict.youdao.com/jsonapi?q='
const TIMEOUT_MS = 6000
const POS_LABELS = {
	n: 'noun', v: 'verb', vt: 'verb', vi: 'verb', adj: 'adj', adv: 'adv',
	prep: 'prep', conj: 'conj', pron: 'pron', det: 'det', num: 'num', interj: 'interj',
}

/** POS tag of the dictionary entry → the plugin's POS vocabulary. */
function posOf(tag) {
	return POS_LABELS[String(tag).toLowerCase()] || 'other'
}

/**
 * Parse Baidu's `v` string ("n. 书; 卷; 课本 vt. 预订") into senses.
 * @param {string} text - the dictionary line.
 * @returns {Array<{pos: string, zh: string}>} senses.
 */
export function parseSenses(text) {
	const source = String(text ?? '')
	const marks = /(?:^|\s)(n|v|vt|vi|adj|adv|prep|conj|pron|det|num|interj)\.\s*/gi
	const matches = []
	let match
	while ((match = marks.exec(source)) !== null) matches.push({ pos: match[1], start: match.index, end: marks.lastIndex })
	const senses = []
	for (let index = 0; index < matches.length; index += 1) {
		const current = matches[index]
		const stop = index + 1 < matches.length ? matches[index + 1].start : source.length
		const body = source.slice(current.end, stop)
		for (const piece of body.split(/[;；,，、]/)) {
			const zh = piece
				.replace(/（[^）]*）/g, '')
				.replace(/\([^)]*\)/g, '')
				.replace(/[A-Za-z&]/g, '')
				.replace(/[（(].*$/, '')
				.trim()
				.slice(0, 12)
			if (zh === '') continue
			senses.push({ pos: posOf(current.pos), zh })
		}
	}
	return senses.slice(0, 8)
}

/** One HTTP request with a timeout; null on any failure. */
async function request(url, init) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	try {
		const response = await fetch(url, { ...init, signal: controller.signal })
		if (!response.ok) return null
		return await response.json()
	} catch (error) {
		return null
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Create the dictionary service.
 * @returns {{lookup: Function}} service with an in-memory cache.
 */
export function createDictionary() {
	const cache = new Map()

	/**
	 * Candidate senses for one word, in the order the dictionary lists them.
	 * @param {string} word - lower-case word.
	 * @returns {Promise<Array<{pos: string, zh: string}>>} senses (empty when unknown).
	 */
	async function lookup(word) {
		const key = String(word ?? '').trim().toLowerCase()
		if (key === '') return []
		if (cache.has(key)) return cache.get(key)

		const data = await request(BAIDU, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: `kw=${encodeURIComponent(key)}`,
		})
		if (data && Array.isArray(data.data) && data.data[0]) {
			const senses = parseSenses(data.data[0].v)
			if (senses.length > 0) {
				cache.set(key, senses)
				return senses
			}
		}

		const fallback = await request(`${YOUDAO}${encodeURIComponent(key)}`)
		const simple = fallback && fallback.ec ? fallback.ec : null
		const senses = []
		if (simple) {
			for (const entry of simple) {
				for (const tr of entry.trs || []) {
					const text = String(tr.tr || '').replace(/[A-Za-z.]/g, '').trim().slice(0, 12)
					if (text !== '') senses.push({ pos: 'other', zh: text })
				}
			}
		}
		cache.set(key, senses.slice(0, 8))
		return senses.slice(0, 8)
	}

	return { lookup }
}
