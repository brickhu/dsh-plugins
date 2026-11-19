/**
 * Sentence seeds from a broad, open corpus.
 *
 * The plugin ships no sentence bank: variety has to come from somewhere real.
 * Tatoeba is a large collection of human-written sentences with Chinese
 * translations, free to use under CC BY 2.0 FR / CC0 (attribution required,
 * see README). This module asks it for a small random batch, keeps only the
 * sentences that could pass the dictation rules, and hands them out one by one.
 *
 * The model still does the work that matters for a learner: rewriting the seed
 * to the target difficulty and annotating it per word. The seed only decides
 * *what the sentence is about* — that is where the variety comes from.
 *
 * Everything here is best-effort: a slow, failing or unreachable corpus yields
 * no seed, and the caller falls back to writing a sentence from scratch.
 */

import { MAX_WORDS, MIN_WORDS, normalizeSentence, validateItem } from './rules.js'

/** Public search endpoint (no key). */
const ENDPOINT = 'https://tatoeba.org/en/api_v0/search'
/** Broad topics: each request picks one at random, so the pool does not drift. */
const TOPICS = [
	'travel', 'work', 'family', 'food', 'weather', 'study', 'health', 'friend',
	'money', 'morning', 'music', 'sport', 'city', 'home', 'weekend', 'holiday',
	'book', 'movie', 'phone', 'train', 'shop', 'garden', 'doctor', 'teacher',
]
/** How many usable seeds to keep in memory (never on disk). */
const POOL_SIZE = 6
/** Below this, a used-up pool asks for a refill. */
const REFILL_AT = 2
/** Tatoeba answers slowly and throttles bursts: one request at a time, a pause between them. */
const GAP_MS = 1200
/** A single request may take this long before it is abandoned. */
const REQUEST_BUDGET_MS = 9000

/**
 * Turn one Tatoeba result into a seed: English text plus its simplified Chinese.
 *
 * Tatoeba translations carry a script and optional transcriptions; the plugin
 * works in simplified Chinese, so a Hans transcription wins. A result with no
 * Chinese at all is useless here: the rewrite prompt needs the meaning.
 * @param {object} result - one API result.
 * @returns {{en: string, zh: string}|null} seed, or null.
 */
export function seedOf(result) {
	if (!result || typeof result.text !== 'string') return null
	const en = result.text.trim()
	if (en === '') return null
	let zh = ''
	for (const group of Array.isArray(result.translations) ? result.translations : []) {
		for (const translation of Array.isArray(group) ? group : []) {
			if (!translation || translation.lang !== 'cmn') continue
			const transcriptions = Array.isArray(translation.transcriptions) ? translation.transcriptions : []
			const hans = transcriptions.find((entry) => entry && (entry.script === 'Hans' || entry.script === 'Hanss') && typeof entry.text === 'string')
			if (hans && hans.text !== '') {
				zh = hans.text
				break
			}
			if (zh === '' && typeof translation.text === 'string' && /[\u4e00-\u9fff]/.test(translation.text)) zh = translation.text
		}
		if (zh !== '') break
	}
	if (zh === '') return null
	return { en, zh: zh.trim() }
}

/**
 * Text-level check: would this sentence be a legal dictation question?
 *
 * The same validator that guards model output guards corpus sentences — word
 * count, digits, proper nouns, quotes, homophone traps, punctuation. The item
 * fields the corpus cannot know (per-word glosses, pos, tags) are filled with
 * placeholders and the verdict is only used as a yes/no on the text.
 * @param {string} en - sentence.
 * @param {string} zh - its translation.
 * @param {string[]} [recent] - sentences already used.
 * @returns {boolean} true when the sentence may be used as a seed.
 */
export function usableSeed(en, zh, recent = []) {
	if (typeof en !== 'string' || typeof zh !== 'string' || zh === '') return false
	const words = en.split(/\s+/).filter(Boolean).map((text) => ({ text, pos: 'other' }))
	if (words.length < MIN_WORDS || words.length > MAX_WORDS) return false
	const verdict = validateItem({ en, zh, words, difficulty: 6, tags: ['tense'] }, { allowDuplicate: true, recent })
	return verdict.ok
}

