/**
 * Tag-based practice: pick a topic, generate one sentence at a time from that
 * topic's word set, and track which words the learner has actually practiced.
 *
 * The word set is the whole curriculum: difficulty is declared by the category
 * level, coverage is measured per word, and the model only realizes a spec
 * (function × grammar × a few words) into a legal dictation sentence.
 */

import fs from 'node:fs'
import path from 'node:path'
import { MAX_WORDS, MIN_WORDS, normalizeWord, validateItem } from './rules.js'
import { createDictionary } from './dictionary.js'

/** One dictionary for the process: word → candidate senses (cached). */
const dictionary = createDictionary()

/**
 * Candidate senses for a word (cached); used by the host when it asks the model
 * which sense fits the sentence.
 * @param {string} word - word.
 * @returns {Promise<Array<{pos: string, zh: string}>>} senses.
 */
export function sensesOf(word) {
	return dictionary.lookup(normalizeWord(word))
}

/**
 * Replace the model's per-word gloss with the dictionary's sense for that word.
 * The annotation then always comes from a dictionary; when the dictionary has no
 * entry the model's gloss is kept.
 * @param {object} item - validated item.
 * @returns {Promise<object>} the same item, enriched.
 */
async function glossWithDictionary(item) {
	for (const word of item.words || []) {
		const plain = normalizeWord(word.text)
		if (plain === '') continue
		let senses = []
		try {
			senses = await dictionary.lookup(plain)
		} catch (error) {
			senses = []
		}
		if (senses.length === 0) continue
		const samePos = senses.find((sense) => sense.pos === word.pos)
		const chosen = samePos || senses[0]
		word.zh = chosen.zh
		if (chosen.pos !== 'other') word.pos = chosen.pos
	}
	return item
}
import { extractJson } from './prompts.js'

/** CEFR band → the plugin's 1–12 difficulty axis. */
export const LEVEL_SCORE = { A1: 2, A2: 4, B1: 6, B2: 8, C1: 10, C2: 12 }

/** How many generated-but-unpracticed sentences a category keeps. */
const MAX_PENDING = 6
/** How many recently practiced items are remembered for de-duplication. */
const MAX_RECENT = 40
/** How many words a single sentence is aimed at. */
const FOCUS_WORDS = 4

/**
 * Read and validate the category packs.
 * @param {string} dir - plugin directory.
 * @returns {{categories: object[], byId: Map<string, object>}} categories.
 */
export function loadCategories(dir) {
	const raw = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'categories.json'), 'utf8'))
	const categories = []
	const byId = new Map()
	for (const entry of Array.isArray(raw.categories) ? raw.categories : []) {
		if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z-]{1,20}$/.test(entry.id)) continue
		if (typeof entry.label !== 'string' || entry.label === '') continue

		const words = Array.isArray(entry.words)
			? [...new Set(entry.words.map((word) => String(word).trim().toLowerCase()).filter((word) => /^[a-z][a-z' -]*$/.test(word)))]
			: []
		if (words.length < 20) continue
		const category = {
			id: entry.id,
			label: entry.label,
			group: typeof entry.group === 'string' ? entry.group : '其他',
			goal: typeof entry.goal === 'string' ? entry.goal : '',
			keywords: Array.isArray(entry.keywords) ? entry.keywords.filter((word) => typeof word === 'string') : [],
			functions: Array.isArray(entry.functions) && entry.functions.length > 0 ? entry.functions.filter((fn) => typeof fn === 'string') : ['request', 'ask', 'confirm'],
			grammar: Array.isArray(entry.grammar) && entry.grammar.length > 0 ? entry.grammar.filter((line) => typeof line === 'string') : ['一般现在时'],
			words,
			wordSet: new Set(words),
			collocations: words.filter((word) => word.includes(' ')),
		}
		categories.push(category)
		byId.set(category.id, category)
	}
	return { categories, byId }
}

/**
 * Read the always-allowed core words.
 * @param {string} dir - plugin directory.
 * @returns {Set<string>} core words, lower case.
 */
export function loadCore(dir) {
	const raw = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'core-words.json'), 'utf8'))
	return new Set((Array.isArray(raw.words) ? raw.words : []).map((word) => String(word).trim().toLowerCase()).filter(Boolean))
}

