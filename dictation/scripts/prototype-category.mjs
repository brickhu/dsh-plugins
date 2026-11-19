/**
 * Prototype: one category word set → dictation items.
 *
 *   node scripts/prototype-category.mjs prompt cafe 10      # print the model prompt
 *   node scripts/prototype-category.mjs validate cafe f.json # validate generated items
 *
 * The prompt carries the word set; the validator is the deterministic half:
 * validateItem (the plugin's own contract) + word containment + duplication.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateItem } from '../lib/rules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const categories = JSON.parse(fs.readFileSync(path.join(root, 'data', 'categories.json'), 'utf8')).categories
const core = JSON.parse(fs.readFileSync(path.join(root, 'data', 'core-words.json'), 'utf8')).words
const LEVEL_SCORE = { A1: 2, A2: 4, B1: 6, B2: 8, C1: 10, C2: 12 }

const normalize = (word) => String(word).toLowerCase().replace(/[^a-z' -]/g, '').trim()
const coreSet = new Set(core.map(normalize))
const IRREGULAR = new Map(Object.entries({
	paid: 'pay', bought: 'buy', made: 'make', took: 'take', got: 'get', went: 'go', said: 'say',
	told: 'tell', left: 'leave', brought: 'bring', felt: 'feel', kept: 'keep', drank: 'drink',
	ate: 'eat', slept: 'sleep', found: 'find', heard: 'hear', met: 'meet', lost: 'lose',
	sent: 'send', spent: 'spend', broke: 'break', fell: 'fall', flew: 'fly', forgot: 'forget',
	grew: 'grow', spoke: 'speak', gave: 'give', saw: 'see', came: 'come', ran: 'run', wrote: 'write',
	stood: 'stand', sat: 'sit', held: 'hold', hung: 'hang', built: 'build', chose: 'choose',
}))

/** Is this word a member of `set`, allowing inflection and irregular past forms? */
function inWordSet(word, set) {
	const w = normalize(word)
	if (w === '') return true
	if (set.has(w)) return true
	if (IRREGULAR.has(w) && (set.has(IRREGULAR.get(w)) || set.has(`${IRREGULAR.get(w)}e`))) return true
	for (const suffix of ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'est']) {
		if (!w.endsWith(suffix) || w.length <= suffix.length + 2) continue
		const stem = w.slice(0, -suffix.length)
		if (set.has(stem) || set.has(`${stem}e`)) return true
		if (IRREGULAR.has(stem) && set.has(IRREGULAR.get(stem))) return true
	}
	return false
}

/** Content words of a sentence: everything that is not a core (function) word. */
function contentWords(text) {
	const words = String(text).toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(Boolean)
	return words.filter((word) => !inWordSet(word, coreSet))
}

/** Is this content word (or phrase) inside the category's set? */
function inSet(word, set) {
	return inWordSet(word, set)
}

/**
 * Content words of a sentence with multiword collocations removed (they are
 * themselves set entries, so their parts must not be judged alone).
 * @param {string} text - sentence.
 * @param {string[]} collocations - multiword entries of the set.
 * @returns {string[]} remaining content words.
 */
function contentWordsWithCollocations(text, collocations) {
	let rest = ` ${String(text).toLowerCase().replace(/[^a-z' -]/g, ' ')} `
	for (const phrase of [...collocations, ...core.filter((word) => word.includes(' '))]) {
		rest = rest.split(` ${phrase} `).join(' ')
	}
	return contentWords(rest)
}

function bigrams(text) {
	const words = String(text).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean)
	const out = new Set()
	for (let i = 0; i < words.length - 1; i += 1) out.add(`${words[i]} ${words[i + 1]}`)
	return out
}

function jaccard(a, b) {
	if (a.size === 0 || b.size === 0) return 0
	let inter = 0
	for (const gram of a) if (b.has(gram)) inter += 1
	return inter / (a.size + b.size - inter)
}

