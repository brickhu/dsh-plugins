/**
 * Pure logic for dsh-english-dictation.
 *
 * Everything here is deterministic and dependency-free: scoring, combo,
 * adaptive theta, rolling grade, item validation, report sanitizing, profile
 * day/streak math. The Host imports this module; the browser bundle mirrors
 * the same functions (it cannot import an ESM file), and `test/run.mjs`
 * cross-checks both copies against this file.
 *
 * No DSH, no network, no filesystem.
 */
import { CEFR_LEVELS } from './rewrite.js'

/* ───────────────────────────── Identity ───────────────────────────── */

/** Package name; also the Loader patch id and the ModuleLoader factory id. */
export const PACKAGE_NAME = 'dsh-english-dictation'
/** Client locale namespace. */
export const LOCALE_NS = 'dshEnglishDictation'
/** HTTP route prefix used by the browser half. */
export const API_PREFIX = '/api/dsh-english-dictation'
/** Storage directory name under `~/.dsh/storages/`. */
export const STORAGE_NAMESPACE = 'dsh-english-dictation'

/* ───────────────────────────── Tuning ───────────────────────────── */

/** Accepted item length, in words. */
export const MIN_WORDS = 5
export const MAX_WORDS = 12
/** Longest accepted single word. */
export const MAX_WORD_CHARS = 15
/** Answer generation budget inside `/run/answer`. */
export const ANSWER_BUDGET_MS = 5000
/** Review generation budget. */
export const REPORT_BUDGET_MS = 6000
/** How many recent sentences an item may not repeat. */
export const RECENT_WINDOW = 10
/** How many sentences the rolling grade looks at. */
export const ROLLING_WINDOW = 10

/** The fixed error-tag enum. Never add tags at runtime. */
export const TAGS = [
	'spelling',
	'articles',
	'tense',
	'agreement',
	'preposition',
	'word_order',
	'word_form',
	'collocation',
	'missing_word',
	'punctuation',
]

/** Chinese labels for the same enum. */
export const TAG_LABELS = {
	spelling: '拼写',
	articles: '冠词',
	tense: '时态',
	agreement: '主谓一致',
	preposition: '介词',
	word_order: '语序',
	word_form: '词形',
	collocation: '搭配',
	missing_word: '漏词',
	punctuation: '标点大小写',
}

/** Self-assessment bands and the theta each one starts at. */
export const BANDS = [
	{ id: 'A2', theta: 3 },
	{ id: 'B1', theta: 6 },
	{ id: 'B2', theta: 8 },
	{ id: 'C1', theta: 10 },
]

/** Result kinds of one sentence. */
export const RESULTS = ['perfect', 'great', 'pass', 'reveal']

/** Base points per result. */
export const BASE_SCORE = { perfect: 100, great: 70, pass: 40, reveal: 0 }

/** Result labels shown on the feedback card. */
export const RESULT_LABELS = {
	perfect: 'Perfect',
	great: 'Great',
	pass: '过关',
	reveal: '看答案',
}

/* ───────────────────────────── Small helpers ───────────────────────────── */

/**
 * Clamp a number into [min, max].
 * @param {number} value - input.
 * @param {number} min - lower bound.
 * @param {number} max - upper bound.
 * @returns {number} clamped value.
 */
export function clamp(value, min, max) {
	const number = Number.isFinite(value) ? value : min
	if (number < min) return min
	if (number > max) return max
	return number
}

/**
 * The characters a dictation word is compared on: lowercase letters, the
 * apostrophe (both widths) and the hyphen. Everything else is punctuation.
 * @param {string} text - raw word.
 * @returns {string} comparable form.
 */