/** Irregular past forms a learner meets in these scenes. */
const IRREGULAR = new Map(
	Object.entries({
		paid: 'pay', bought: 'buy', made: 'make', took: 'take', got: 'get', went: 'go', said: 'say',
		told: 'tell', left: 'leave', brought: 'bring', felt: 'feel', kept: 'keep', drank: 'drink',
		ate: 'eat', slept: 'sleep', found: 'find', heard: 'hear', met: 'meet', lost: 'lose',
		sent: 'send', spent: 'spend', broke: 'break', fell: 'fall', flew: 'fly', forgot: 'forget',
		grew: 'grow', spoke: 'speak', gave: 'give', saw: 'see', came: 'come', ran: 'run', wrote: 'write',
		stood: 'stand', sat: 'sit', held: 'hold', built: 'build', chose: 'choose',
	}),
)

/**
 * Is `word` a member of `set`, allowing inflection and irregular past forms?
 * @param {string} word - a single word.
 * @param {Set<string>} set - word set.
 * @returns {boolean} membership.
 */
export function inWordSet(word, set) {
	const plain = String(word).toLowerCase().replace(/[^a-z' -]/g, '').trim()
	if (plain === '') return true
	if (set.has(plain)) return true
	if (IRREGULAR.has(plain)) {
		const base = IRREGULAR.get(plain)
		if (set.has(base) || set.has(`${base}e`)) return true
	}
	for (const suffix of ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est']) {
		if (!plain.endsWith(suffix) || plain.length <= suffix.length + 2) continue
		const stem = plain.slice(0, -suffix.length)
		if (set.has(stem) || set.has(`${stem}e`)) return true
		if (IRREGULAR.has(stem) && set.has(IRREGULAR.get(stem))) return true
	}
	return false
}

/**
 * The content words of a sentence, with collocations removed first.
 * @param {string} text - sentence.
 * @param {object} category - category.
 * @param {Set<string>} core - always-allowed words.
 * @returns {string[]} content words outside the core list.
 */
export function contentWordsOf(text, category, core) {
	let rest = ` ${String(text).toLowerCase().replace(/[^a-z' -]/g, ' ')} `
	for (const phrase of [...category.collocations, ...[...core].filter((word) => word.includes(' '))]) {
		rest = rest.split(` ${phrase} `).join(' ')
	}
	return rest
		.split(/\s+/)
		.filter(Boolean)
		.filter((word) => !inWordSet(word, core))
}

/**
 * A sentence the learner can actually attempt: length, no digits/proper nouns,
 * and every content word inside the category's set.
 * @param {object} raw - model item.
 * @param {object} category - category.
 * @param {Set<string>} core - core words.
 * @param {string[]} recent - recently used sentences.
 * @returns {{ok: boolean, item?: object, errors: string[]}} verdict.
 */
export async function validateCategoryItem(raw, category, core, recent) {
	const target = 6
	const source = raw && typeof raw === 'object' && raw.item ? raw.item : raw
	const verdict = validateItem({ ...source, difficulty: target, tags: ['tense'] }, { targetDifficulty: target, recent })
	if (!verdict.ok) return verdict
	const content = contentWordsOf(verdict.item.en, category, core)
	const outside = content.filter((word) => !inWordSet(word, category.wordSet))
	if (content.length > 0 && outside.length / content.length > 0.2) {
		return { ok: false, errors: [`out-of-set:${outside.join(',')}`] }
	}
	if (!category.keywords.some((keyword) => verdict.item.en.toLowerCase().includes(keyword))) {
		return { ok: false, errors: ['off-topic'] }
	}
	return { ok: true, item: await glossWithDictionary(verdict.item), errors: [] }
}

/**
 * The profile of one category's practice.
 * @param {object} stored - stored state.
 * @param {string} tag - category id.
 * @returns {object} category state.
 */
export function categoryState(stored, tag) {
	if (!stored.categories[tag]) {
		stored.categories[tag] = {
			practiced: 0,
			combo: 0,
			bestCombo: 0,
			functions: {},
			words: {},
			pending: [],
			recent: [],
			recentIds: [],
			results: [],
			current: null,
		}
	}
	return stored.categories[tag]
}

/**
 * Pick the spec for one sentence: the least practiced function, the next
 * grammar target, and a few words that are new or were answered wrong.
 * @param {object} category - category.
 * @param {object} state - category state.
 * @returns {{function: string, grammar: string, words: string[]}} spec.
 */
export function specFor(category, state) {
	const functions = [...category.functions].sort(
		(left, right) => (state.functions[left] || 0) - (state.functions[right] || 0),
	)
	const fn = functions[0] || 'request'
	const grammar = category.grammar[state.practiced % category.grammar.length]
	const scored = category.words.map((word) => {
		const stats = state.words[word] || { practiced: 0, wrong: 0 }
		// Unpracticed first, then words answered wrong, then everything else.
		const score = stats.practiced === 0 ? 0 : stats.wrong > 0 ? 1 : 2
		return { word, score, stats }
	})
	scored.sort((left, right) => left.score - right.score || Math.random() - 0.5)
	const words = scored.slice(0, FOCUS_WORDS).map((entry) => entry.word)
	return { function: fn, grammar, words }
}

/**
 * The generation prompt for one spec.
 * @param {object} category - category.
 * @param {object} spec - spec.
 * @returns {string} prompt.
 */
export function buildPrompt(category, spec) {
	const target = 6
	const functions = category.functions.join(', ')
	return [
		`你是一位英语听写题库作者。请为主题「${category.label}」（${category.goal}）写 1 道听写题。`,
		`用常用词、短句。`,
		'',
		'这一句必须满足：',
		`- 交际功能：${spec.function}（可选风格：${functions}）`,
		`- 句式/语法：${spec.grammar}`,
		`- 至少用到这些场景词里的 2 个：${spec.words.join(', ')}`,
		'',
		'场景词集（内容词只能从这里选，可加 -s/-ed/-ing 变形）：',
		category.words.join(', '),
		'',
		`句长 ${MIN_WORDS}–${MAX_WORDS} 个单词，只写一句，以 . ! 或 ? 结尾；不要数字、专有名词、引号、括号、网址、缩写；不要出现只能靠听音区分的同音词对。`,
		'',
		'输出一个 JSON 对象（不要数组、不要解释、不要代码块）：',
		'{"item":{"en":"…","zh":"…","function":"…","words":[{"text":"…","pos":"…","ipa":"…","zh":"…"}]}}',
		'words 必须把整句拆成单词，标点挂在最后一个词尾；每个词给 pos；zh 可留空（由词典与另一次选择提供）。',
	].join('\n')
}

/**
 * Pull the items out of a model reply (one object, an array, or `{items}`).
 * @param {string} text - model output.
 * @returns {object[]} candidates.
 */
export function parseCategoryItems(text) {
	const parsed = extractJson(text)
	if (Array.isArray(parsed)) return parsed
	if (!parsed || typeof parsed !== 'object') return []
	if (Array.isArray(parsed.items)) return parsed.items
	if (parsed.item && typeof parsed.item === 'object') return [parsed.item]
	return [parsed]
}

/**
 * A JSON file holding per-category practice state, written atomically.
 * @param {string} dir - storage directory.
 * @returns {object} store.
 */
export function createTagStore(dir) {
	const file = path.join(dir, 'practice.json')
	let cached = null
	const empty = () => ({ version: 1, categories: {} })
	return {
		dir,
		file,
		read() {
			if (cached !== null) return cached
			try {
				const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
				cached = parsed && typeof parsed === 'object' && parsed.categories ? parsed : empty()
			} catch (error) {
				cached = empty()
			}
			return cached
		},
		save() {
			const state = cached ?? empty()
			fs.mkdirSync(dir, { recursive: true })
			const temp = path.join(dir, `practice.json.${process.pid}.${Date.now()}.tmp`)
			fs.writeFileSync(temp, `${JSON.stringify(state, null, 1)}\n`, 'utf8')
			fs.renameSync(temp, file)
			return state
		},
	}
}

/**
 * Record one practiced sentence: per-word coverage, functions, combo, recent.
 * @param {object} state - category state.
 * @param {object} item - the practiced item.
 * @param {string} result - perfect | great | pass | reveal.
 * @param {string[]} attempted - words the learner typed (one per item word, best effort).
 * @returns {object} updated state.
 */
export function recordResult(state, item, result, attempted) {
	const words = Array.isArray(item.words) ? item.words : []
	const typedByIndex = Array.isArray(attempted) ? attempted : []
	for (const [index, word] of words.entries()) {
		const text = word && typeof word.text === 'string' ? word.text : ''
		if (text === '') continue
		const key = text.toLowerCase().replace(/[^a-z'-]/g, '')
		if (key === '') continue
		const stats = state.words[key] || { practiced: 0, wrong: 0 }
		stats.practiced += 1
		const typed = typeof typedByIndex[index] === 'string' ? typedByIndex[index] : ''
		if (result === 'reveal' || (typed !== '' && normalizeWord(typed) !== normalizeWord(text))) stats.wrong += 1
		state.words[key] = stats
	}
	const fn = item.function || 'request'
	state.functions[fn] = (state.functions[fn] || 0) + 1
	state.practiced += 1
	state.combo = result === 'perfect' || result === 'great' ? state.combo + 1 : 0
	state.bestCombo = Math.max(state.bestCombo, state.combo)
	state.results = [...state.results, result].slice(-20)
	state.current = null
	return state
}