function prompt(category, count) {
	const target = LEVEL_SCORE[category.level] || 6
	const words = category.words.join(', ')
	return [
		`你是一位英语听写题库作者。请为主题「${category.label}」（${category.goal}）写 ${count} 道听写题。`,
		`难度：${category.level}（插件难度分 ${target}/12）。学习者已自评该档，句子必须落在这个水平：常用词、短句、无生僻词。`,
		'',
		`场景词集（内容词只能从这里选，可以加 -s/-ed/-ing 等变形；可以自由使用介词、代词、冠词、情态动词等功能词）：`,
		words,
		'',
		'另外这些功能词与常用词永远允许，不计数：',
		core.join(', '),
		'',
		`本句的交际功能从这些里轮换，每个至少出现一次：${category.functions.join(', ')}。`,
		`句式要变化，轮换使用：${category.grammar.join('、')}。`,
		'',
		'硬性要求：',
		'- 每句 5–10 个单词，只写一句，以 . ! 或 ? 结尾；',
		'- 不要出现数字、专有名词（人名/地名/品牌/星期/月份）、引号、括号、斜杠、网址、缩写；',
		'- 不要出现只能靠听音区分的同音词对（there/their、to/too 等）；',
		'- 每句必须包含至少 1 个场景词集里的内容词；',
		'- 10 句之间不要重复句式：前三个词不能相同，不要连续两句用同一个开头。',
		'',
		'输出一个 JSON 数组，每个元素：',
		'{"en":"…","zh":"…","function":"request","words":[{"text":"…","pos":"…","ipa":"…","zh":"…"}]}',
		'words 必须把整句拆成单词（标点挂在最后一个词尾），每个词给 pos（pron/verb/noun/adj/adv/prep/conj/det/num/interj/other）、简短中文 zh（必须给）、ipa 可省略。',
		'只输出 JSON 数组，不要解释、不要代码块。',
	].join('\n')
}

function report(category, file) {
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
	const items = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : []
	const target = LEVEL_SCORE[category.level] || 6
	const set = new Set(category.words.map(normalize))
	const rows = []
	for (const [index, item] of items.entries()) {
		const errors = []
		const en = typeof item.en === 'string' ? item.en : ''
		const words = Array.isArray(item.words) ? item.words : []
		const verdict = validateItem({ en, zh: item.zh || '占位', words, difficulty: item.difficulty || target, tags: ['tense'] }, {
			allowDuplicate: true,
			targetDifficulty: target,
		})
		if (!verdict.ok) errors.push(...verdict.errors)
		const collocations = category.words.map(normalize).filter((word) => word.includes(' '))
		const content = contentWordsWithCollocations(en, collocations)
		const outside = content.filter((word) => !inSet(word, set))
		if (content.length > 0 && outside.length / content.length > 0.2) errors.push(`out-of-set:${outside.join(',')}`)
		rows.push({ index: index + 1, en, zh: item.zh, function: item.function, words: en.split(/\s+/).filter(Boolean).length, content: content.length, outside, errors })
	}
	// Duplication across items.
	let maxPair = { value: 0, pair: [] }
	let openingDup = []
	const seenOpenings = new Map()
	for (let i = 0; i < rows.length; i += 1) {
		const opening = rows[i].en.toLowerCase().split(/\s+/).slice(0, 3).join(' ')
		if (seenOpenings.has(opening)) openingDup.push([seenOpenings.get(opening), i + 1])
		else seenOpenings.set(opening, i + 1)
		for (let j = i + 1; j < rows.length; j += 1) {
			const value = jaccard(bigrams(rows[i].en), bigrams(rows[j].en))
			if (value > maxPair.value) maxPair = { value, pair: [i + 1, j + 1] }
		}
	}
	const failed = rows.filter((row) => row.errors.length > 0)
	const features = rows.map((row) => row.function).filter(Boolean)
	const counts = features.reduce((map, fn) => ({ ...map, [fn]: (map[fn] || 0) + 1 }), {})
	console.log(`\n== ${category.label} (${category.level})  ${rows.length} 句`)
	console.log(`通过: ${rows.length - failed.length}/${rows.length}  最大句间相似度: ${maxPair.value.toFixed(2)} (第 ${maxPair.pair.join(' & ')} 句)  开头重复: ${openingDup.length ? JSON.stringify(openingDup) : '无'}`)
	console.log('功能分布:', JSON.stringify(counts))
	for (const row of rows) {
		const mark = row.errors.length > 0 ? '✗' : '✓'
		console.log(`  ${mark} [${String(row.words).padStart(2)}w] ${row.en}`)
		if (row.errors.length > 0) console.log(`      原因: ${row.errors.join(' | ')}${row.outside.length ? ` | 集外词: ${row.outside.join(',')}` : ''}`)
	}
}

const [mode, id, extra] = process.argv.slice(2)
const category = categories.find((entry) => entry.id === id)
if (!category) {
	console.error(`unknown category: ${id} (available: ${categories.map((entry) => entry.id).join(', ')})`)
	process.exit(1)
}
if (mode === 'prompt') console.log(prompt(category, Number(extra) || 10))
else if (mode === 'validate') report(category, extra)
else {
	console.error('usage: prototype-category.mjs prompt <id> <count> | validate <id> <file>')
	process.exit(1)
}