export function normalizeWord(text) {
	return String(text ?? '')
		.replace(/[’‘]/g, "'")
		.toLowerCase()
		.replace(/[^a-z'-]/g, '')
}

/**
 * Split a sentence into raw words, punctuation left attached.
 * @param {string} text - sentence.
 * @returns {string[]} words.
 */
export function rawWords(text) {
	return String(text ?? '')
		.trim()
		.split(/\s+/)
		.filter((word) => word !== '')
}

/**
 * Comparable form of a whole sentence: lowercase, punctuation stripped,
 * whitespace collapsed.
 * @param {string} text - sentence.
 * @returns {string} comparable sentence.
 */
export function normalizeSentence(text) {
	return rawWords(String(text ?? '').replace(/[’‘]/g, "'").toLowerCase())
		.map((word) => word.replace(/[^a-z'-]/g, ''))
		.join(' ')
		.trim()
}

/**
 * Trailing punctuation of a raw word, e.g. `".` or `?`.
 * @param {string} text - raw word.
 * @returns {string} punctuation, possibly empty.
 */
export function punctuationOf(text) {
	return String(text ?? '').replace(/[A-Za-z'’-]/g, '')
}

/* ───────────────────────────── Scoring ───────────────────────────── */

/**
 * Turn per-word flags into one result kind.
 * @param {{revealed?: boolean, hadError?: boolean, usedBackspace?: boolean}} flags - sentence flags.
 * @returns {'perfect'|'great'|'pass'|'reveal'} result.
 */
export function resultOf(flags) {
	const source = flags || {}
	if (source.revealed) return 'reveal'
	if (source.hadError) return 'pass'
	if (source.usedBackspace) return 'great'
	return 'perfect'
}

/**
 * Combo multiplier f(n) read from the combo *before* the answer.
 * @param {number} combo - combo count before this sentence.
 * @returns {number} multiplier.
 */
export function multiplier(combo) {
	const n = Math.max(0, Math.floor(Number(combo) || 0))
	if (n < 3) return 1
	if (n < 5) return 1.1
	if (n < 7) return 1.2
	if (n < 10) return 1.3
	if (n < 15) return 1.5
	if (n < 20) return 1.8
	return 2
}

/**
 * Points for one sentence.
 * @param {string} result - result kind.
 * @param {number} comboBefore - combo before the answer.
 * @returns {number} rounded points.
 */
export function sentenceScore(result, comboBefore) {
	const base = Object.prototype.hasOwnProperty.call(BASE_SCORE, result) ? BASE_SCORE[result] : 0
	return Math.round(base * multiplier(comboBefore))
}

/**
 * The combo after one sentence: only Perfect and Great extend it.
 * @param {number} combo - current combo.
 * @param {string} result - result kind.
 * @returns {number} next combo.
 */
export function nextCombo(combo, result) {
	if (result === 'perfect' || result === 'great') return Math.max(0, Math.floor(Number(combo) || 0)) + 1
	return 0
}

/**
 * The adaptive outcome of one sentence: 1 / 0.5 / 0.
 * @param {string} result - result kind.
 * @returns {number} outcome.
 */
export function outcomeOf(result) {
	if (result === 'perfect' || result === 'great') return 1
	if (result === 'pass') return 0.5
	return 0
}

/**
 * Normalized per-sentence rate used by the rolling grade; the combo bonus is
 * deliberately excluded so a long combo cannot inflate the rating.
 * @param {string} result - result kind.
 * @returns {number} rate in [0,1].
 */
export function rateOf(result) {
	const base = Object.prototype.hasOwnProperty.call(BASE_SCORE, result) ? BASE_SCORE[result] : 0
	return base / 100
}

/**
 * Grade for one rate.
 * @param {number} rate - rate in [0,1].
 * @returns {'SSS'|'SS'|'S'|'A'|'B'|'C'} grade.
 */
export function gradeOfRate(rate) {
	if (rate >= 0.95) return 'SSS'
	if (rate >= 0.9) return 'SS'
	if (rate >= 0.85) return 'S'
	if (rate >= 0.75) return 'A'
	if (rate >= 0.6) return 'B'
	return 'C'
}

/**
 * Rolling grade over the most recent sentences of a run.
 * @param {Array<string|{result: string}>} results - run results.
 * @param {number} [window] - sample size.
 * @returns {{grade: string, rate: number, sample: number, low: boolean}} grade.
 */
export function rollingGrade(results, window = ROLLING_WINDOW) {
	const list = Array.isArray(results) ? results : []
	const size = Number.isFinite(window) && window > 0 ? Math.floor(window) : ROLLING_WINDOW
	const recent = list.slice(-size)
	const rates = recent.map((entry) => rateOf(typeof entry === 'string' ? entry : entry && entry.result))
	const rate = rates.length === 0 ? 0 : rates.reduce((sum, value) => sum + value, 0) / rates.length
	return { grade: gradeOfRate(rate), rate, sample: rates.length, low: rates.length < size }
}

/* ───────────────────────────── Adaptive theta ───────────────────────────── */

/**
 * One theta step after a sentence.
 * @param {number} theta - current theta.
 * @param {number} difficulty - sentence difficulty.
 * @param {string} result - result kind.
 * @returns {number} next theta, clamped to [1,12].
 */
export function thetaNext(theta, difficulty, result) {
	const current = clamp(Number(theta), 1, 12)
	const d = clamp(Number(difficulty), 1, 12)
	const p = 1 / (1 + Math.exp(d - current))
	const outcome = outcomeOf(result)
	return clamp(current + 0.6 * (outcome - p), 1, 12)
}

/**
 * One tag-mastery step.
 * @param {number} mastery - current mastery.
 * @param {string} result - result kind.
 * @returns {number} next mastery.
 */
export function tagMasteryNext(mastery, result) {
	const m = Number.isFinite(mastery) ? mastery : 0.5
	return clamp(0.7 * m + 0.3 * outcomeOf(result), 0, 1)
}

/**
 * The band label closest to a theta.
 * @param {number} theta - theta.
 * @returns {string} band id.
 */
export function bandOfTheta(theta) {
	const value = Number(theta) || 0
	if (value < 4.5) return 'A2'
	if (value < 7) return 'B1'
	if (value < 9) return 'B2'
	return 'C1'
}

/**
 * The theta a band starts at.
 * @param {string} band - band id.
 * @returns {number} theta.
 */
export function thetaOfBand(band) {
	const found = BANDS.find((entry) => entry.id === band)
	return found ? found.theta : 6
}

/**
 * Whether the sentence about to be asked is the forced challenge.
 * @param {number} asked - sentences already asked in this run.
 * @returns {boolean} challenge when the next ordinal is a multiple of 4.
 */
export function isChallengeTurn(asked) {
	const count = Math.max(0, Math.floor(Number(asked) || 0))
	return (count + 1) % 4 === 0
}

/**
 * Target difficulty of the next sentence.
 * @param {number} theta - current theta.
 * @param {number} asked - sentences already asked in this run.
 * @returns {number} target difficulty.
 */
export function targetDifficulty(theta, asked) {
	const base = clamp(Number(theta), 1, 12)
	return clamp(isChallengeTurn(asked) ? base + 1 : base, 1, 12)
}

/* ─────────────────────────── Sentence constituents ─────────────────────────── */

/** The sentence roles a question can carry. */
export const ROLES = ['subject', 'predicate', 'object', 'predicative', 'attributive', 'adverbial', 'complement', 'appositive', 'parenthetical']

/** Chinese role words the model may answer with, mapped to the canonical keys. */
const ROLE_ALIASES = {
	subject: ['subject', '主语'],
	predicate: ['predicate', '谓语'],
	object: ['object', '宾语'],
	predicative: ['predicative', '表语'],
	attributive: ['attributive', '定语'],
	adverbial: ['adverbial', '状语'],
	complement: ['complement', '补语'],
	appositive: ['appositive', '同位语'],
	parenthetical: ['parenthetical', '插入语'],
}

/** Normalize a role word (English key or Chinese term) to a canonical key. */
export function roleOf(text) {
	const value = String(text ?? '').trim().toLowerCase()
	for (const key of ROLES) {
		if (ROLE_ALIASES[key].some((alias) => alias.toLowerCase() === value)) return key
	}
	return ''
}

/** Auxiliaries, modals and negations that form the predicate. */
const AUX_WORDS = new Set([
	'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
	'has', 'have', 'had', 'do', 'does', 'did',
	'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
	"don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't", "wasn't",
	"weren't", "hasn't", "haven't", "hadn't", "couldn't", "shouldn't", "wouldn't", "mustn't",
])
const COPULAS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'])
const PREPOSITIONS = new Set([
	'in', 'on', 'at', 'for', 'from', 'with', 'of', 'by', 'about', 'under', 'over',
	'into', 'through', 'during', 'after', 'before', 'near', 'between', 'without', 'around',
	'behind', 'across', 'along', 'toward', 'towards', 'against', 'upon', 'within', 'off',
	'up', 'down', 'out', 'inside', 'outside', 'beside', 'beneath', 'among', 'per',
])
const DETERMINERS = new Set([
	'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
	'our', 'their', 'some', 'any', 'each', 'every', 'no', 'another', 'much', 'many',
	'two', 'three', 'four', 'five', 'both', 'all',
])
const CONJUNCTIONS = new Set(['and', 'or', 'but', 'so', 'if', 'when', 'while', 'because', 'than', 'though', 'although', 'unless', 'until', 'since'])
const NEGATIONS = new Set(['not', "n't", 'never'])
const INTERJECTIONS = new Set(['no', 'yes', 'oh', 'ah', 'well', 'hi', 'hello', 'wow', 'hey'])

/**
 * Split a sentence into sentence constituents (句子成分), the way the reference
 * app does: each constituent becomes one practice question, every word inside it
 * stays its own input box.
 *
 * Heuristic order: a leading interjection is an adverbial; the words before the
 * first verb form the subject; auxiliary/verb/negation words form the predicate;
 * prepositional phrases are adverbials; what follows a copula is a predicative
 * and what follows a transitive verb is an object; anything else is an adverbial.
 *
 * For "No, I am not the teacher." this yields
 * `No,` (状语) / `I` (主语) / `am not` (谓语) / `the teacher` (表语).
 *
 * @param {Array<string|{text?: string, raw?: string, plain?: string, pos?: string}>} words - words.
 * @returns {{chunks: number[][], roles: string[]}} constituent groups and roles.
 */
export function parseChunks(words) {
	const list = (Array.isArray(words) ? words : []).map((word) => {
		if (typeof word === 'string') return { text: word, pos: '' }
		if (word && typeof word === 'object') {
			return { text: String(word.text ?? word.raw ?? word.plain ?? ''), pos: typeof word.pos === 'string' ? word.pos : '' }
		}
		return { text: '', pos: '' }
	})
	const count = list.length
	const bare = (index) => normalizeWord(list[index] ? list[index].text : '')
	const posOf = (index) => {
		const pos = list[index] ? list[index].pos : ''
		return pos === 'other' ? '' : pos
	}
	const isAux = (index) => AUX_WORDS.has(bare(index))
	const isNeg = (index) => NEGATIONS.has(bare(index))
	const isVerb = (index) => posOf(index) === 'verb' || isAux(index) || isNeg(index)
	const isPrep = (index) => posOf(index) === 'prep' || PREPOSITIONS.has(bare(index))
	const isDet = (index) => posOf(index) === 'det' || DETERMINERS.has(bare(index))
	const isNameish = (index) => posOf(index) === 'noun' || posOf(index) === 'pron' || posOf(index) === 'num'
	const chunks = []
	const roles = []
	const push = (indexes, role) => {
		if (indexes.length === 0) return
		chunks.push(indexes)
		roles.push(role)
	}
	let index = 0

	// Leading interjection: 状语 ("No,").
	if (index < count && (posOf(index) === 'interj' || INTERJECTIONS.has(bare(index)))) {
		push([index], 'adverbial')
		index += 1
	}

	// Subject: everything before the first verb-like word.
	if (index < count) {
		const group = []
		while (index < count && !isVerb(index) && !isPrep(index) && group.length < 5) {
			if (isDet(index) || isNameish(index) || posOf(index) === 'adj' || posOf(index) === '') {
				group.push(index)
				index += 1
				continue
			}
			break
		}
		if (group.length > 0) push(group, 'subject')
	}

	// Predicate: auxiliary / modal / negation + verb chain (up to 4).
	let predicateCopula = false
	if (index < count && (isAux(index) || isNeg(index) || posOf(index) === 'verb')) {
		const group = []
		while (index < count && group.length < 4 && (isAux(index) || isNeg(index) || posOf(index) === 'verb' || posOf(index) === '')) {
			if (posOf(index) === '' && group.length > 0 && (isPrep(index) || CONJUNCTIONS.has(bare(index)))) break
			group.push(index)
			index += 1
		}
		predicateCopula = group.some((wordIndex) => COPULAS.has(bare(wordIndex)))
		push(group, 'predicate')
	}

	// The rest: prepositional phrases are adverbials; copula complements are
	// predicatives; noun groups after a verb are objects; leftovers are adverbials.
	while (index < count) {
		if (isPrep(index)) {
			if (bare(index) === 'to' && index + 1 < count && (posOf(index + 1) === 'verb' || posOf(index + 1) === '')) {
				const previousVerb = index > 0 && (isVerb(index - 1) || (isAux(index - 1) && COPULAS.has(bare(index - 1))))
				push([index, index + 1], previousVerb ? 'object' : 'adverbial')
				index += 2
				continue
			}
			const group = [index]
			let cursor = index + 1
			while (cursor < count && group.length < 4 && (isDet(cursor) || isNameish(cursor) || posOf(cursor) === 'adj' || (posOf(cursor) === '' && !isPrep(cursor) && !CONJUNCTIONS.has(bare(cursor))))) {
				group.push(cursor)
				cursor += 1
				// The head noun ends the phrase: "of water" does not swallow the
				// following "every morning".
				if (isNameish(cursor - 1)) break
			}
			push(group, 'adverbial')
			index = cursor
			continue
		}
		const group = [index]
		let cursor = index + 1
		while (cursor < count && group.length < 4 && (isDet(cursor) || isNameish(cursor) || posOf(cursor) === 'adj') && !isVerb(cursor) && !isPrep(cursor)) {
			group.push(cursor)
			cursor += 1
			if (isNameish(cursor - 1)) break
		}
		const verbBefore = index > 0 && (isVerb(index - 1) || (isAux(index - 1) && COPULAS.has(bare(index - 1))))
		const role = predicateCopula ? 'predicative' : verbBefore ? 'object' : 'adverbial'
		push(group, role)
		index = cursor
	}
	if (chunks.length === 0) {
		chunks.push(list.map((_, wordIndex) => wordIndex))
		roles.push('predicate')
	}
	return { chunks, roles }
}

/**
 * Validate a model's constituent parse.
 *
 * The parse must cover every word once, in order, in 1–5 word groups, and carry
 * one known role per group.
 *
 * @param {unknown} rawChunks - candidate groups.
 * @param {unknown} rawRoles - candidate roles.
 * @param {number} count - word count.
 * @returns {{chunks: number[][], roles: string[]}|null} parse, or null.
 */
export function validateParse(rawChunks, rawRoles, count) {
	const total = Math.max(0, Math.floor(Number(count) || 0))
	if (!Array.isArray(rawChunks) || !Array.isArray(rawRoles) || rawChunks.length !== rawRoles.length) return null
	if (total === 0 || rawChunks.length === 0 || rawChunks.length > total) return null
	if (total > 3 && rawChunks.length < 2) return null
	const chunks = []
	const roles = []
	const seen = new Set()
	let expected = 0
	for (let groupIndex = 0; groupIndex < rawChunks.length; groupIndex += 1) {
		const group = rawChunks[groupIndex]
		if (!Array.isArray(group) || group.length === 0 || group.length > 5) return null
		const list = []
		for (const value of group) {
			if (!Number.isInteger(value) || value < 0 || value >= total || seen.has(value)) return null
			if (value !== expected) return null
			seen.add(value)
			expected += 1
			list.push(value)
		}
		const role = roleOf(rawRoles[groupIndex])
		if (role === '') return null
		chunks.push(list)
		roles.push(role)
	}
	return expected === total ? { chunks, roles } : null
}

/** @deprecated alias kept for older call sites. */
export function chunkSentence(words) {
	return parseChunks(words).chunks
}

/**
 * Chunks and roles for an item: the model's parse when valid, else the rule.
 * @param {unknown} rawChunks - model groups.
 * @param {unknown} rawRoles - model roles.
 * @param {Array<string|{text: string}>} words - words.
 * @returns {{chunks: number[][], roles: string[]}} plan.
 */
export function planOf(rawChunks, rawRoles, words) {
	const list = Array.isArray(words) ? words : []
	return validateParse(rawChunks, rawRoles, list.length) || parseChunks(list)
}

/** @deprecated kept for older call sites; use `planOf`. */
export function chunksOf(raw, words) {
	return planOf(raw, null, words).chunks
}

/** @deprecated kept for tests; use `parseChunks`. */
export function deriveChunks(words) {
	return parseChunks(words).chunks
}

/** @deprecated kept for tests; use `validateParse`. */
export function normalizeChunks(raw, count) {
	const result = validateParse(raw, (Array.isArray(raw) ? raw : []).map(() => 'predicate'), count)
	return result ? result.chunks : null
}

/* ───────────────────────────── Item validation ───────────────────────────── */

/** Characters that never appear in a dictation sentence. */
const BANNED = /[[\]{}()"“”«»„`\\/<>;:@#$%^&*_=+~|]/
/** Digits and currency are read badly by TTS and typed badly. */
const BANNED_CONTENT = /[0-9０-９€£¥₹$]/
/** URLs. */
const BANNED_URL = /https?:\/\/|www\./i
/** Abbreviations, which every TTS engine reads one letter at a time. */
const BANNED_ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|St|Prof|vs|etc|e\.g|i\.e|U\.S)\./
/** Ellipsis and repeated punctuation. */
const BANNED_PUNCT = /\.{2,}|…{2,}|[!?]{2,}/u
/** Allowed part-of-speech tags, used only for coloring. */
export const POS_TAGS = ['pron', 'verb', 'noun', 'adj', 'adv', 'prep', 'conj', 'det', 'num', 'interj', 'other']
/** Homophone groups that must not be the only thing telling two words apart. */
const HOMOPHONE_GROUPS = [
	['there', 'their', "they're"],
	['its', "it's"],
	['your', "you're"],
	['to', 'too', 'two'],
	['then', 'than'],
]

/** Words allowed to start with a capital letter mid-sentence. */
const CAPITAL_OK = new Set(['i', "i'm", "i've", "i'll", "i'd", 'i’m'])

/**
 * Join the words the way the client will compare them (punctuation attached).
 * @param {Array<{text: string}>} words - item words.
 * @returns {string} joined sentence.
 */
export function joinWords(words) {
	return (words || []).map((word) => String((word && word.text) || '').trim()).join(' ')
}

/**
 * Accept either an exact join or one where the trailing punctuation lives
 * outside the last word (models differ; both are usable).
 * @param {string} en - sentence.
 * @param {string} joined - `joinWords(words)`.
 * @returns {{ok: boolean, tail: string}} whether it matches and the punctuation tail to attach.
 */
function matchJoin(en, joined) {
	if (joined === en) return { ok: true, tail: '' }
	const tail = /[.!?]+$/.exec(en)
	if (tail) {
		const head = en.slice(0, en.length - tail[0].length)
		if (joined === head) return { ok: true, tail: tail[0] }
	}
	return { ok: false, tail: '' }
}

/**
 * Validate one generated item.
 *
 * The contract is source-agnostic: a hand-written fixture is validated by the
 * same function the model output goes through, so a broken fixture fails loudly
 * in the tests instead of in the page.
 *
 * @param {unknown} raw - model output, `{item: …}` wrapper accepted.
 * @param {object} [options] - validation context.
 * @param {number} [options.targetDifficulty] - requested difficulty.
 * @param {string[]} [options.recent] - recent sentences to avoid.
 * @param {boolean} [options.allowDuplicate] - skip the recent-sentence check.
 * @returns {{ok: boolean, item?: object, errors: string[]}} verdict.
 */
export function validateItem(raw, options = {}) {
	const errors = []
	const source = raw && typeof raw === 'object' && raw.item && typeof raw.item === 'object' ? raw.item : raw
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		return { ok: false, errors: ['not-an-object'] }
	}
	const en = typeof source.en === 'string' ? source.en.trim().replace(/[’‘]/g, "'").replace(/\s+/g, ' ') : ''
	if (en === '') return { ok: false, errors: ['missing-en'] }

	if (BANNED_CONTENT.test(en)) errors.push('contains-number-or-currency')
	if (BANNED.test(en)) errors.push('contains-banned-character')
	if (BANNED_URL.test(en) || BANNED_ABBREVIATION.test(en)) errors.push('contains-abbreviation-or-url')
	if (BANNED_PUNCT.test(en)) errors.push('contains-repeated-punctuation')
	if (!/[.!?]$/.test(en)) errors.push('no-sentence-ending')

	const words = Array.isArray(source.words) ? source.words : []
	if (words.length < MIN_WORDS || words.length > MAX_WORDS) errors.push(`word-count:${words.length}`)
	const texts = words.map((word) => (word && typeof word.text === 'string' ? word.text.trim() : ''))
	if (texts.some((text) => text === '')) errors.push('empty-word')

	const join = matchJoin(en, joinWords(texts.map((text) => ({ text }))))
	if (!join.ok) errors.push('words-do-not-join-en')
	// Models often leave the sentence-final punctuation out of `words`; attach it
	// so the stored item always joins back to `en` exactly.
	if (join.ok && join.tail !== '' && texts.length > 0) texts[texts.length - 1] = `${texts[texts.length - 1]}${join.tail}`

	// A capitalized word that is not the first word, not `I`, and not an
	// abbreviation is a proper noun: dictation must avoid them.
	for (let index = 1; index < texts.length; index += 1) {
		const word = texts[index]
		const bare = normalizeWord(word)
		if (bare === '') continue
		if (/^[A-Z]/.test(word) && !CAPITAL_OK.has(bare)) {
			errors.push(`proper-noun:${word}`)
			break
		}
	}

	const normalizedWords = []
	for (let index = 0; index < texts.length; index += 1) {
		const word = words[index]
		const text = texts[index]
		const bare = normalizeWord(text)
		if (bare === '' || bare.length > MAX_WORD_CHARS) {
			if (bare.length > MAX_WORD_CHARS) errors.push(`word-too-long:${text}`)
			continue
		}
		if (!/^[a-z][a-z'-]*$/.test(bare)) errors.push(`bad-word:${text}`)
		const pos = typeof word?.pos === 'string' && POS_TAGS.includes(word.pos) ? word.pos : 'other'
		const entry = { text, pos }
		const ipa = typeof word?.ipa === 'string' ? word.ipa.trim() : ''
		if (ipa !== '' && ipa.length <= 40) entry.ipa = ipa
		const rawGloss = typeof word?.zh === 'string' ? word.zh.trim() : ''
		// One contextual meaning only: keep the first segment of a dictionary dump
		// ("是；正在" → "是", "找；看" → "找").
		const gloss = rawGloss.split(/[；;、,，/]/)[0].trim()
		if (gloss !== '' && gloss.length <= 20) entry.zh = gloss
		// Optional grammar help for the reveal card: the dictionary form and a
		// short note ("be" + "第三人称单数现在时" for "is").
		const base = typeof word?.base === 'string' ? word.base.trim() : ''
		if (base !== '' && base.length <= 20) entry.base = base
		const form = typeof word?.form === 'string' ? word.form.trim() : ''
		if (form !== '' && form.length <= 24) entry.form = form
		normalizedWords.push(entry)
	}
	if (normalizedWords.length !== words.length && words.length > 0 && errors.length === 0) {
		errors.push('word-normalization-mismatch')
	}

	// A homophone pair inside one sentence makes the dictation a guessing game.
	const bareSet = new Set(normalizedWords.map((word) => normalizeWord(word.text)))
	for (const group of HOMOPHONE_GROUPS) {
		const present = group.filter((entry) => bareSet.has(entry))
		if (present.length > 1) {
			errors.push(`homophone-ambiguity:${present.join('/')}`)
			break
		}
	}

	const difficulty = Number(source.difficulty)
	if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 12) {
		errors.push('difficulty-out-of-range')
	} else if (Number.isFinite(options.targetDifficulty) && Math.abs(difficulty - options.targetDifficulty) > 1.5) {
		errors.push('difficulty-off-target')
	}

	const tags = Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === 'string' && TAGS.includes(tag)) : []
	if (tags.length === 0) errors.push('missing-tags')

	const zh = typeof source.zh === 'string' ? source.zh.trim() : ''
	if (zh === '') errors.push('missing-zh')

	const recent = Array.isArray(options.recent) ? options.recent : []
	if (options.allowDuplicate !== true && recent.some((entry) => normalizeSentence(entry) === normalizeSentence(en))) {
		errors.push('duplicate-recent')
	}
	if (errors.length > 0) return { ok: false, errors }

	const item = {
		id: typeof source.id === 'string' && /^[a-z0-9-]{4,40}$/.test(source.id) ? source.id : makeItemId(en),
		en,
		zh,
		words: normalizedWords,
		// `chunks` is how the sentence is typed: the phrase pass first, then the
		// whole sentence. A bad/missing proposal falls back to the rule.
		...planOf(source.chunks, source.roles, normalizedWords),
		difficulty: Math.round(difficulty * 10) / 10,
		tags: Array.from(new Set(tags)).slice(0, 3),
	}
	if (options.targetDifficulty !== undefined) item.target = Math.round(Number(options.targetDifficulty) * 10) / 10
	return { ok: true, item, errors: [] }
}

/**
 * Stable id for an item, derived from its text so the same sentence keeps one
 * identity.
 * @param {string} en - sentence.
 * @returns {string} 8-hex id.
 */
export function makeItemId(en) {
	let hash = 0x811c9dc5
	const text = String(en ?? '')
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(16).padStart(8, '0').slice(0, 8)
}

/* ───────────────────────────── Review sanitizing ───────────────────────────── */

/** Sentence splitter used to enforce the two-sentence cap. */
const SENTENCE_SPLIT = /(?<=[。！？!?；;])|\n+/u

/**
 * Count characters the way a reader does (code points, not UTF-16 units).
 * @param {string} text - input.
 * @returns {number} length.
 */
export function charLength(text) {
	return Array.from(String(text ?? '')).length
}

/**
 * Clamp text to a code-point budget.
 * @param {string} text - input.
 * @param {number} max - budget.
 * @returns {string} clamped text.
 */
export function clampText(text, max) {
	const chars = Array.from(String(text ?? ''))
	if (chars.length <= max) return chars.join('')
	return chars.slice(0, max).join('')
}

/**
 * Keep at most two sentences.
 * @param {string} text - input.
 * @returns {string} at most two sentences.
 */
export function twoSentences(text) {
	const parts = String(text ?? '')
		.split(SENTENCE_SPLIT)
		.map((part) => part.trim())
		.filter((part) => part !== '')
	return parts.slice(0, 2).join('')
}

/**
 * Every quoted span a review may cite.
 * @param {string} text - review text.
 * @returns {string[]} spans.
 */
export function quotedSpans(text) {
	const pattern = /["“「『`']([^"”」』`']{1,40})["”」』`']/gu
	const spans = []
	let match = pattern.exec(String(text ?? ''))
	while (match !== null) {
		spans.push(match[1])
		match = pattern.exec(String(text ?? ''))
	}
	return spans
}

/**
 * Validate one model review.
 *
 * Every quoted span must exist in what the learner typed or in the sentence
 * itself (a correct answer may be quoted too). Spans that match neither are
 * removed from the text and reported, instead of letting the model invent a
 * quotation that never happened.
 *
 * @param {unknown} raw - model output, `{report: …}` wrapper accepted.
 * @param {{typed?: string, answer?: string, tags?: string[]}} context - ground truth.
 * @returns {{ok: boolean, report?: object, dropped: string[], errors: string[]}} verdict.
 */
export function sanitizeReport(raw, context = {}) {
	const errors = []
	const dropped = []
	const source = raw && typeof raw === 'object' && raw.report && typeof raw.report === 'object' ? raw.report : raw
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		return { ok: false, dropped, errors: ['not-an-object'] }
	}
	const typed = String(context.typed ?? '')
	const typedNorm = normalizeSentence(typed)
	const answer = String(context.answer ?? '')
	const answerWords = new Set(rawWords(answer).map((word) => normalizeWord(word)))
	const inTyped = (span) => typedNorm.includes(normalizeSentence(span)) && normalizeSentence(span) !== ''
	const inAnswer = (span) => {
		if (answer.toLowerCase().includes(span.toLowerCase())) return true
		const bare = normalizeWord(span)
		return bare !== '' && answerWords.has(bare)
	}

	const clean = (text) => {
		const spans = quotedSpans(text)
		let next = String(text ?? '')
		for (const span of spans) {
			if (inTyped(span) || inAnswer(span)) continue
			dropped.push(span)
			const escaped = span.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
			next = next
				.replace(new RegExp(`["“「『\`']${escaped}["”」』\`']`, 'gu'), '')
				.replace(new RegExp(`\\s{2,}`, 'gu'), ' ')
				.trim()
		}
		return next
	}

	// The contract is `verdict` ≤ 40 and `detail` ≤ 60 characters; a judgement
	// that spills a few characters is truncated rather than thrown away, and the
	// two-sentence cap runs on each half.
	const verdict = clampText(twoSentences(clean(typeof source.verdict === 'string' ? source.verdict.trim() : '')), 48)
	const detail = clampText(twoSentences(clean(typeof source.detail === 'string' ? source.detail.trim() : '')), 60)
	if (verdict === '' && detail === '') errors.push('empty-verdict')

	let action = { type: 'none' }
	const rawAction = source.action && typeof source.action === 'object' ? source.action : null
	if (rawAction && typeof rawAction.type === 'string') {
		if (rawAction.type === 'replay_sentence') {
			action = { type: 'replay_sentence' }
		} else if (rawAction.type === 'replay_word') {
			const word = normalizeWord(rawAction.word)
			// The sentence is the authority: `apple` in a report about `apples` is
			// snapped to the word that is actually there, so replay always speaks a
			// word from the sentence.
			const exact = rawWords(answer).find((entry) => normalizeWord(entry) === word)
			const contained = word.length >= 4 ? rawWords(answer).find((entry) => normalizeWord(entry).includes(word)) : undefined
			const known = exact || contained
			if (word !== '' && known) action = { type: 'replay_word', word: normalizeWord(known) }
		}
	}
	if (errors.length > 0) return { ok: false, dropped, errors }
	return { ok: true, report: { verdict, detail, action }, dropped, errors: [] }
}

/* ───────────────────────────── Calendar & streak ───────────────────────────── */

/**
 * Local calendar key for a Date.
 * @param {Date} [date] - day.
 * @returns {string} `YYYY-MM-DD`.
 */
export function dayKey(date = new Date()) {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

/**
 * The key one day before a key.
 * @param {string} key - `YYYY-MM-DD`.
 * @returns {string} previous key.
 */
export function previousDayKey(key) {
	const parts = String(key).split('-').map((part) => Number(part))
	if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return ''
	const date = new Date(parts[0], parts[1] - 1, parts[2] - 1)
	return dayKey(date)
}

/**
 * Consecutive practice days ending today (or yesterday, so a streak only breaks
 * after a full missed day).
 * @param {Record<string, {sentences?: number}>} days - day map.
 * @param {string} [today] - today's key.
 * @returns {number} streak in days.
 */
export function streakOf(days, today = dayKey()) {
	const map = days && typeof days === 'object' ? days : {}
	const practiced = (key) => {
		const entry = map[key]
		return Boolean(entry && Number(entry.sentences) > 0)
	}
	let cursor = practiced(today) ? today : previousDayKey(today)
	let streak = 0
	for (let guard = 0; guard < 400; guard += 1) {
		if (!cursor || !practiced(cursor)) break
		streak += 1
		cursor = previousDayKey(cursor)
	}
	return streak
}

/* ───────────────────────────── Profile shape ───────────────────────────── */

/** Voices the DeepSeek TTS endpoint documents, in panel order. */
export const CLOUD_VOICES = ['stella', 'tide']

/** Default settings, mirrored by the client. */
export const DEFAULT_SETTINGS = { rate: 0.95, sound: true, voiceName: '', engine: 'cloud', cloudVoice: 'stella', cefr: 'B1' }

/**
 * A profile for a learner who has never practiced.
 * @returns {object} profile.
 */
export function emptyProfile() {
	return {
		version: 1,
		theta: 6,
		band: '',
		tags: {},
		tagStats: {},
		stats: { runs: 0, sentences: 0, minutes: 0, replays: 0, days: {} },
		runs: [],
		activeRun: null,
		settings: { ...DEFAULT_SETTINGS },
	}
}

/**
 * Coerce anything read from disk (or a client) into a usable profile.
 * @param {unknown} raw - parsed JSON or garbage.
 * @returns {object} profile.
 */
export function normalizeProfile(raw) {
	const base = emptyProfile()
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
	const profile = base
	if (Number.isFinite(raw.theta)) profile.theta = clamp(raw.theta, 1, 12)
	if (typeof raw.band === 'string' && BANDS.some((entry) => entry.id === raw.band)) profile.band = raw.band
	if (raw.tags && typeof raw.tags === 'object' && !Array.isArray(raw.tags)) {
		for (const tag of TAGS) {
			const value = raw.tags[tag]
			if (Number.isFinite(value)) profile.tags[tag] = clamp(value, 0, 1)
		}
	}
	if (raw.tagStats && typeof raw.tagStats === 'object' && !Array.isArray(raw.tagStats)) {
		for (const tag of TAGS) {
			const entry = raw.tagStats[tag]
			if (!entry || typeof entry !== 'object') continue
			const count = Number(entry.count)
			const lastOutcome = Number(entry.lastOutcome)
			profile.tagStats[tag] = {
				count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
				lastOutcome: Number.isFinite(lastOutcome) ? clamp(lastOutcome, 0, 1) : 1,
			}
		}
	}
	if (raw.stats && typeof raw.stats === 'object') {
		const stats = raw.stats
		profile.stats.runs = Math.max(0, Math.floor(Number(stats.runs) || 0))
		profile.stats.sentences = Math.max(0, Math.floor(Number(stats.sentences) || 0))
		profile.stats.minutes = Math.max(0, Math.floor(Number(stats.minutes) || 0))
		profile.stats.replays = Math.max(0, Math.floor(Number(stats.replays) || 0))
		if (stats.days && typeof stats.days === 'object' && !Array.isArray(stats.days)) {
			for (const [key, value] of Object.entries(stats.days)) {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue
				const seconds = Math.max(0, Number(value.seconds) || 0)
				profile.stats.days[key] = {
					sentences: Math.max(0, Math.floor(Number(value.sentences) || 0)),
					minutes: Math.max(0, Math.floor(Number(value.minutes) || 0)),
					seconds,
				}
			}
		}
	}
	if (Array.isArray(raw.runs)) {
		profile.runs = raw.runs
			.filter((entry) => entry && typeof entry === 'object' && typeof entry.startedAt === 'string')
			.slice(0, 60)
			.map((entry) => ({
				id: typeof entry.id === 'string' ? entry.id : makeItemId(entry.startedAt),
				startedAt: entry.startedAt,
				endedAt: typeof entry.endedAt === 'string' ? entry.endedAt : entry.startedAt,
				sentences: Math.max(0, Math.floor(Number(entry.sentences) || 0)),
				accuracy: clamp(Number(entry.accuracy) || 0, 0, 100),
				grade: typeof entry.grade === 'string' ? entry.grade : 'C',
				score: Math.max(0, Math.floor(Number(entry.score) || 0)),
				bestCombo: Math.max(0, Math.floor(Number(entry.bestCombo) || 0)),
				minutes: Math.max(0, Math.floor(Number(entry.minutes) || 0)),
				mainIssues: Array.isArray(entry.mainIssues) ? entry.mainIssues.filter((tag) => TAGS.includes(tag)).slice(0, 3) : [],
			}))
	}
	if (raw.activeRun && typeof raw.activeRun === 'object') {
		const run = raw.activeRun
		if (typeof run.id === 'string') {
			profile.activeRun = {
				id: run.id,
				startedAt: typeof run.startedAt === 'string' ? run.startedAt : new Date().toISOString(),
				index: Math.max(0, Math.floor(Number(run.index) || 0)),
				score: Math.max(0, Math.floor(Number(run.score) || 0)),
				combo: Math.max(0, Math.floor(Number(run.combo) || 0)),
				bestCombo: Math.max(0, Math.floor(Number(run.bestCombo) || 0)),
				replays: Math.max(0, Math.floor(Number(run.replays) || 0)),
				results: Array.isArray(run.results) ? run.results.filter(isResultEntry).slice(0, 200) : [],
				current: isItemLike(run.current) ? normalizeStoredItem(run.current) : null,
			}
			profile.activeRun.index = profile.activeRun.results.length
		}
	}
	if (raw.settings && typeof raw.settings === 'object') {
		const settings = raw.settings
		if (Number.isFinite(settings.rate)) profile.settings.rate = clamp(settings.rate, 0.5, 2)
		if (typeof settings.sound === 'boolean') profile.settings.sound = settings.sound
		if (typeof settings.voiceName === 'string') profile.settings.voiceName = settings.voiceName.slice(0, 120)
		if (settings.engine === 'cloud' || settings.engine === 'system') profile.settings.engine = settings.engine
		if (CLOUD_VOICES.includes(settings.cloudVoice)) profile.settings.cloudVoice = settings.cloudVoice
		if (CEFR_LEVELS.includes(settings.cefr)) profile.settings.cefr = settings.cefr
	}
	return profile
}

/**
 * Whether a stored result entry is usable.
 * @param {unknown} entry - candidate.
 * @returns {boolean} usable.
 */
export function isResultEntry(entry) {
	return Boolean(entry && typeof entry === 'object' && typeof entry.itemId === 'string' && RESULTS.includes(entry.result))
}

/**
 * Whether a stored value looks like an item.
 * @param {unknown} item - candidate.
 * @returns {boolean} usable.
 */
export function isItemLike(item) {
	if (!item || typeof item !== 'object') return false
	return typeof item.id === 'string' && typeof item.en === 'string' && Array.isArray(item.words) && item.words.length > 0
}

/**
 * Coerce a stored item into the shape the page expects.
 * @param {object} item - stored item.
 * @returns {object} item.
 */
export function normalizeStoredItem(item) {
	const words = item.words
		.filter((word) => word && typeof word.text === 'string')
		.map((word) => {
			const entry = { text: word.text, pos: POS_TAGS.includes(word.pos) ? word.pos : 'other' }
			if (typeof word.ipa === 'string' && word.ipa !== '') entry.ipa = word.ipa
			if (typeof word.zh === 'string' && word.zh !== '') entry.zh = word.zh
			if (typeof word.base === 'string' && word.base !== '') entry.base = word.base
			if (typeof word.form === 'string' && word.form !== '') entry.form = word.form
			return entry
		})
	const plan = planOf(item.chunks, item.roles, words)
	return {
		id: item.id,
		en: item.en,
		zh: typeof item.zh === 'string' ? item.zh : '',
		words,
		chunks: plan.chunks,
		roles: plan.roles,
		difficulty: clamp(Number(item.difficulty) || 5, 1, 12),
		tags: Array.isArray(item.tags) ? item.tags.filter((tag) => TAGS.includes(tag)) : [],
	}
}