/**
 * Create the corpus client.
 * @param {object} [options] - overrides for the tests.
 * @param {Function} [options.fetchImpl] - fetch implementation.
 * @param {Function} [options.now] - clock.
 * @param {Function} [options.log] - diagnostic sink, `(line) => void`.
 * @param {boolean} [options.enabled] - false turns every lookup into a miss.
 * @returns {{seed: Function, size: Function, stop: Function}} client.
 */
export function createCorpus(options = {}) {
	const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : typeof globalThis.fetch === 'function' ? globalThis.fetch : null
	const enabled = options.enabled !== false && fetchImpl !== null
	const clock = typeof options.now === 'function' ? options.now : () => Date.now()
	const log = typeof options.log === 'function' ? options.log : () => {}
	const topics = Array.isArray(options.topics) && options.topics.length > 0 ? options.topics : TOPICS
	const requestBudget = Number(options.requestBudgetMs) > 0 ? Number(options.requestBudgetMs) : REQUEST_BUDGET_MS
	const gap = Number(options.gapMs) >= 0 ? Number(options.gapMs) : GAP_MS

	let pool = []
	let inFlight = null
	let lastRequestAt = 0
	let stopped = false
	const used = new Set()

	/**
	 * One paced search request.
	 * @param {string} query - topic keyword.
	 * @returns {Promise<object[]>} raw results.
	 */
	async function search(query) {
		const wait = Math.max(0, lastRequestAt + gap - clock())
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
		lastRequestAt = clock()
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), requestBudget)
		const url =
			`${ENDPOINT}?from=eng&to=cmn&query=${encodeURIComponent(query)}` +
			`&sort=random&limit=10&word_count_min=${MIN_WORDS}&word_count_max=${MAX_WORDS}`
		try {
			const response = await fetchImpl(url, {
				headers: { 'user-agent': 'dsh-english-dictation/0.20 (+https://tatoeba.org)', accept: 'application/json' },
				signal: controller.signal,
			})
			if (!response.ok) {
				log(`corpus ${query} ${response.status}`)
				return []
			}
			const body = await response.json()
			log(`corpus ${query} ${Array.isArray(body.results) ? body.results.length : 0} results`)
			return Array.isArray(body.results) ? body.results : []
		} catch (error) {
			log(`corpus ${query} failed: ${(error && error.message) || error}`)
			return []
		} finally {
			clearTimeout(timer)
		}
	}

	/**
	 * Fill the pool up to `POOL_SIZE` with usable, not-yet-used seeds.
	 *
	 * One request is made per refill (Tatoeba throttles bursts). The topics of
	 * this request are shuffled so consecutive sentences do not share a theme.
	 * @returns {Promise<void>} completion.
	 */
	async function fill() {
		if (stopped) return
		const query = topics[Math.floor(Math.random() * topics.length)]
		const results = await search(query)
		if (stopped) return
		for (const result of results) {
			if (pool.length >= POOL_SIZE) break
			const seed = seedOf(result)
			if (!seed) continue
			const key = normalizeSentence(seed.en)
			if (used.has(key) || pool.some((entry) => normalizeSentence(entry.en) === key)) continue
			if (!usableSeed(seed.en, seed.zh)) continue
			pool.push(seed)
		}
	}

	/**
	 * Refill in the background, at most one at a time.
	 * @returns {void}
	 */
	function topUp() {
		if (stopped || inFlight !== null || pool.length >= REFILL_AT) return
		inFlight = fill().finally(() => {
			inFlight = null
		})
	}

	return {
		/**
		 * One seed sentence, or null when the corpus cannot provide one.
		 *
		 * Blocking only when the pool is empty; a low pool is topped up in the
		 * background so the wait is paid once, not on every sentence.
		 * @returns {Promise<{en: string, zh: string}|null>} seed.
		 */
		async seed() {
			if (!enabled || stopped) return null
			if (pool.length === 0 && inFlight !== null) await inFlight
			if (pool.length === 0) await fill()
			const seed = pool.shift() || null
			if (seed) {
				used.add(normalizeSentence(seed.en))
				if (used.size > 300) used.clear()
			}
			topUp()
			return seed
		},
		/** @returns {number} seeds currently held. */
		size() {
			return pool.length
		},
		/** Stop all future requests (plugin disposal). */
		stop() {
			stopped = true
			pool = []
		},
	}
}
