/**
 * Offline checks for dsh-english-dictation.
 *
 * Three layers, no DSH process and no browser:
 *
 *   1. `lib/rules.js` — scoring, combo, theta, grading, validation, report
 *      sanitizing, streak math.
 *   2. `lib/store.js` — atomic write, corrupt-file recovery.
 *   3. `lib/client.js` loaded in a VM with a fake React — the browser-side copy of
 *      the rules is cross-checked against the Host copy, the typing engine is
 *      driven keystroke by keystroke, and the TTS wrapper's three branches are
 *      exercised with a fake synthesiser.
 *
 * The Host routes are also driven end to end with a fake `ctx` and a fake model,
 * because "one click writes one sentence, and nothing before it" is a behaviour,
 * not a unit.
 *
 *   node test/run.mjs
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

// The Host creates its store lazily, so pointing the env at a temp directory
// before `apply` is enough.
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-test-'))
process.env.DSH_DICTATION_STORAGE = storageDir
// The corpus client talks to Tatoeba; the offline suite must not need a network.
process.env.DSH_DICTATION_CORPUS = 'off'
// The built-in first practice would alter every empty-book assertion.
process.env.DSH_DICTATION_SEED = 'off'

const rules = await import('../lib/rules.js')
const prompts = await import('../lib/prompts.js')
const storeModule = await import('../lib/store.js')
const host = await import('../lib/index.js')
const localTts = await import('../lib/local-tts.js')
const edgeTts = await import('../lib/edge-tts.js')
const article = await import('../lib/article.js')
const rss = await import('../lib/rss.js')
const sourcesModule = await import('../lib/sources.js')
const rewrite = await import('../lib/rewrite.js')
const generateModule = await import('../lib/generate.js')
const faviconModule = await import('../lib/favicon.js')
const feedModule = await import('../lib/feed.js')
const firstPractice = await import('../lib/first-practice.js')
const archiveModule = await import('../lib/archive.js')
const scoreModule = await import('../lib/score.js')

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

let checks = 0
/** Values created inside the VM have another realm's prototypes; compare data. */
function plain(value) {
	return JSON.parse(JSON.stringify(value))
}
function check(fn) {
	fn()
	checks += 1
}

/* ═══════════════════════ 1. scoring, combo, grading ═══════════════════════ */

check(() => {
	assert.equal(rules.resultOf({ revealed: true, hadError: true, usedBackspace: true }), 'reveal')
	assert.equal(rules.resultOf({ hadError: true }), 'pass')
	assert.equal(rules.resultOf({ usedBackspace: true }), 'great')
	assert.equal(rules.resultOf({}), 'perfect')
})

check(() => {
	// The documented multiplier table, boundary by boundary.
	const table = [
		[0, 1], [1, 1], [2, 1],
		[3, 1.1], [4, 1.1],
		[5, 1.2], [6, 1.2],
		[7, 1.3], [9, 1.3],
		[10, 1.5], [14, 1.5],
		[15, 1.8], [19, 1.8],
		[20, 2], [40, 2],
	]
	for (const [combo, expected] of table) assert.equal(rules.multiplier(combo), expected, `multiplier(${combo})`)
})

check(() => {
	// Sentence points = base × f(combo before).
	assert.equal(rules.sentenceScore('perfect', 0), 100)
	assert.equal(rules.sentenceScore('perfect', 3), 110)
	assert.equal(rules.sentenceScore('perfect', 7), 130)
	assert.equal(rules.sentenceScore('perfect', 20), 200)
	assert.equal(rules.sentenceScore('great', 0), 70)
	assert.equal(rules.sentenceScore('great', 10), 105)
	assert.equal(rules.sentenceScore('pass', 15), 72)
	assert.equal(rules.sentenceScore('reveal', 20), 0)
	assert.equal(rules.sentenceScore('nonsense', 20), 0)
})

check(() => {
	assert.equal(rules.nextCombo(0, 'perfect'), 1)
	assert.equal(rules.nextCombo(6, 'great'), 7)
	assert.equal(rules.nextCombo(6, 'pass'), 0)
	assert.equal(rules.nextCombo(6, 'reveal'), 0)
})

check(() => {
	// Rolling grade: empty, small sample flagged, thresholds, window of 10.
	const empty = rules.rollingGrade([])
	assert.equal(empty.grade, 'C')
	assert.equal(empty.sample, 0)
	assert.equal(empty.low, true)

	const small = rules.rollingGrade(['perfect', 'perfect', 'great'])
	assert.equal(small.low, true)
	assert.equal(small.sample, 3)
	assert.equal(small.grade, 'SS')

	const thresholds = [
		[['perfect'], 'SSS'],
		[['perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'great'], 'SS'],
		[['perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'great'], 'S'],
		[['perfect', 'perfect', 'perfect', 'great', 'great'], 'A'],
		[['perfect', 'great', 'pass', 'pass'], 'B'],
		[['pas', 'reveal'], 'C'],
		[['pass', 'reveal'], 'C'],
	]
	// `S` needs 0.85 and above: 7 perfect + 1 great = 0.9625 → SSS, so check a
	// true 0.85 case explicitly.
	assert.equal(rules.gradeOfRate(0.85), 'S')
	assert.equal(rules.gradeOfRate(0.849), 'A')
	assert.equal(rules.gradeOfRate(0.95), 'SSS')
	assert.equal(rules.gradeOfRate(0.9), 'SS')
	assert.equal(rules.gradeOfRate(0.75), 'A')
	assert.equal(rules.gradeOfRate(0.6), 'B')
	assert.equal(rules.gradeOfRate(0.599), 'C')
	void thresholds

	const windowed = rules.rollingGrade([
		'reveal', 'reveal', 'reveal', 'reveal', 'reveal',
		'perfect', 'perfect', 'perfect', 'perfect', 'perfect',
		'perfect', 'perfect', 'perfect', 'perfect', 'perfect',
	])
	assert.equal(windowed.sample, 10, 'only the last ten sentences count')
	assert.equal(windowed.grade, 'SSS', 'the first five reveals must fall out of the window')
})

check(() => {
	// Theta moves the right way and stays inside [1,12].
	const easier = rules.thetaNext(6, 3, 'perfect')
	assert.ok(easier > 6, 'a correct easy sentence raises theta')
	const harder = rules.thetaNext(6, 11, 'reveal')
	assert.ok(harder < 6, 'a failed hard sentence lowers theta')
	assert.equal(rules.thetaNext(1, 12, 'reveal'), 1, 'theta is clamped at the floor')
	assert.equal(rules.thetaNext(12, 1, 'perfect'), 12, 'theta is clamped at the ceiling')
	assert.equal(rules.thetaNext(6, 6, 'pass'), rules.thetaNext(6, 6, 'pass'))
})

check(() => {
	assert.ok(Math.abs(rules.tagMasteryNext(0.5, 'perfect') - 0.65) < 1e-12)
	assert.ok(Math.abs(rules.tagMasteryNext(0.5, 'reveal') - 0.35) < 1e-12)
	assert.equal(rules.thetaOfBand('C1'), 10)
	assert.equal(rules.thetaOfBand('nope'), 6)
	assert.equal(rules.bandOfTheta(3), 'A2')
	assert.equal(rules.bandOfTheta(6), 'B1')
	assert.equal(rules.bandOfTheta(8.5), 'B2')
	assert.equal(rules.bandOfTheta(11), 'C1')
	assert.equal(rules.clamp(15, 1, 12), 12)
	assert.equal(rules.clamp(Number.NaN, 1, 12), 1)
})

check(() => {
	// Every fourth sentence is the forced challenge.
	assert.equal(rules.isChallengeTurn(0), false)
	assert.equal(rules.isChallengeTurn(3), true)
	assert.equal(rules.isChallengeTurn(4), false)
	assert.equal(rules.targetDifficulty(6, 0), 6)
	assert.equal(rules.targetDifficulty(6, 3), 7)
	assert.equal(rules.targetDifficulty(12, 3), 12, 'challenge difficulty is clamped')
})

/* ═══════════════════════ 2. item validation ═══════════════════════ */

/**
 * Hand-written fixtures for the validator. The plugin ships no sentence bank:
 * every sentence it asks comes from the model at that moment, so the tests build
 * their own examples instead of validating a packaged list.
 */
const fixtures = [
	{ en: 'I drink a glass of water every morning.', zh: '我每天早上喝一杯水。', words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text, pos: 'other' })), difficulty: 4, tags: ['tense'] },
	{ en: 'She usually walks to work when the weather is nice.', zh: '天气好的时候她通常走路去上班。', words: 'She usually walks to work when the weather is nice.'.split(' ').map((text) => ({ text, pos: 'other' })), difficulty: 5.5, tags: ['tense'] },
	{ en: 'We are planning to visit our grandparents next weekend.', zh: '我们打算下周末去看望祖父母。', words: 'We are planning to visit our grandparents next weekend.'.split(' ').map((text) => ({ text, pos: 'other' })), difficulty: 6, tags: ['tense'] },
	{ en: 'He forgot to bring his umbrella to the office.', zh: '他忘了把伞带到办公室。', words: 'He forgot to bring his umbrella to the office.'.split(' ').map((text) => ({ text, pos: 'other' })), difficulty: 5, tags: ['articles'] },
	{ en: 'The children were playing in the garden all afternoon.', zh: '孩子们整个下午都在花园里玩。', words: 'The children were playing in the garden all afternoon.'.split(' ').map((text) => ({ text, pos: 'other' })), difficulty: 5.5, tags: ['tense'] },
]

check(() => {
	assert.ok(Array.isArray(fixtures))
	assert.equal(fixtures.length, 5)
	const ids = new Set()
	for (const raw of fixtures) {
		const verdict = rules.validateItem(raw, { allowDuplicate: true })
		assert.ok(verdict.ok, `${raw.en} should validate: ${verdict.errors.join(',')}`)
		assert.equal(rules.joinWords(verdict.item.words), verdict.item.en, 'words join back to en')
		assert.ok(verdict.item.words.length >= 5 && verdict.item.words.length <= 10)
		assert.ok(verdict.item.tags.length > 0)
		assert.ok(verdict.item.zh !== '')
		for (const word of verdict.item.words) assert.ok(rules.normalizeWord(word.text).length > 0)
		ids.add(verdict.item.id)
	}
	assert.equal(ids.size, fixtures.length, 'sentence ids are distinct')
})

check(() => {
	const base = {
		en: 'I drink a glass of water every morning.',
		zh: '我每天早上喝一杯水。',
		words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text, pos: 'other' })),
		difficulty: 4,
		tags: ['tense'],
	}
	assert.ok(rules.validateItem(base, { allowDuplicate: true }).ok, 'baseline item is valid')

	const joinMismatch = { ...base, words: base.words.slice(0, -1) }
	const mismatch = rules.validateItem(joinMismatch, { allowDuplicate: true })
	assert.equal(mismatch.ok, false)
	assert.ok(mismatch.errors.includes('words-do-not-join-en'))

	const digits = { ...base, en: 'I drink 2 glasses of water every morning.', words: 'I drink 2 glasses of water every morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(digits, { allowDuplicate: true }).ok, false)

	const quoted = { ...base, en: 'I said "hello" to the teacher this morning.', words: 'I said "hello" to the teacher this morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(quoted, { allowDuplicate: true }).ok, false)

	const proper = { ...base, en: 'I met Sarah at the library yesterday afternoon.', words: 'I met Sarah at the library yesterday afternoon.'.split(' ').map((text) => ({ text })) }
	const properVerdict = rules.validateItem(proper, { allowDuplicate: true })
	assert.equal(properVerdict.ok, false)
	assert.ok(properVerdict.errors.some((error) => error.startsWith('proper-noun')))

	const short = { ...base, en: 'I drink water.', words: 'I drink water.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(short, { allowDuplicate: true }).ok, false)

	const offTarget = rules.validateItem(base, { allowDuplicate: true, targetDifficulty: 10 })
	assert.equal(offTarget.ok, false)
	assert.ok(offTarget.errors.includes('difficulty-off-target'))

	const unknownTags = rules.validateItem({ ...base, tags: ['present_simple'] }, { allowDuplicate: true })
	assert.equal(unknownTags.ok, false)
	assert.ok(unknownTags.errors.includes('missing-tags'))

	const noZh = rules.validateItem({ ...base, zh: '  ' }, { allowDuplicate: true })
	assert.equal(noZh.ok, false)

	const duplicate = rules.validateItem(base, { allowDuplicate: false, recent: ['I drink a glass of water every morning.'] })
	assert.equal(duplicate.ok, false)
	assert.ok(duplicate.errors.includes('duplicate-recent'))

})

check(() => {
	// Constituents, like the reference app: each role group is one question, and
	// every word inside it keeps its own input box.
	const tagged = (pairs) => pairs.map(([text, pos]) => ({ text, pos }))
	const no = rules.parseChunks(tagged([['No,', 'interj'], ['I', 'pron'], ['am', 'verb'], ['not', 'other'], ['the', 'det'], ['teacher.', 'noun']]))
	assert.deepEqual(no.chunks, [[0], [1], [2, 3], [4, 5]])
	assert.deepEqual(no.roles, ['adverbial', 'subject', 'predicate', 'predicative'])

	const brother = rules.parseChunks(
		tagged([
			['My', 'det'], ['brother', 'noun'], ['is', 'verb'], ['studying', 'verb'],
			['for', 'prep'], ['an', 'det'], ['exam', 'noun'],
			['in', 'prep'], ['his', 'det'], ['room.', 'noun'],
		]),
	)
	assert.deepEqual(brother.chunks, [[0, 1], [2, 3], [4, 5, 6], [7, 8, 9]])
	assert.deepEqual(brother.roles, ['subject', 'predicate', 'adverbial', 'adverbial'])

	const drink = rules.parseChunks(
		tagged([
			['I', 'pron'], ['drink', 'verb'], ['a', 'det'], ['glass', 'noun'],
			['of', 'prep'], ['water', 'noun'], ['every', 'det'], ['morning.', 'noun'],
		]),
	)
	assert.deepEqual(drink.chunks, [[0], [1], [2, 3], [4, 5], [6, 7]])
	assert.deepEqual(drink.roles, ['subject', 'predicate', 'object', 'adverbial', 'adverbial'])

	// Roles may be Chinese or English keys.
	assert.equal(rules.roleOf('主语'), 'subject')
	assert.equal(rules.roleOf('Predicate'), 'predicate')
	assert.equal(rules.roleOf('nonsense'), '')

	// The model's parse is used when it is valid, otherwise the rule parses.
	const modelParse = { chunks: [[0, 1], [2, 3], [4]], roles: ['主语', '谓语', '状语'] }
	const plan = rules.planOf(modelParse.chunks, modelParse.roles, tagged([['A', 'pron'], ['b', 'noun'], ['is', 'verb'], ['x', 'verb'], ['y', 'adv']]))
	assert.deepEqual(plan.chunks, modelParse.chunks)
	assert.deepEqual(plan.roles, ['subject', 'predicate', 'adverbial'])
	assert.equal(rules.validateParse([[0, 1], [2]], ['subject', 'predicate'], 4), null, 'a parse must cover every word')
	assert.equal(rules.validateParse([[0], [1]], ['subject'], 2), null, 'one role per group')
	assert.equal(rules.validateParse([[0], [1]], ['subject', 'nonsense'], 2), null, 'unknown roles are rejected')

	// Every fixture still plans into ordered, complete constituent groups.
	for (const raw of fixtures) {
		const parsed = rules.parseChunks(raw.words)
		assert.deepEqual(
			parsed.chunks.reduce((all, group) => all.concat(group), []),
			raw.words.map((_, index) => index),
			'constituents cover every word once, in order',
		)
		assert.equal(parsed.roles.length, parsed.chunks.length)
	}
})

check(() => {
	// normalizeChunks is the legacy chunk-only validator; it still covers order.
	assert.deepEqual(rules.normalizeChunks([[0], [1, 2], [3]], 4), [[0], [1, 2], [3]])
	assert.equal(rules.normalizeChunks([[0], [0]], 2), null, 'a word may not appear twice')
	assert.equal(rules.normalizeChunks([[0, 1], [3]], 4), null, 'words may not be skipped')
	assert.equal(rules.normalizeChunks([[0], [1], [2, 3, 4, 5, 6, 7]], 8), null, 'a constituent is 1–5 words')
	assert.equal(rules.normalizeChunks([[0, 1, 2, 3, 4, 5, 6]], 7), null, 'one group for the whole sentence is not a pass')
	assert.equal(rules.normalizeChunks(null, 4), null)
	assert.deepEqual(rules.normalizeChunks([[0], [1], [2], [3]], 4), [[0], [1], [2], [3]])
})

check(() => {
	const base = {
		en: 'I drink a glass of water every morning.',
		zh: '我每天早上喝一杯水。',
		words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text, pos: 'other' })),
		difficulty: 4,
		tags: ['tense'],
	}
	assert.ok(rules.validateItem(base, { allowDuplicate: true }).ok, 'baseline item is valid')

	const joinMismatch = { ...base, words: base.words.slice(0, -1) }
	const mismatch = rules.validateItem(joinMismatch, { allowDuplicate: true })
	assert.equal(mismatch.ok, false)
	assert.ok(mismatch.errors.includes('words-do-not-join-en'))

	const digits = { ...base, en: 'I drink 2 glasses of water every morning.', words: 'I drink 2 glasses of water every morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(digits, { allowDuplicate: true }).ok, false)

	const quoted = { ...base, en: 'I said "hello" to the teacher this morning.', words: 'I said "hello" to the teacher this morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(quoted, { allowDuplicate: true }).ok, false)

	const proper = { ...base, en: 'I met Sarah at the library yesterday afternoon.', words: 'I met Sarah at the library yesterday afternoon.'.split(' ').map((text) => ({ text })) }
	const properVerdict = rules.validateItem(proper, { allowDuplicate: true })
	assert.equal(properVerdict.ok, false)
	assert.ok(properVerdict.errors.some((error) => error.startsWith('proper-noun')))

	const short = { ...base, en: 'I drink water.', words: 'I drink water.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(short, { allowDuplicate: true }).ok, false)

	const offTarget = rules.validateItem(base, { allowDuplicate: true, targetDifficulty: 10 })
	assert.equal(offTarget.ok, false)
	assert.ok(offTarget.errors.includes('difficulty-off-target'))

	const unknownTags = rules.validateItem({ ...base, tags: ['present_simple'] }, { allowDuplicate: true })
	assert.equal(unknownTags.ok, false)
	assert.ok(unknownTags.errors.includes('missing-tags'))

	const noZh = rules.validateItem({ ...base, zh: '  ' }, { allowDuplicate: true })
	assert.equal(noZh.ok, false)

	const duplicate = rules.validateItem(base, { allowDuplicate: false, recent: ['I drink a glass of water every morning.'] })
	assert.equal(duplicate.ok, false)
	assert.ok(duplicate.errors.includes('duplicate-recent'))

})

check(() => {
	const base = {
		en: 'I drink a glass of water every morning.',
		zh: '我每天早上喝一杯水。',
		words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text, pos: 'other' })),
		difficulty: 4,
		tags: ['tense'],
	}
	assert.ok(rules.validateItem(base, { allowDuplicate: true }).ok, 'baseline item is valid')

	const joinMismatch = { ...base, words: base.words.slice(0, -1) }
	const mismatch = rules.validateItem(joinMismatch, { allowDuplicate: true })
	assert.equal(mismatch.ok, false)
	assert.ok(mismatch.errors.includes('words-do-not-join-en'))

	const digits = { ...base, en: 'I drink 2 glasses of water every morning.', words: 'I drink 2 glasses of water every morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(digits, { allowDuplicate: true }).ok, false)

	const quoted = { ...base, en: 'I said "hello" to the teacher this morning.', words: 'I said "hello" to the teacher this morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(quoted, { allowDuplicate: true }).ok, false)

	const proper = { ...base, en: 'I met Sarah at the library yesterday afternoon.', words: 'I met Sarah at the library yesterday afternoon.'.split(' ').map((text) => ({ text })) }
	const properVerdict = rules.validateItem(proper, { allowDuplicate: true })
	assert.equal(properVerdict.ok, false)
	assert.ok(properVerdict.errors.some((error) => error.startsWith('proper-noun')))

	const short = { ...base, en: 'I drink water.', words: 'I drink water.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(short, { allowDuplicate: true }).ok, false)

	const offTarget = rules.validateItem(base, { allowDuplicate: true, targetDifficulty: 10 })
	assert.equal(offTarget.ok, false)
	assert.ok(offTarget.errors.includes('difficulty-off-target'))

	const unknownTags = rules.validateItem({ ...base, tags: ['present_simple'] }, { allowDuplicate: true })
	assert.equal(unknownTags.ok, false)
	assert.ok(unknownTags.errors.includes('missing-tags'))

	const noZh = rules.validateItem({ ...base, zh: '  ' }, { allowDuplicate: true })
	assert.equal(noZh.ok, false)

	const duplicate = rules.validateItem(base, { allowDuplicate: false, recent: ['I drink a glass of water every morning.'] })
	assert.equal(duplicate.ok, false)
	assert.ok(duplicate.errors.includes('duplicate-recent'))

})

check(() => {
	// Constituents, like the reference app: each role group is one question, and
	// every word inside it keeps its own input box.
	const tagged = (pairs) => pairs.map(([text, pos]) => ({ text, pos }))
	const no = rules.parseChunks(tagged([['No,', 'interj'], ['I', 'pron'], ['am', 'verb'], ['not', 'other'], ['the', 'det'], ['teacher.', 'noun']]))
	assert.deepEqual(no.chunks, [[0], [1], [2, 3], [4, 5]])
	assert.deepEqual(no.roles, ['adverbial', 'subject', 'predicate', 'predicative'])

	const brother = rules.parseChunks(
		tagged([
			['My', 'det'], ['brother', 'noun'], ['is', 'verb'], ['studying', 'verb'],
			['for', 'prep'], ['an', 'det'], ['exam', 'noun'],
			['in', 'prep'], ['his', 'det'], ['room.', 'noun'],
		]),
	)
	assert.deepEqual(brother.chunks, [[0, 1], [2, 3], [4, 5, 6], [7, 8, 9]])
	assert.deepEqual(brother.roles, ['subject', 'predicate', 'adverbial', 'adverbial'])

	const drink = rules.parseChunks(
		tagged([
			['I', 'pron'], ['drink', 'verb'], ['a', 'det'], ['glass', 'noun'],
			['of', 'prep'], ['water', 'noun'], ['every', 'det'], ['morning.', 'noun'],
		]),
	)
	assert.deepEqual(drink.chunks, [[0], [1], [2, 3], [4, 5], [6, 7]])
	assert.deepEqual(drink.roles, ['subject', 'predicate', 'object', 'adverbial', 'adverbial'])

	// Roles may be Chinese or English keys.
	assert.equal(rules.roleOf('主语'), 'subject')
	assert.equal(rules.roleOf('Predicate'), 'predicate')
	assert.equal(rules.roleOf('nonsense'), '')

	// The model's parse is used when it is valid, otherwise the rule parses.
	const modelParse = { chunks: [[0, 1], [2, 3], [4]], roles: ['主语', '谓语', '状语'] }
	const plan = rules.planOf(modelParse.chunks, modelParse.roles, tagged([['A', 'pron'], ['b', 'noun'], ['is', 'verb'], ['x', 'verb'], ['y', 'adv']]))
	assert.deepEqual(plan.chunks, modelParse.chunks)
	assert.deepEqual(plan.roles, ['subject', 'predicate', 'adverbial'])
	assert.equal(rules.validateParse([[0, 1], [2]], ['subject', 'predicate'], 4), null, 'a parse must cover every word')
	assert.equal(rules.validateParse([[0], [1]], ['subject'], 2), null, 'one role per group')
	assert.equal(rules.validateParse([[0], [1]], ['subject', 'nonsense'], 2), null, 'unknown roles are rejected')

	// Every fixture still plans into ordered, complete constituent groups.
	for (const raw of fixtures) {
		const parsed = rules.parseChunks(raw.words)
		assert.deepEqual(
			parsed.chunks.reduce((all, group) => all.concat(group), []),
			raw.words.map((_, index) => index),
			'constituents cover every word once, in order',
		)
		assert.equal(parsed.roles.length, parsed.chunks.length)
	}
})

check(() => {
	// normalizeChunks is the legacy chunk-only validator; it still covers order.
	assert.deepEqual(rules.normalizeChunks([[0], [1, 2], [3]], 4), [[0], [1, 2], [3]])
	assert.equal(rules.normalizeChunks([[0], [0]], 2), null, 'a word may not appear twice')
	assert.equal(rules.normalizeChunks([[0, 1], [3]], 4), null, 'words may not be skipped')
	assert.equal(rules.normalizeChunks([[0], [1], [2, 3, 4, 5, 6, 7]], 8), null, 'a constituent is 1–5 words')
	assert.equal(rules.normalizeChunks([[0, 1, 2, 3, 4, 5, 6]], 7), null, 'one group for the whole sentence is not a pass')
	assert.equal(rules.normalizeChunks(null, 4), null)
	assert.deepEqual(rules.normalizeChunks([[0], [1], [2], [3]], 4), [[0], [1], [2], [3]])
})

check(() => {
	const base = {
		en: 'I drink a glass of water every morning.',
		zh: '我每天早上喝一杯水。',
		words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text, pos: 'other' })),
		difficulty: 4,
		tags: ['tense'],
	}
	assert.ok(rules.validateItem(base, { allowDuplicate: true }).ok, 'baseline item is valid')

	const joinMismatch = { ...base, words: base.words.slice(0, -1) }
	const mismatch = rules.validateItem(joinMismatch, { allowDuplicate: true })
	assert.equal(mismatch.ok, false)
	assert.ok(mismatch.errors.includes('words-do-not-join-en'))

	const digits = { ...base, en: 'I drink 2 glasses of water every morning.', words: 'I drink 2 glasses of water every morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(digits, { allowDuplicate: true }).ok, false)

	const quoted = { ...base, en: 'I said "hello" to the teacher this morning.', words: 'I said "hello" to the teacher this morning.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(quoted, { allowDuplicate: true }).ok, false)

	const proper = { ...base, en: 'I met Sarah at the library yesterday afternoon.', words: 'I met Sarah at the library yesterday afternoon.'.split(' ').map((text) => ({ text })) }
	const properVerdict = rules.validateItem(proper, { allowDuplicate: true })
	assert.equal(properVerdict.ok, false)
	assert.ok(properVerdict.errors.some((error) => error.startsWith('proper-noun')))

	const short = { ...base, en: 'I drink water.', words: 'I drink water.'.split(' ').map((text) => ({ text })) }
	assert.equal(rules.validateItem(short, { allowDuplicate: true }).ok, false)

	const offTarget = rules.validateItem(base, { allowDuplicate: true, targetDifficulty: 10 })
	assert.equal(offTarget.ok, false)
	assert.ok(offTarget.errors.includes('difficulty-off-target'))

	const unknownTags = rules.validateItem({ ...base, tags: ['present_simple'] }, { allowDuplicate: true })
	assert.equal(unknownTags.ok, false)
	assert.ok(unknownTags.errors.includes('missing-tags'))

	const noZh = rules.validateItem({ ...base, zh: '  ' }, { allowDuplicate: true })
	assert.equal(noZh.ok, false)

	const duplicate = rules.validateItem(base, { allowDuplicate: false, recent: ['I drink a glass of water every morning.'] })
	assert.equal(duplicate.ok, false)
	assert.ok(duplicate.errors.includes('duplicate-recent'))

})

check(() => {
	const base = {
		en: 'I drink a glass of water every morning.',
		zh: '我每天早上喝一杯水。',
		words: 'I drink a glass of water every morning.'.split(' ').map((text) => ({ text })),
		difficulty: 4,
		tags: ['tense'],
	}
	const checked = rules.validateItem({ ...base, chunks: [[0, 1], [2, 3], [4, 5], [6], [7]] }, { allowDuplicate: true })
	assert.ok(checked.ok)
	assert.deepEqual(checked.item.chunks, rules.parseChunks(checked.item.words).chunks, 'a chunk-only proposal falls back to the rule')
	assert.equal(checked.item.roles.length, checked.item.chunks.length, 'roles travel with the chunks')
	const derived = rules.validateItem(base, { allowDuplicate: true })
	assert.ok(derived.ok)
	assert.deepEqual(derived.item.chunks, rules.parseChunks(derived.item.words).chunks, 'a missing grouping is derived')
	const repaired = rules.validateItem({ ...base, chunks: [[0], [5]] }, { allowDuplicate: true })
	assert.ok(repaired.ok)
	assert.deepEqual(repaired.item.chunks, rules.parseChunks(repaired.item.words).chunks, 'a broken grouping is replaced')
})

check(() => {
	// A stored item always gets chunks back, so the page never draws an item
	// without an input field.
	const stored = rules.normalizeStoredItem({
		id: 'abc12345',
		en: 'She likes to eat red apples every morning.',
		words: [
			{ text: 'She', pos: 'pron' }, { text: 'likes', pos: 'verb' }, { text: 'to', pos: 'prep' },
			{ text: 'eat', pos: 'verb' }, { text: 'red', pos: 'adj' }, { text: 'apples', pos: 'noun' },
			{ text: 'every', pos: 'det' }, { text: 'morning.', pos: 'noun' },
		],
		difficulty: 4,
		tags: ['tense'],
	})
	assert.deepEqual(stored.chunks, [[0], [1], [2, 3], [4, 5], [6, 7]])
	assert.equal(stored.roles.length, stored.chunks.length)
})

check(() => {
	const base = {
		en: 'He is here now today.',
		zh: '他今天在这儿。',
		words: 'He is here now today.'.split(' ').map((text) => ({ text, pos: 'pron', zh: '他', ipa: '/hiː/' })),
		difficulty: 4,
		tags: ['tense'],
	}
	const verdict = rules.validateItem(base, { allowDuplicate: true })
	assert.ok(verdict.ok)
	assert.equal(verdict.item.words[0].zh, '他', 'a per-word Chinese gloss is kept for the card')
	assert.equal(verdict.item.words[0].ipa, '/hiː/')
	const tooLong = rules.validateItem({ ...base, words: base.words.map((word) => ({ ...word, zh: '这是一段特别长的中文解释'.repeat(3) })) }, { allowDuplicate: true })
	assert.ok(tooLong.ok)
	assert.equal(tooLong.item.words[0].zh, undefined, 'an overlong gloss is dropped')
})

check(() => {
	// Trailing punctuation outside the last word is accepted and reattached.
	const en = 'She usually walks to work when the weather is nice.'
	const words = 'She usually walks to work when the weather is nice'.split(' ').map((text) => ({ text }))
	const verdict = rules.validateItem({ en, zh: 'x', words, difficulty: 5, tags: ['tense'] }, { allowDuplicate: true })
	assert.ok(verdict.ok)
	assert.equal(rules.joinWords(verdict.item.words), en)
	assert.equal(verdict.item.words.at(-1).text, 'nice.')
})

/* ═══════════════════════ 3. review sanitizing ═══════════════════════ */

check(() => {
	const answer = 'I like to eat fresh apples every morning.'
	const typed = 'I like to eat fresh eppl every morning'
	const valid = rules.sanitizeReport(
		{ report: { verdict: '不是语法问题，是 /æ/ 听成了 /e/。', detail: '你写的是 "eppl"，apple 的 a 口型更开。', action: { type: 'replay_word', word: 'apple' } } },
		{ typed, answer },
	)
	assert.ok(valid.ok)
	assert.equal(valid.dropped.length, 0)
	assert.deepEqual(valid.report.action, { type: 'replay_word', word: 'apples' }, 'the action snaps to the word in the sentence')

	const fabricated = rules.sanitizeReport(
		{ report: { verdict: '你写的是 "epple"，这是听音问题。', detail: '再听一次 "appel"。' } },
		{ typed, answer },
	)
	assert.ok(fabricated.ok)
	assert.ok(fabricated.dropped.includes('appel'), 'the invented spelling is dropped')
	assert.ok(!fabricated.report.detail.includes('appel'))

	const unknownWordAction = rules.sanitizeReport(
		{ report: { verdict: '这是听音问题。', action: { type: 'replay_word', word: 'banana' } } },
		{ typed, answer },
	)
	assert.ok(unknownWordAction.ok)
	assert.deepEqual(unknownWordAction.report.action, { type: 'none' }, 'a word outside the sentence cannot be replayed')

	const tooLong = rules.sanitizeReport({ report: { verdict: '甲'.repeat(120), detail: '乙'.repeat(200) } }, { typed, answer })
	assert.ok(tooLong.ok)
	assert.ok(rules.charLength(tooLong.report.verdict) <= 48)
	assert.ok(rules.charLength(tooLong.report.detail) <= 60)

	const empty = rules.sanitizeReport({ report: { verdict: '  ' } }, { typed, answer })
	assert.equal(empty.ok, false)
})

/* ═══════════════════════ 4. profile & store ═══════════════════════ */

check(() => {
	const profile = rules.emptyProfile()
	assert.equal(profile.version, 1)
	assert.equal(profile.theta, 6)
	assert.equal(profile.activeRun, null)
	assert.deepEqual(profile.settings, { rate: 0.95, sound: true, voiceName: '', engine: 'cloud', cloudVoice: 'stella', cefr: 'B1' })
})

check(() => {
	// The voice source is part of the profile: a saved cloud timbre survives a
	// restart, and a value an older build never wrote falls back to the default.
	const configured = rules.normalizeProfile({ settings: { engine: 'system', cloudVoice: 'tide', rate: 0.7 } })
	assert.equal(configured.settings.engine, 'system')
	assert.equal(configured.settings.cloudVoice, 'tide')
	const rejected = rules.normalizeProfile({ settings: { engine: 'nope', cloudVoice: 'aria' } })
	assert.equal(rejected.settings.engine, 'cloud', 'an unknown engine keeps the default')
	assert.equal(rejected.settings.cloudVoice, 'stella', 'only documented timbres are stored')
	const withLevel = rules.normalizeProfile({ settings: { cefr: 'C1' } })
	assert.equal(withLevel.settings.cefr, 'C1', 'the learner\'s own level is stored')
	const badLevel = rules.normalizeProfile({ settings: { cefr: 'Z9' } })
	assert.equal(badLevel.settings.cefr, 'B1', 'only the offered levels are stored')
})

check(() => {
	// A profile written by an older build may still carry the removed prefetch
	// queue and variant pool: they are read, ignored and dropped.
	const garbage = rules.normalizeProfile({
		theta: 99,
		tags: { spelling: 2, nope: 1 },
		activeRun: { id: 'r-1', results: [{ itemId: 'a', result: 'perfect' }] },
		queue: [{ id: 'x' }],
		variants: [{ id: 'y' }],
	})
	assert.equal(garbage.theta, 12)
	assert.equal(garbage.tags.spelling, 1)
	assert.equal(garbage.tags.nope, undefined)
	assert.equal(garbage.activeRun.index, 1)
	assert.equal('queue' in garbage, false, 'no prefetch queue in the profile')
	assert.equal('variants' in garbage, false, 'no variant pool in the profile')
	assert.equal(rules.normalizeProfile('nope').theta, 6)
})

{
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-store-'))
	const store = storeModule.createStore({ dir })
	const first = store.read()
	assert.equal(first.theta, 6)
	first.theta = 7.5
	await store.save()
	assert.ok(fs.existsSync(path.join(dir, 'profile.json')))
	const reread = storeModule.createStore({ dir }).read()
	assert.equal(reread.theta, 7.5, 'the write is atomic and readable')

	// A corrupt file is quarantined, not fatal.
	fs.writeFileSync(path.join(dir, 'profile.json'), '{ not json')
	const recovered = storeModule.createStore({ dir }).read()
	assert.equal(recovered.theta, 6)
	const backups = fs.readdirSync(dir).filter((entry) => entry.startsWith('profile.json.corrupt-'))
	assert.equal(backups.length, 1, 'the damaged file is kept for support')
	checks += 1
}

check(() => {
	// Day/streak math: today missing still counts yesterday's streak.
	const today = rules.dayKey(new Date(2026, 10, 12))
	const yesterday = rules.dayKey(new Date(2026, 10, 11))
	const twoDaysAgo = rules.dayKey(new Date(2026, 10, 10))
	const days = {
		[today]: { sentences: 3, minutes: 2, seconds: 120 },
		[yesterday]: { sentences: 5, minutes: 4, seconds: 240 },
		[twoDaysAgo]: { sentences: 1, minutes: 1, seconds: 60 },
	}
	assert.equal(rules.streakOf(days, today), 3)
	assert.equal(rules.streakOf({ [yesterday]: { sentences: 1 } }, today), 1)
	assert.equal(rules.streakOf({}, today), 0)
	assert.equal(rules.previousDayKey(today), yesterday)
})

/* ═══════════════════════ 5. prompts & parsing ═══════════════════════ */

check(() => {
	const parsed = prompts.extractJson('好的：\n```json\n{"item":{"en":"x"}}\n```\n以上。')
	assert.deepEqual(parsed, { item: { en: 'x' } })
	assert.deepEqual(prompts.extractJson('prefix {"a":1} suffix'), { a: 1 })
	assert.deepEqual(prompts.extractJson('[{"a":1}]'), [{ a: 1 }])
	assert.equal(prompts.extractJson('no json here'), null)
	assert.deepEqual(prompts.parseItemResponse('{"item":{"en":"x"}}'), { en: 'x' })
	assert.deepEqual(prompts.parseItemResponse('{"en":"x"}'), { en: 'x' })
	assert.equal(prompts.parseItemResponse('nope'), null)
	assert.deepEqual(prompts.parseReportResponse('{"report":{"verdict":"v"}}'), { verdict: 'v' })
})

check(() => {
	const item = prompts.buildItemPrompt({ difficulty: 6.4, asked: 3, weakTags: ['spelling', 'tense'], recent: ['A previous sentence.'], band: 'B1' })
	assert.ok(item.includes('6.4'))
	assert.ok(item.includes('spelling'))
	assert.ok(item.includes('A previous sentence.'))
	assert.ok(item.includes('5–12'))
	assert.ok(item.includes('chunks') && item.includes('roles'), 'the model is asked for the constituent parse')
	assert.ok(item.includes('base') && item.includes('form'), 'the reveal card fields are requested')
	const report = prompts.buildReportPrompt({ item: { en: 'A b c d e.', words: [{ text: 'A', pos: 'pron' }], tags: ['tense'] }, typed: 'A b c d', result: 'pass', elapsedMs: 6100, replays: 2, revealed: false, hadError: true, usedBackspace: false, theta: 6 })
	assert.ok(report.includes('A b c d e.'))
	assert.ok(report.includes('A b c d'))
	assert.ok(report.includes('过关'))

	const skippedReport = prompts.buildReportPrompt({ item: { en: 'A b c d e.', words: [] }, typed: 'A b d e', result: 'pass', elapsedMs: 1000, replays: 0, revealed: false, hadError: true, usedBackspace: false, skipped: ['c'], theta: 6 })
	assert.ok(skippedReport.includes('跳过了这些词'))
	assert.ok(skippedReport.includes('c'))
})

/* ═══════════════════════ 6. browser bundle ═══════════════════════ */

let definition = null
const sandbox = {
	window: {
		__ModuleLoader__: {
			load(value) {
				definition = value
			},
		},
	},
	document: undefined,
	console,
	setTimeout,
	clearTimeout,
	setInterval,
	clearInterval,
	Date,
	Math,
	JSON,
}
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8'), sandbox, { filename: 'lib/client.js' })

check(() => {
	assert.ok(definition, 'the bundle registers a ModuleLoader factory')
	assert.equal(definition.id, manifest.name, 'factory id equals the package name')
})


/** A React shim that survives re-renders, so clicks can be exercised offline. */
function createStatefulReact() {
	const slots = { states: [], refs: [], cursor: 0 }
	const React = {
		createElement: (...args) => ({ args }),
		Fragment: 'fragment',
		Component: FakeComponent,
		useState(initial) {
			const index = slots.cursor++
			if (!(index in slots.states)) slots.states[index] = typeof initial === 'function' ? initial() : initial
			return [
				slots.states[index],
				(next) => {
					slots.states[index] = typeof next === 'function' ? next(slots.states[index]) : next
				},
			]
		},
		useEffect() {},
		useMemo(factory) {
			return factory()
		},
		useCallback(fn) {
			return fn
		},
		useRef(value) {
			const index = slots.cursor++
			if (!(index in slots.refs)) slots.refs[index] = { current: value }
			return slots.refs[index]
		},
		useSyncExternalStore(_subscribe, getSnapshot) {
			return getSnapshot()
		},
	}
	return { React, slots, get cursor() { return slots.cursor }, set cursor(value) { slots.cursor = value } }
}

class FakeComponent {
	constructor(props) {
		this.props = props
		this.state = {}
	}
	setState(patch) {
		this.state = { ...this.state, ...(typeof patch === 'function' ? patch(this.state) : patch) }
	}
}
const React = {
	createElement: (...args) => ({ args }),
	Fragment: 'fragment',
	Component: FakeComponent,
	useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
	useEffect: () => {},
	useMemo: (factory) => factory(),
	useCallback: (fn) => fn,
	useRef: (value) => ({ current: value }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

const client = definition.factory((name) => {
	assert.equal(name, 'react', 'only react is required')
	return React
})
const clientTest = client.__test

check(() => {
	assert.equal(clientTest.VERSION, `v${manifest.version}`, 'client build stamp matches package.json')
	assert.equal(host.BUILD, `v${manifest.version}`, 'host build stamp matches package.json')
	assert.deepEqual(clientTest.API, rules.API_PREFIX, 'route prefix matches the Host')
})

check(() => {
	// The page must out-wait the Host. A page timer shorter than the Host's
	// generation budget gives up on a sentence that is written a moment later,
	// and the run it leaves behind is invisible: the symptom was "loading, then
	// back to the Dashboard".
	assert.ok(
		clientTest.NEXT_WAIT_MS > host.__test.NEXT_ITEM_BUDGET_MS,
		`the page waits ${clientTest.NEXT_WAIT_MS} ms, the Host budget is ${host.__test.NEXT_ITEM_BUDGET_MS} ms`,
	)
	// And a failed next sentence must not navigate: the retry lives on the
	// loading screen, so the practice flow is never left by an error path.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const start = source.indexOf('const handleContinue = useCallback(')
	const end = source.indexOf('const handleExit = useCallback(', start)
	assert.ok(start > 0 && end > start, 'handleContinue is findable')
	const body = source.slice(start, end)
	assert.ok(!body.includes("setView('dashboard')"), 'handleContinue never returns to the Dashboard')
	assert.ok(body.includes('setGenerateError('), 'a failed generation stays on the loading screen with a reason')
	// A lost response is recovered from the Host; only a real answer is reported.
	assert.ok(body.includes('isTransportFailure(error)') && body.includes('recoverFromHost'), 'a lost response is recovered first')
})

check(() => {
	// The panel is unmounted when the sidebar switches tab, so the practice screen
	// has to live outside React: otherwise the sentence, the typed words and the
	// verdict are all thrown away by a tab switch.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('let pageMemory = null'), 'the page keeps its place outside React')
	assert.ok(source.includes('let practiceDraft = null'), 'the practice screen keeps its state outside React')
	assert.ok(
		source.includes("pageMemory && pageMemory.view === 'practice'"),
		'a remount resumes the practice screen instead of the loading screen',
	)
	assert.ok(source.includes('practiceDraft && practiceDraft.itemId === item.id'), 'the draft belongs to exactly one sentence')
	assert.ok(source.includes('typeof resume.phase === \'string\' ? resume.phase'), 'the exact screen phase is restored')
	assert.ok(source.includes('practiceDraft = null'), 'a new sentence clears the old draft')
})

check(() => {
	// A resumed question puts the caret on the first empty box.
	assert.equal(clientTest.resumeFocusIndex([]), 0)
	assert.equal(clientTest.resumeFocusIndex(undefined), 0)
	assert.equal(clientTest.resumeFocusIndex(['I', '', 'apples']), 1)
	assert.equal(clientTest.resumeFocusIndex(['I', 'like']), 1)
	assert.equal(clientTest.resumeFocusIndex(['']), 0)
})

check(() => {
	// The error card's detail line says where it failed and what came back: one
	// screenshot then tells a lost response from a Host-side refusal.
	assert.equal(clientTest.errorDetailText('run/next', new TypeError('Failed to fetch')), 'run/next · TypeError · no response')
	assert.equal(
		clientTest.errorDetailText('run/next', Object.assign(new Error('x'), { status: 500, code: 'internal' })),
		'run/next · Error · internal · HTTP 500',
	)
	assert.equal(clientTest.errorDetailText('run/start', {}), 'run/start · no response')
})

check(() => {
	// A lost response carries no status at all; every HTTP answer carries one.
	assert.equal(clientTest.isTransportFailure(new TypeError('Failed to fetch')), true)
	assert.equal(clientTest.isTransportFailure(Object.assign(new Error('x'), { status: 500, code: 'internal' })), false)
	assert.equal(clientTest.isTransportFailure(Object.assign(new Error('x'), { status: 409, code: 'stale-item' })), false)
	assert.equal(clientTest.isTransportFailure(null), true)
})

check(() => {
	const words = [
		{ raw: 'She', plain: 'she', pos: 'pron' }, { raw: 'likes', plain: 'likes', pos: 'verb' },
		{ raw: 'to', plain: 'to', pos: 'prep' }, { raw: 'eat', plain: 'eat', pos: 'verb' },
		{ raw: 'red', plain: 'red', pos: 'adj' }, { raw: 'apples', plain: 'apples', pos: 'noun' },
		{ raw: 'every', plain: 'every', pos: 'det' }, { raw: 'morning', plain: 'morning', pos: 'noun' },
	]
	assert.deepEqual(
		plain(clientTest.wordChunksOf({ chunks: [[0], [1], [2, 3], [4], [5], [6], [7]], roles: ['subject', 'predicate', 'object', 'object', 'object', 'adverbial', 'adverbial'] }, words)),
		[[0], [1], [2, 3], [4], [5], [6], [7]],
	)
	// The grammar rule owns the grouping; a model grouping in the item is ignored.
	const byRule = [[0], [1], [2, 3], [4, 5], [6, 7]]
	assert.deepEqual(plain(clientTest.wordChunksOf({}, words)), byRule)
	assert.deepEqual(plain(clientTest.wordChunksOf({ chunks: [[0, 1], [2, 3, 4, 5, 6, 7]] }, words)), byRule)
	// The browser copy matches the Host copy.
	assert.deepEqual(
		plain(clientTest.parseChunks([{ text: 'my', pos: 'det' }, { text: 'brother', pos: 'noun' }, { text: 'is', pos: 'verb' }, { text: 'studying', pos: 'verb' }])),
		plain(rules.parseChunks([{ text: 'my', pos: 'det' }, { text: 'brother', pos: 'noun' }, { text: 'is', pos: 'verb' }, { text: 'studying', pos: 'verb' }])),
		'the browser copy matches the Host copy',
	)
})

check(() => {
	// The practice screens: one per phrase, then the whole sentence.
	const steps = plain(clientTest.buildSteps([[0], [1], [2, 3], [4], [5], [6], [7]], 8))
	assert.deepEqual(steps.slice(0, -1), [
		{ kind: 'chunk', indexes: [0] },
		{ kind: 'chunk', indexes: [1] },
		{ kind: 'chunk', indexes: [2, 3] },
		{ kind: 'chunk', indexes: [4] },
		{ kind: 'chunk', indexes: [5] },
		{ kind: 'chunk', indexes: [6] },
		{ kind: 'chunk', indexes: [7] },
	])
	assert.deepEqual(steps.at(-1), { kind: 'sentence', indexes: [0, 1, 2, 3, 4, 5, 6, 7] })
	for (const step of steps) assert.ok(step.indexes.length > 0)
	// Without chunks the sentence is still the last screen.
	assert.deepEqual(plain(clientTest.buildSteps([], 3)), [{ kind: 'sentence', indexes: [0, 1, 2] }])
})

check(() => {
	// The two dictionaries must stay in sync.
	const zh = Object.keys(clientTest.LOCALE_ZH).sort()
	const en = Object.keys(clientTest.LOCALE_EN).sort()
	assert.deepEqual(zh, en, 'zh and en locale keys match')
	assert.equal(clientTest.LOCALE_ZH['menu.label'], '英文听写')
	assert.equal(clientTest.LOCALE_EN['menu.label'], 'English Dictation')
})

check(() => {
	// Cross-check the browser copy of the rules against lib/rules.js.
	for (let combo = 0; combo <= 30; combo += 1) {
		assert.equal(clientTest.multiplier(combo), rules.multiplier(combo), `multiplier(${combo})`)
		for (const result of ['perfect', 'great', 'pass', 'reveal']) {
			assert.equal(clientTest.sentenceScore(result, combo), rules.sentenceScore(result, combo), `score(${result},${combo})`)
			assert.equal(clientTest.rateOf(result), rules.rateOf(result))
			assert.equal(clientTest.outcomeOf(result), rules.outcomeOf(result))
		}
		assert.equal(clientTest.nextCombo(combo, 'perfect'), rules.nextCombo(combo, 'perfect'))
		assert.equal(clientTest.nextCombo(combo, 'pass'), rules.nextCombo(combo, 'pass'))
	}
	for (const result of ['perfect', 'great', 'pass', 'reveal', 'unknown']) {
		assert.equal(clientTest.resultOf({ revealed: result === 'reveal', hadError: result === 'pass', usedBackspace: result === 'great' }), rules.resultOf({ revealed: result === 'reveal', hadError: result === 'pass', usedBackspace: result === 'great' }))
	}
	const sequences = [
		[],
		['perfect'],
		['perfect', 'great'],
		['reveal', 'reveal', 'reveal', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect', 'perfect'],
		['pass', 'great', 'pass', 'great', 'perfect'],
	]
	for (const sequence of sequences) {
		assert.deepEqual(plain(clientTest.rollingGrade(sequence)), rules.rollingGrade(sequence), `grade(${sequence.length})`)
	}
	for (let step = 0; step <= 100; step += 1) {
		const rate = step / 100
		assert.equal(clientTest.gradeOfRate(rate), rules.gradeOfRate(rate), `gradeOfRate(${rate})`)
	}
})

check(() => {
	// Each word box is checked on its own; an empty box is wrong.
	assert.deepEqual(plain(clientTest.wrongWordFlags(['he', 'is', 'teacher'], ['he', 'is', 'teacher'])), [false, false, false])
	assert.deepEqual(plain(clientTest.wrongWordFlags(['he', '', 'teecher'], ['he', 'is', 'teacher'])), [false, true, true])
	assert.deepEqual(plain(clientTest.wrongWordFlags(['HE', 'Is', "don’t"], ['he', 'is', "don't"])), [false, false, false])
	assert.deepEqual(plain(clientTest.wrongWordFlags([], ['he'])), [true])
})

check(() => {
	// One underline per word, as long as the word's letters; the field spans the
	// letters plus the spaces between words. "to work" draws two lines.
	assert.deepEqual(plain(clientTest.underlineLayout(['to', 'work'])), { counts: [2, 4], total: 7 })
	assert.deepEqual(plain(clientTest.underlineLayout(['I', 'like', 'apples'])), { counts: [1, 4, 6], total: 13 })
	assert.deepEqual(plain(clientTest.underlineLayout(['He'])), { counts: [2], total: 4 })
	assert.deepEqual(plain(clientTest.underlineLayout([])), { counts: [], total: 4 })
	assert.deepEqual(plain(clientTest.underlineLayout(['a', 'b'])), { counts: [1, 1], total: 4 })
})

check(() => {
	// The boxes size themselves in `ch`. That only holds if the font is
	// monospaced, so the article screen must not reset it to `inherit`.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;'), 'word boxes use a monospace font')
	assert.ok(!source.includes("gap: 'calc(4px + 0.8em) 16px', fontFamily: 'inherit'"), 'the article boxes do not override it back')
	assert.ok(source.includes("fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'"), 'the input names the same monospace stack')
	assert.ok(source.includes('border-bottom: 2px solid transparent;') && source.includes('padding: 2px 0 8px;'), 'given words use the same line box as inputs')
	assert.ok(source.includes('.dsh-de-result-chip,\n.dsh-de-result-punct,\n.dsh-de-result-given {'), 'result word chips inherit the same monospace font')
	checks += 1
})

check(() => {
	// The answer is checked only on submit: spaces optional, case ignored.
	assert.equal(clientTest.matchesTarget('toeat', 'to eat'), true)
	assert.equal(clientTest.matchesTarget('to eat', 'to eat'), true)
	assert.equal(clientTest.matchesTarget('To Eat', 'to eat'), true)
	assert.equal(clientTest.matchesTarget('to  eat', 'to eat'), true)
	assert.equal(clientTest.matchesTarget('to eatt', 'to eat'), false)
	assert.equal(clientTest.matchesTarget('tx eat', 'to eat'), false)
	assert.equal(clientTest.matchesTarget('', 'to eat'), false)
	assert.equal(clientTest.matchesTarget("don’t", "don't"), true, 'a curly apostrophe compares equal')
})

check(() => {
	// The only document-level key listener is the result screen's Enter/Tab, and
	// every single-letter comparison stays inside `shortcutOf` (Ctrl/Cmd only).
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const listeners = source.match(/addEventListener\('keydown'/g) || []
	assert.ok(listeners.length <= 9, 'document key listeners: card, reveal, announcement, word peek, article listen, article result, level dialog, voice dialog')
	assert.ok(!/\/\*\*\s*\n\s*const\s/.test(source), 'no unclosed doc comment swallows a definition')
	assert.ok(source.includes('const retryArticlePractice = useCallback('), 'the summary retry handler is real code')
	assert.ok(source.includes('cardKeyAction(event)'), 'the card listener is guarded by cardKeyAction')
	assert.ok(source.includes("key !== ' '"), 'the reveal/announcement listeners only take Enter/Space/Escape')
	const start = source.indexOf('function shortcutOf(')
	const end = source.indexOf('\n\t\t}', start)
	assert.ok(start > 0 && end > start, 'shortcutOf is findable')
	for (const match of source.matchAll(/key === '([A-Za-z])'/g)) {
		assert.ok(match.index > start && match.index < end, `bare letter branch outside shortcutOf: ${match[0]}`)
	}
})

check(() => {
	// A failed generation must not be reported as a network problem: that wording
	// sent the learner looking at their connection while the model was the reason.
	const t = (key) => clientTest.LOCALE_EN[key] || key
	assert.equal(clientTest.generateErrorText(t, { code: 'generation-failed' }), clientTest.LOCALE_EN['practice.generateFailed'])
	assert.equal(clientTest.generateErrorText(t, { code: 'no-run' }), clientTest.LOCALE_EN['practice.runEnded'])
	assert.equal(clientTest.generateErrorText(t, { code: 'no-active-run' }), clientTest.LOCALE_EN['practice.runEnded'])
	assert.equal(clientTest.generateErrorText(t, { code: 'stale-item' }), clientTest.LOCALE_EN['practice.runEnded'])
	assert.equal(clientTest.generateErrorText(t, {}), clientTest.LOCALE_EN['error.network'])
	assert.equal(clientTest.generateErrorText(t, null), clientTest.LOCALE_EN['error.network'])
})

check(() => {
	assert.equal(clientTest.formatClock(0), '00:00')
	assert.equal(clientTest.formatClock(134000), '02:14')
	assert.equal(clientTest.formatNumber(1240), '1,240')
	assert.deepEqual(clientTest.normalizeWord('Morning.'), 'morning')
	assert.deepEqual(clientTest.normalizeWord('DON’T'), "don't")
	assert.equal(clientTest.punctuationOf('morning.'), '.')
})

/* ═══════════════════════ 7. TTS branches ═══════════════════════ */

function makeSynth(voices) {
	const state = { spoken: [], cancelled: 0, listeners: new Set() }
	return {
		state,
		getVoices: () => voices,
		speak: (utterance) => state.spoken.push(utterance),
		cancel: () => {
			state.cancelled += 1
		},
		addEventListener: (name, listener) => state.listeners.add(listener),
		removeEventListener: (name, listener) => state.listeners.delete(listener),
	}
}

class FakeUtterance {
	constructor(text) {
		this.text = text
		this.rate = 1
		this.volume = 1
		this.pitch = 1
		this.lang = ''
		this.voice = null
	}
}

check(() => {
	// Branch one: no English voice. Never fail silently.
	const synth = makeSynth([{ name: 'Ting-Ting', lang: 'zh-CN' }])
	const tts = clientTest.createTts({ synth, SpeechUtterance: FakeUtterance })
	tts.init('')
	assert.equal(tts.hasEnglish(), false)
	assert.equal(tts.speak('I like apples.'), false)
	assert.equal(tts.lastError(), 'no-voice')
	assert.equal(tts.isSpeaking(), false)
})

check(() => {
	// Branch two: speaking, with the documented voice preference.
	const synth = makeSynth([
		{ name: 'Ting-Ting', lang: 'zh-CN' },
		{ name: 'Google US English', lang: 'en-US' },
		{ name: 'Alex', lang: 'en-US' },
	])
	const tts = clientTest.createTts({ synth, SpeechUtterance: FakeUtterance })
	tts.init('')
	assert.equal(tts.hasEnglish(), true)
	assert.equal(tts.voiceName(), 'Google US English', 'the preference list wins over voice order')
	assert.equal(tts.speak('I like apples.', { rate: 0.6 }), true)
	const utterance = synth.state.spoken.at(-1)
	assert.equal(utterance.text, 'I like apples.')
	assert.equal(utterance.rate, 0.6)
	assert.equal(utterance.lang, 'en-US')
	assert.equal(tts.isSpeaking(), true)
	utterance.onstart()
	assert.equal(tts.isSpeaking(), true)
	utterance.onend()
	assert.equal(tts.isSpeaking(), false)
})

check(() => {
	// Branch three: cancel. A cancelled sentence must not keep the button pulsing.
	const synth = makeSynth([{ name: 'Samantha', lang: 'en-US' }])
	const tts = clientTest.createTts({ synth, SpeechUtterance: FakeUtterance })
	tts.init('')
	tts.speak('I like apples.')
	assert.equal(tts.isSpeaking(), true)
	tts.cancel()
	assert.equal(tts.isSpeaking(), false)
	assert.ok(synth.state.cancelled >= 1)

	// A voices-changed event re-picks the voice.
	tts.__setVoices([{ name: 'Samantha', lang: 'en-US' }])
	assert.equal(tts.voiceName(), 'Samantha')
	tts.dispose()
	assert.equal(synth.state.listeners.size, 0, 'dispose removes the voiceschanged listener')
})

check(() => {
	// Branch four: the Host's local voice. The element is faked because this
	// suite runs without a DOM; what matters is the decision, the URL and the
	// rate that reaches playback — and that every failure ends on the system voice.
	const instances = []
	class FakeAudio {
		constructor() {
			this.src = ''
			this.playbackRate = 1
			this.muted = false
			this.paused = false
			instances.push(this)
		}
		play() {
			this.paused = false
			return { catch() {} }
		}
		stop() {}
		pause() {
			this.paused = true
		}
	}
	sandbox.window.Audio = FakeAudio
	try {
		const synth = makeSynth([{ name: 'Alex', lang: 'en-US' }])
		const tts = clientTest.createTts({ synth, SpeechUtterance: FakeUtterance })
		tts.init('')
		assert.equal(tts.engine(), 'cloud', 'the cloud voice is the default source')
		assert.equal(tts.cloudReady(), false, 'nothing is assumed before /tts/status answers')

		// Not ready yet: the system voice answers and no element is created.
		assert.equal(tts.speak('I like apples.', { rate: 0.9 }), true)
		assert.equal(instances.length, 0)

		tts.setCloudReady(true)
		assert.equal(tts.canSpeak(), true)
		assert.equal(tts.speak('I like apples.', { rate: 0.6 }), true)
		assert.equal(instances.length, 1)
		const element = instances[0]
		assert.ok(element.src.includes('/audio?text=I%20like%20apples.'), 'the phrase is the request')
		assert.ok(element.src.includes('voice=stella'), 'the saved timbre is asked for')
		assert.equal(element.playbackRate, 0.6, 'the rate is applied on the element, not the request')
		assert.equal(element.muted, false)
		assert.equal(tts.isSpeaking(), true)
		assert.equal(tts.pause(), true, 'Alt pauses the cloud element')
		assert.equal(element.paused, true)
		assert.equal(tts.isSpeaking(), false)
		assert.equal(tts.isPaused(), true)
		assert.equal(tts.resume(), true, 'Alt resumes the same audio')
		assert.equal(element.paused, false)
		assert.equal(tts.isSpeaking(), true)
		assert.equal(tts.isPaused(), false)
		tts.setRate(1.5)
		assert.equal(element.playbackRate, 1.5, 'the footer speed changes the active Edge audio')
		tts.setRate(1)

		tts.setCloudVoice('tide')
		tts.speak('to eat', {})
		assert.ok(element.src.includes('voice=tide'), 'the timbre switch reaches the next phrase')

		// A failed download degrades to the system voice at the same rate.
		element.onerror()
		const fallback = synth.state.spoken.at(-1)
		assert.equal(fallback.text, 'to eat')
		assert.equal(fallback.rate, 0.95)

		// Moving on cancels cloud playback without a spoken fallback.
		const before = synth.state.spoken.length
		tts.speak('Hello there.', {})
		assert.equal(element.paused, false)
		tts.cancel()
		assert.equal(element.paused, true, 'cancel stops the element')
		assert.equal(synth.state.spoken.length, before, 'cancel never speaks the abandoned phrase')

		// The system engine never touches the element.
		tts.setEngine('system')
		tts.speak('Back to the system voice.', { rate: 1.1 })
		assert.equal(instances.length, 1, 'no element is created for the system voice')
		const system = synth.state.spoken.at(-1)
		assert.equal(system.text, 'Back to the system voice.')
		assert.equal(system.rate, 1.1)
		tts.dispose()
	} finally {
		delete sandbox.window.Audio
	}
})

/* ═══════════════════════ 7a. Local macOS TTS ═══════════════════════ */

/** A WAV-shaped payload: any body above the 44-byte header counts as audio. */
function wavBytes(size) {
	const buffer = Buffer.alloc(size)
	buffer.write('RIFF', 0)
	buffer.write('WAVE', 8)
	return buffer
}

const local = await (async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-tts-'))
	const sayPath = path.join(dir, 'say')
	fs.writeFileSync(sayPath, '')
	const calls = []
	const fakeSay = (file, args, options, callback) => {
		calls.push({ file, args })
		const target = args[args.indexOf('-o') + 1]
		fs.writeFileSync(target, wavBytes(200))
		callback(null, '', '')
	}
	const service = localTts.createLocalTts({ dir, execFileImpl: fakeSay, sayPath })
	const first = await service.synthesize('to eat', 'stella')
	await service.synthesize('to eat', 'stella')
	const hit = await service.synthesize('to eat', 'stella')
	const tide = await service.synthesize('a tide phrase', 'tide')
	await service.synthesize('hello', 'nope')
	const oversize = await service.synthesize('x'.repeat(401), 'stella')
	const beforeRemove = calls.length
	await service.remove('to eat', 'stella')
	const reSynth = await service.synthesize('to eat', 'stella')
	const removedCalls = calls.length - beforeRemove
	let failCalls = 0
	const failing = localTts.createLocalTts({
		dir,
		sayPath,
		execFileImpl: (file, args, options, callback) => {
			failCalls += 1
			callback(new Error('say failed'))
		},
	})
	const failed = await failing.synthesize('hello there', 'stella')
	const status = await service.status()
	return { dir, sayPath, calls, first, hit, tide, oversize, reSynth, removedCalls, failed, failCalls, ready: status.ready, voices: status.voices }
})()

check(() => {
	assert.equal(local.first.format, 'wav')
	assert.ok(local.first.bytes.length > 44, 'the body is not a bare header')
	assert.equal(local.calls.length, 4, 'a cached phrase does not call say again; a removed one does')
	assert.equal(local.calls[0].file, local.sayPath)
	assert.deepEqual(plain(local.calls[0].args.slice(0, 2)), ['-v', 'Samantha'], 'stella maps to Samantha')
	assert.equal(local.calls[0].args[local.calls[0].args.length - 1], 'to eat', 'the phrase is an argument, never a shell string')
	assert.deepEqual(plain(local.calls[1].args.slice(0, 2)), ['-v', 'Daniel'], 'tide maps to Daniel')
	assert.deepEqual(plain(local.calls[2].args.slice(0, 2)), ['-v', 'Samantha'], 'an unknown timbre falls back to the default')
	assert.equal(local.hit.format, 'wav', 'a cache hit still returns playable audio')
	assert.equal(local.tide.format, 'wav')
	assert.equal(local.oversize, null, 'a phrase above the limit is refused locally')
	assert.equal(local.reSynth.format, 'wav')
	assert.equal(local.removedCalls, 1, 'removing a phrase forces a new say')
	assert.equal(local.failed, null, 'a failing say degrades instead of throwing')
	assert.equal(local.failCalls, 1)
	assert.equal(local.ready, true)
	assert.equal(local.voices.length, 2)
	fs.rmSync(local.dir, { recursive: true, force: true })
})

/* ═══════════════════════ 7a2. Edge TTS ═══════════════════════ */

const edge = await (async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-edge-'))
	const bin = path.join(dir, 'edge-tts')
	fs.writeFileSync(bin, '')
	const calls = []
	const fakeEdge = (file, args, options, callback) => {
		calls.push({ file, args })
		const target = args[args.indexOf('--write-media') + 1]
		fs.writeFileSync(target, Buffer.from('ID3fake-mp3-body'))
		callback(null, '', '')
	}
	const service = edgeTts.createEdgeTts({ dir, execFileImpl: fakeEdge, bin })
	const first = await service.synthesize('to eat', 'stella')
	await service.synthesize('to eat', 'stella')
	const hit = await service.synthesize('to eat', 'stella')
	const tide = await service.synthesize('a tide phrase', 'tide')
	const oversize = await service.synthesize('x'.repeat(401), 'stella')
	const beforeRemove = calls.length
	await service.remove('to eat', 'stella')
	const reSynth = await service.synthesize('to eat', 'stella')
	const removedCalls = calls.length - beforeRemove
	const failing = edgeTts.createEdgeTts({
		dir,
		bin,
		execFileImpl: (file, args, options, callback) => callback(new Error('edge failed')),
	})
	const failed = await failing.synthesize('hello there', 'stella')
	const status = await service.status()
	return { dir, bin, calls, first, hit, tide, oversize, reSynth, removedCalls, failed, ready: status.ready, voices: status.voices }
})()

check(() => {
	assert.equal(edge.first.format, 'mp3')
	assert.equal(edge.calls.length, 3, 'a cached Edge phrase does not call the CLI again; a removed one does')
	assert.equal(edge.calls[0].file, edge.bin)
	assert.deepEqual(plain(edge.calls[0].args.slice(0, 2)), ['--voice', 'en-US-AriaNeural'], 'stella maps to Aria')
	assert.deepEqual(plain(edge.calls[1].args.slice(0, 2)), ['--voice', 'en-US-GuyNeural'], 'tide maps to Guy')
	assert.equal(edge.calls[0].args[edge.calls[0].args.indexOf('--text') + 1], 'to eat')
	assert.equal(edge.hit.format, 'mp3')
	assert.equal(edge.tide.format, 'mp3')
	assert.equal(edge.oversize, null)
	assert.equal(edge.reSynth.format, 'mp3')
	assert.equal(edge.removedCalls, 1, 'removing an Edge phrase forces a new CLI run')
	assert.equal(edge.failed, null)
	assert.equal(edge.ready, true)
	assert.equal(edge.voices.length, 2)
	fs.rmSync(edge.dir, { recursive: true, force: true })
})

/* ═══════════════════════ 7b. registration & render smoke ═══════════════════════ */

check(() => {
	const registrations = []
	const dictionaries = {}
	const shortcutCommands = []
	const fakeCtx = {
		effect(fn) {
			const dispose = fn()
			return typeof dispose === 'function' ? dispose : () => {}
		},
		shortcuts: {
			runtime: 'desktop',
			platform: 'macos',
			register(command) {
				shortcutCommands.push(command)
				return () => {}
			},
		},
		locale: {
			register(namespace, dicts) {
				dictionaries[namespace] = dicts
				return () => {}
			},
			bind(namespace) {
				return (key) => {
					const dict = (dictionaries[namespace] && dictionaries[namespace].zh) || {}
					return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
				}
			},
		},
		slots: {
			inject(name, factory) {
				return factory()
			},
			register(options) {
				registrations.push(options)
				return () => {}
			},
		},
	}
	client.apply(fakeCtx)
	const main = registrations.find((entry) => entry.name === 'main')
	assert.ok(main, 'the page registers in the main slot')
	assert.equal(main.key, clientTest.ID)
	const row = registrations.find((entry) => entry.name === 'sidebar.panellist')
	assert.ok(row, 'the left sidebar row registers')
	assert.equal(row.id, clientTest.ID)
	assert.equal(row.order, 26)
	assert.equal(row.label(), '英文听写', 'the sidebar label is localized')
	const toastEntry = registrations.find((entry) => entry.name === 'shell.overlay' && entry.id === `${clientTest.ID}-toast`)
	assert.ok(toastEntry, 'the toast registers on the shell overlay layer')
	assert.equal(toastEntry.locale, clientTest.NS)
	assert.equal(dictionaries[clientTest.NS].zh['menu.label'], '英文听写')

	// Alt/Option is handled by the sentence's own DOM listener; the old native
	// Mod+Shift+P command is gone.
	assert.equal(shortcutCommands.length, 0, 'no native replay command is registered')
})

check(() => {
	// Smoke-render the three views with a fake React: any undefined reference or
	// bad hook order would throw here instead of in the GUI.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const tts = clientTest.createTts({
		synth: makeSynth([{ name: 'Samantha', lang: 'en-US' }]),
		SpeechUtterance: FakeUtterance,
	})
	tts.init('')
	const sound = clientTest.createSound()
	const noop = () => {}

	const item = {
		id: 'abc12345',
		en: 'I like to eat fresh apples every morning.',
		zh: '我喜欢每天早上吃新鲜的苹果。',
		words: [
			{ text: 'I', pos: 'pron', ipa: '/aɪ/' },
			{ text: 'like', pos: 'verb', ipa: '/laɪk/' },
			{ text: 'to', pos: 'prep' },
			{ text: 'eat', pos: 'verb' },
			{ text: 'fresh', pos: 'adj' },
			{ text: 'apples', pos: 'noun' },
			{ text: 'every', pos: 'det' },
			{ text: 'morning.', pos: 'noun' },
		],
		difficulty: 4.2,
		tags: ['spelling'],
	}

	const practice = clientTest.Practice({
		item,
		run: { index: 2, score: 240, combo: 3, grade: 'A' },
		settings: { rate: 0.95, sound: true, voiceName: '' },
		t,
		tts,
		sound,
		onAnswer: async () => ({}),
		onContinue: noop,
		onExit: noop,
		onRetryReport: async () => ({ ok: true }),
	})
	assert.ok(practice && practice.args, 'the dictation page renders')

	// Click through the page with a stateful React: opening the answer overlay must
	// actually put a floating card in the tree (it was built but never rendered once).
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const tts2 = client2.__test.createTts({ synth: makeSynth([{ name: 'Alex', lang: 'en-US' }]), SpeechUtterance: FakeUtterance })
	tts2.init('')
	const props = {
		item,
		run: { index: 2, score: 240, combo: 3, grade: 'A' },
		settings: { rate: 0.95, sound: true, voiceName: '' },
		t,
		tts: tts2,
		sound,
		onAnswer: async () => ({}),
		onContinue: noop,
		onExit: noop,
		onRetryReport: async () => ({ ok: true }),
	}
	let tree = null
	const render = () => {
		stateful.cursor = 0
		tree = client2.__test.Practice(props)
	}
	render()
	const findButton = (node, title) => {
		const stack = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (Array.isArray(current)) {
				for (const child of current) stack.push(child)
				continue
			}
			if (typeof current !== 'object') continue
			const args = current.args || []
			if (args[0] === 'button' && args[1] && args[1].title === title) return args[1]
			for (const child of args) stack.push(child)
		}
		return null
	}
	const hasClass = (node, className) => {
		const stack = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (Array.isArray(current)) {
				for (const child of current) stack.push(child)
				continue
			}
			if (typeof current !== 'object') continue
			const args = current.args || []
			if (args[1] && args[1].className === className) return true
			for (const child of args) stack.push(child)
		}
		return false
	}
	const revealButton = findButton(tree, t('practice.revealHint'))
	assert.ok(revealButton && typeof revealButton.onClick === 'function', 'the reveal button exists')
	revealButton.onClick()
	render()
	assert.ok(hasClass(tree, 'dsh-de-reveal-overlay'), 'the answer floats over the page')
	assert.ok(hasClass(tree, 'dsh-de-reveal-card'), 'the overlay carries the word card')

	// Closing the overlay returns to the same question instead of advancing.
	const findClass = (node, className) => {
		const stack = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (Array.isArray(current)) {
				for (const child of current) stack.push(child)
				continue
			}
			if (typeof current !== 'object') continue
			const args = current.args || []
			if (args[1] && args[1].className === className) return args[1]
			for (const child of args) stack.push(child)
		}
		return null
	}
	const backdrop = findClass(tree, 'dsh-de-reveal-overlay')
	assert.ok(backdrop && typeof backdrop.onClick === 'function', 'the overlay closes on a backdrop click')
	backdrop.onClick()
	render()
	assert.ok(!hasClass(tree, 'dsh-de-reveal-overlay'), 'the overlay is gone after closing')
	assert.ok(hasClass(tree, 'dsh-de-boxes'), 'the same question is back, not the next one')
	// A second mount, typing this time: the per-word boxes feed the check and a
	// correct question shows its card.
	const typing = createStatefulReact()
	const client3 = definition.factory((name) => {
		assert.equal(name, 'react')
		return typing.React
	})
	const tts3 = client3.__test.createTts({ synth: makeSynth([{ name: 'Alex', lang: 'en-US' }]), SpeechUtterance: FakeUtterance })
	tts3.init('')
	const typingProps = { ...props, tts: tts3 }
	let typingTree = null
	const renderTyping = () => {
		typing.cursor = 0
		typingTree = client3.__test.Practice(typingProps)
	}
	renderTyping()
	const findInput = (node) => {
		const stack = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (Array.isArray(current)) {
				for (const child of current) stack.push(child)
				continue
			}
			if (typeof current !== 'object') continue
			const args = current.args || []
			if (args[0] === 'input') return args[1]
			for (const child of args) stack.push(child)
		}
		return null
	}
	const firstInput = findInput(typingTree)
	assert.ok(firstInput && typeof firstInput.onChange === 'function', 'a word box is editable')
	firstInput.onChange({ target: { value: item.words[0].text } })
	renderTyping()
	const secondInput = findInput(typingTree)
	secondInput.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} })
	renderTyping()
	assert.ok(hasClass(typingTree, 'dsh-de-wordcard'), 'a correct question shows its card')



	const dashboard = clientTest.Dashboard({
		data: {
			profile: { theta: 6.2, band: 'B1', estimatedBand: 'B1', tags: { spelling: 0.41 }, settings: { rate: 0.95, sound: true, voiceName: '' } },
			today: { sentences: 12, minutes: 8 },
			totals: { runs: 3, sentences: 30, minutes: 26, replays: 18 },
			streak: 4,
			weak: [{ tag: 'spelling', label: '拼写', mastery: 0.41 }],
			lastRun: { id: 'r-1', endedAt: new Date().toISOString(), sentences: 12, accuracy: 83, grade: 'S', mainIssues: ['spelling'] },
			activeRun: { index: 12, score: 1240, combo: 4, bestCombo: 7 },
			runs: [],
		},
		t,
		starting: false,
		start: noop,
		resume: noop,
		abandon: noop,
		chooseBand: noop,
		openArchive: noop,
		settings: { rate: 0.95, sound: true, voiceName: '' },
		updateSettings: noop,
		confirmRestart: false,
		setConfirmRestart: noop,
		ttsVersion: 1,
		tts,
		voicePanel: null,
		toggleVoice: noop,
	})
	assert.ok(dashboard && dashboard.args, 'the dashboard renders')

	// First run: no band yet, so the self-assessment card replaces the primary
	// button instead of sitting next to a disabled one.
	const firstRun = clientTest.Dashboard({
		data: { profile: { theta: 6, band: '', estimatedBand: 'B1', tags: {}, settings: { rate: 0.95, sound: true, voiceName: '' } }, today: { sentences: 0, minutes: 0 }, totals: { runs: 0, sentences: 0, minutes: 0, replays: 0 }, streak: 0, weak: [], lastRun: null, activeRun: null, runs: [] },
		t,
		starting: false,
		start: noop,
		resume: noop,
		abandon: noop,
		chooseBand: noop,
		openArchive: noop,
		settings: { rate: 0.95, sound: true, voiceName: '' },
		updateSettings: noop,
		confirmRestart: false,
		setConfirmRestart: noop,
		ttsVersion: 1,
		tts,
		voicePanel: null,
		toggleVoice: noop,
	})
	assert.ok(firstRun && firstRun.args, 'the first-run dashboard renders')

	// The chunked item (the phrase pass) renders through the same component.
	const chunked = clientTest.Practice({
		item: { ...item, chunks: [[0], [1], [2, 3], [4], [5], [6], [7]] },
		run: { index: 0, score: 0, combo: 0, grade: 'C', practiceMs: 0 },
		settings: { rate: 0.95, sound: true, voiceName: '' },
		t,
		tts,
		sound,
		onAnswer: async () => ({}),
		onContinue: noop,
		onExit: noop,
		onRetryReport: async () => ({ ok: true }),
	})
	assert.ok(chunked && chunked.args, 'the phrase-pass layout renders')

	// The page shell itself: hook order and use-before-declare breakage here would
	// blank the whole panel in the GUI, and nothing else renders this component.
	const page = clientTest.makePage({ tts, sound })
	const pageTree = page({ t })
	assert.ok(pageTree && pageTree.args, 'the page renders its loading state')
	assert.ok(hasClass(pageTree, 'dsh-de-page'), 'the loading shell is the plugin page')

	// A remount after a tab switch returns to the exact screen — the listen gate,
	// an accepted question's card, a submitted sentence's verdict — instead of
	// restarting the sentence from the top.
	{
		const base = {
			itemId: item.id,
			stepIndex: 0,
			answers: ['I'],
			phase: 'typing',
			card: null,
			screen: { failed: false, backspace: false, revealed: false },
			feedback: null,
			answer: null,
			replays: 0,
			listenDone: false,
			wordStats: [],
			elapsedMs: 3000,
		}
		const practiceProps = {
			item,
			run: { index: 2, score: 240, combo: 3, grade: 'A' },
			settings: { rate: 0.95, sound: true, voiceName: '' },
			t,
			tts,
			sound,
			onAnswer: async () => ({}),
			onContinue: noop,
			onExit: noop,
			onRetryReport: async () => ({ ok: true }),
		}

		clientTest.draft({ ...base, phase: 'listen' })
		const listening = clientTest.Practice(practiceProps)
		assert.ok(hasClass(listening, 'dsh-de-listen'), 'the listen gate comes back')
		assert.ok(!hasClass(listening, 'dsh-de-boxes'), 'the word boxes wait behind the gate')

		clientTest.draft({ ...base, phase: 'card', card: { role: 'object', text: 'to eat', ipa: '', pos: '', zh: '吃' } })
		const carded = clientTest.Practice(practiceProps)
		assert.ok(hasClass(carded, 'dsh-de-wordcard'), 'an accepted question keeps its card')

		clientTest.draft({
			...base,
			phase: 'done',
			feedback: { result: 'perfect', elapsedMs: 4200, bonus: 1, revealed: false, comboBefore: 0 },
			answer: { combo: 1, report: null, offline: false },
		})
		const verdict = clientTest.Practice(practiceProps)
		assert.ok(hasClass(verdict, 'dsh-de-feedback'), 'a submitted sentence keeps its verdict')

		clientTest.draft(null)
	}

	const archive = clientTest.Archive({
		data: {
			totals: { runs: 1, sentences: 12, minutes: 8 },
			profile: { tags: { spelling: 0.41 } },
			runs: [{ id: 'r-1', startedAt: new Date().toISOString(), sentences: 12, accuracy: 83, grade: 'S', mainIssues: ['spelling'] }],
		},
		t,
		onBack: noop,
	})
	assert.ok(archive && archive.args, 'the archive renders')
})

/* ═══════════════════════ 7b. Articles: split, feed, home wiring ═══════════════════════ */

check(() => {
	// One parser for both dialects: RSS with content:encoded, Atom with CDATA and
	// a rel="alternate" link. Dates are kept verbatim; normalization happens in
	// the source layer where they can be validated.
	const rssItems = rss.parseFeed(`<rss><channel>
		<item>
			<title><![CDATA[First story]]></title>
			<link>https://example.org/first</link>
			<pubDate>Tue, 17 Nov 2026 08:00:00 +0000</pubDate>
			<description><![CDATA[<p>Short teaser.</p>]]></description>
			<content:encoded><![CDATA[<p>Body one.</p><p>Body two.</p>]]></content:encoded>
		</item>
		<item>
			<title>Second story</title>
			<link>https://example.org/second</link>
			<pubDate>Mon, 16 Nov 2026 08:00:00 +0000</pubDate>
			<description>Teaser two.</description>
		</item>
	</channel></rss>`)
	assert.equal(rssItems.length, 2)
	assert.equal(rssItems[0].title, 'First story')
	assert.equal(rssItems[0].link, 'https://example.org/first')
	assert.equal(rssItems[0].publishedAt, 'Tue, 17 Nov 2026 08:00:00 +0000')
	assert.ok(rssItems[0].text.includes('Body one') && rssItems[0].text.includes('Body two'), 'the full body wins over the teaser')
	assert.equal(rssItems[0].summary, 'Short teaser.', 'the summary is plain text')
	assert.equal(rssItems[1].text, 'Teaser two.', 'a summary-only item still has text')

	const atomItems = rss.parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom">
		<entry>
			<title><![CDATA[Atom story &amp; more]]></title>
			<link rel="alternate" href="https://example.org/atom" />
			<published>2026-11-17T09:00:00Z</published>
			<summary><![CDATA[<p>Atom teaser.</p>]]></summary>
		</entry>
	</feed>`)
	assert.equal(atomItems.length, 1)
	assert.equal(atomItems[0].title, 'Atom story & more', 'entities and CDATA are decoded once')
	assert.equal(atomItems[0].link, 'https://example.org/atom', 'the alternate link is used')
	assert.equal(atomItems[0].publishedAt, '2026-11-17T09:00:00Z')
	assert.equal(atomItems[0].summary, 'Atom teaser.')
	checks += 1
})

check(() => {
	// Page extraction keeps prose and drops the furniture real pages wrap it in.
	const html = `<html><body>
		<nav>Home | News | About</nav>
		<header>Search Suggested Searches Artemis</header>
		<main>
			<p>An official website of the United States government</p>
			<p>This is the first real paragraph of the article, long enough to keep.</p>
			<p>This is the second real paragraph, also long enough to keep in the output.</p>
			<p>Facebook Twitter Print Email</p>
		</main>
		<footer>Last updated by Office of Communications on October 30, 2026</footer>
	</body></html>`
	const text = rss.extractArticleText(html)
	assert.ok(text.includes('first real paragraph'), 'prose is kept')
	assert.ok(text.includes('second real paragraph'), 'all prose paragraphs are kept')
	assert.equal(text.includes('Home | News'), false, 'navigation is dropped')
	assert.equal(text.includes('Official website'), false, 'the .gov banner is dropped')
	assert.equal(text.includes('Last updated'), false, 'the footer is dropped')
	assert.equal(text.includes('Facebook'), false, 'share links are dropped')
	checks += 1
})

check(() => {
	// The add page's level list must match the Host's spec: a page that offers A1
	// and a Host that validates A1 is the whole contract.
	assert.deepEqual(plain(clientTest.CEFR_LEVELS), rewrite.CEFR_LEVELS, 'the client offers exactly the Host levels')
	checks += 1
})

check(() => {
	// A model's typographic habits are not a level failure: normalize them before
	// judging the exercise, and let the level checks ignore the exercise length.
	const raw = 'NASA’s (AVATAR) test; it uses “new” power — see https://example.org/x and more/less.'
	const clean = rewrite.normalizeRewriteText(raw)
	assert.equal(clean.includes('’'), false, 'curly apostrophes become straight')
	assert.equal(clean.includes('('), false, 'parentheses are removed')
	assert.equal(clean.includes(';'), false, 'semicolons become full stops')
	assert.equal(clean.includes('—'), false, 'em dashes become hyphens')
	assert.equal(/https?:\/\//.test(clean), false, 'URLs are stripped')
	assert.ok(clean.includes("NASA's") && clean.includes('AVATAR'))
	assert.equal(/[;:()[\]{}<>—–/]/.test(clean), false, 'only dictation-safe punctuation remains')
	const exercisePrompt = prompts.buildExercisePrompt({ level: 'A2', title: 'x', text: 'y' })
	assert.ok(exercisePrompt.includes('6–20 句（这是篇幅，不是等级）'), 'sentence count is framed as length, not level')
	assert.ok(exercisePrompt.includes('questions'), 'the same call asks for the learner questions')
	const parsedExercise = prompts.parseExerciseResponse(JSON.stringify({
		title: 'A park',
		sentences: [{ en: 'The park is open today.', zh: '公园今天开放。', given: [] }],
		questions: ['公园在哪里？'],
	}))
	assert.equal(parsedExercise.sentences.length, 1)
	assert.equal(parsedExercise.questions[0], '公园在哪里？')
	assert.equal(prompts.parseExerciseResponse('not json'), null)
	const source = fs.readFileSync(path.join(root, 'lib', 'generate.js'), 'utf8')
	assert.ok(source.includes('parseExerciseResponse(reply)'), 'the exercise is parsed from one reply')
	assert.ok(source.includes('validateRewrite(sentences.map'), 'level checks use the joined sentences with length off')
	assert.equal(source.includes('attempt <'), false, 'there is no rewrite retry loop')
	const host = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(host.includes("fail(res, 502, 'rewrite-failed', String(error.detail || ''))"), 'the failure reason travels back with the code')
	checks += 1
})

check(() => {
	// C2 is a real level, not just a badge: spec, profile, prompt and validator
	// all know it.
	assert.equal(rewrite.CEFR_LEVELS[rewrite.CEFR_LEVELS.length - 1], 'C2')
	assert.equal(rewrite.isCefr('C2'), true)
	assert.equal(rewrite.cefrProfile('C2').name.zh, '精通')
	assert.ok(rewrite.CEFR_SPECS.C2 && rewrite.CEFR_SPECS.C2.words[0] > rewrite.CEFR_SPECS.C1.words[0])
	const prompt = prompts.buildExercisePrompt({
		level: 'C2',
		title: 'A source title',
		text: 'Some source text about a town and its park.',
	})
	assert.ok(prompt.includes('精通'), 'the C2 prompt carries its name')
	assert.ok(prompt.includes('8000 词以上'), 'the C2 prompt carries its vocabulary guidance')
	checks += 1
})

check(() => {
	// One definition, two readers: the dialog copy and the prompt must say the
	// same thing, and the prompt must carry syntax + vocabulary, not a word count.
	for (const level of rewrite.CEFR_LEVELS) {
		const profile = rewrite.CEFR_PROFILES[level]
		assert.equal(clientTest.LOCALE_ZH[`cefr.${level}.name`], profile.name.zh, `zh name for ${level}`)
		assert.equal(clientTest.LOCALE_ZH[`cefr.${level}.def`], profile.definition.zh, `zh definition for ${level}`)
		assert.equal(clientTest.LOCALE_EN[`cefr.${level}.name`], profile.name.en, `en name for ${level}`)
		assert.equal(clientTest.LOCALE_EN[`cefr.${level}.def`], profile.definition.en, `en definition for ${level}`)
		const prompt = prompts.buildExercisePrompt({
			level,
			title: 'A source title',
			text: 'Some source text about a town and its park.',
		})
		assert.ok(prompt.includes(profile.definition.zh), `the prompt states what ${level} means`)
		assert.ok(prompt.includes(profile.syntax.zh), `the prompt states ${level} syntax`)
		assert.ok(prompt.includes(profile.vocabulary.zh), `the prompt states ${level} vocabulary`)
		assert.ok(prompt.includes('6–20 句'), 'the prompt asks for 6–20 sentences')
		assert.ok(prompt.includes('英语学习问题'), 'the questions must be about learning English')
		assert.ok(prompt.includes('禁止元问题'), 'the prompt forbids plugin/source questions')
		assert.ok(/句法结构和词汇等级/.test(prompt), 'the prompt says syntax and vocabulary decide the level')
	}
	checks += 1
})

check(() => {
	// Sentence count is 6–20 dictation units, and the two syntax gates that make
	// A1/A2 A1/A2: clause density and the perfect tense.
	const many = Array.from({ length: 25 }, () => 'The cat sits on the mat.').join(' ')
	const tooMany = rewrite.validateRewrite(many, 'B1')
	assert.equal(tooMany.ok, false)
	assert.ok(/句子太多/.test(tooMany.reason), tooMany.reason)

	const clauses = Array.from({ length: 8 }, () => 'I like tea because it is warm.').join(' ')
	assert.ok(/从句/.test(rewrite.validateRewrite(clauses, 'A1').reason), 'A1 rejects a clause in every sentence')

	const perfect = Array.from({ length: 8 }, () => 'I have seen that film many times.').join(' ')
	assert.ok(/完成时/.test(rewrite.validateRewrite(perfect, 'A1').reason), 'A1 rejects the perfect tense')
	checks += 1
})

check(() => {
	// The level is enforced, not just requested. Each failure names the rule, so
	// the retry prompt can say what to fix.
	const passage = [
		'The town opens a new park this week.',
		'The park is next to the river.',
		'Families can walk there on Sunday.',
		'Children like the small wooden bridge.',
		'There is a quiet place for a picnic.',
		'People can sit and watch the birds.',
		'A small shop sells water and fruit.',
		'The town wants more green places.',
		'It plans to build two more next year.',
		'Everyone can use the park for free.',
		'Many people helped to plan it.',
		'They asked for trees and flowers.',
		'The park has a long path for bikes.',
		'It is open from morning to night.',
		'The town hopes people will keep it clean.',
	].join(' ')
	assert.equal(rewrite.isCefr('B1'), true)
	assert.equal(rewrite.isCefr('b1'), false, 'levels are exact ids')
	assert.equal(rewrite.rewriteSpec('B1').words[0], 100)
	const pass = rewrite.validateRewrite(
		passage,
		'B1',
		'A completely different report about shipping, agriculture and local elections in another country.',
	)
	assert.equal(pass.ok, true, pass.reason)
	assert.ok(pass.stats.words >= 100 && pass.stats.words <= 160, 'the passage is inside the B1 window')
	assert.ok(pass.stats.sentences >= 6, 'enough sentences for a dictation set')
	assert.equal(rewrite.validateRewrite(passage, 'A1').ok, false, 'too long for A1')
	assert.equal(rewrite.validateRewrite(passage, 'C1').ok, false, 'too short for C1')
	assert.ok(/网址/.test(rewrite.validateRewrite(`${passage} See https://example.org`, 'B1').reason), 'URLs are rejected')
	assert.ok(/Markdown/.test(rewrite.validateRewrite(`${passage}\n# Title`, 'B1').reason), 'Markdown headings are rejected')
	const copy = rewrite.validateRewrite(passage, 'B1', passage)
	assert.equal(copy.ok, false, 'the source pasted back is not a rewrite')
	assert.ok(/几乎一样/.test(copy.reason))
	assert.ok(/字数|句/.test(rewrite.validateRewrite('One short sentence only.', 'B1').reason))
	assert.equal(rewrite.validateRewrite('', 'B1').ok, false)
	assert.ok(rewrite.feedbackFor(rewrite.validateRewrite('', 'B1')).includes('不合格'))
	// Punctuation the dictation splitter cannot handle is rejected up front, and
	// sentences too short to be a dictation unit do not count as a practice set.
	assert.ok(/标点/.test(rewrite.validateRewrite(passage.replace('.', ';'), 'B1').reason))
	const choppy = 'Go. Run. Sit. Walk. Jump. Stop. Look. Listen. Wait. Open. Close. Read. Write. Draw. Cook.'.repeat(8)
	const choppyVerdict = rewrite.validateRewrite(choppy, 'B1')
	assert.equal(choppyVerdict.ok, false)
	assert.ok(/能出题的句子/.test(choppyVerdict.reason), choppyVerdict.reason)
	checks += 1
})

{
	// Aggregation: every provider is fetched independently, rows are deduped by
	// URL, one provider's failure only removes its own rows, and the merged list
	// is in publication-time order.
	const feeds = new Map()
	const calls = []
	const now = 2000000000000
	const providerFeeds = sourcesModule.SOURCE_PROVIDERS.map((provider) => provider.feeds[0])
	const date = (hours) => new Date(now - hours * 3600000).toUTCString()
	const item = (title, link, hours) => `<item><title>${title}</title><link>${link}</link><pubDate>${date(hours)}</pubDate><description>teaser</description></item>`
	feeds.set(providerFeeds[0], `<rss><channel>${item('NASA newest', 'https://example.org/n1', 1)}${item('NASA older', 'https://example.org/n2', 30)}${item('Shared story', 'https://example.org/shared', 5)}</channel></rss>`)
	feeds.set(providerFeeds[1], `<rss><channel>${item('NOAA story', 'https://example.org/noaa', 3)}${item('Shared story', 'https://example.org/shared', 5)}</channel></rss>`)
	feeds.set(providerFeeds[2], `<rss><channel>${item('NIST story', 'https://example.org/nist', 2)}</channel></rss>`)
	feeds.set(providerFeeds[3], `<rss><channel>${item('WHO story', 'https://example.org/who', 40)}</channel></rss>`)
	feeds.set(providerFeeds[4], `<rss><channel>${item('OWID story', 'https://example.org/owid', 4)}</channel></rss>`)
	feeds.set(providerFeeds[5], `<rss><channel>${item('PLOS story', 'https://example.org/plos', 6)}</channel></rss>`)
	// Frontiers is left out of the map: its fetch fails, which must not break the list.
	const fakeFetch = async (url) => {
		calls.push(url)
		if (!feeds.has(url)) throw new Error('offline')
		return { ok: true, status: 200, text: async () => feeds.get(url) }
	}
	const sources = sourcesModule.createSources({ fetch: fakeFetch, now: () => now, cacheMs: 1000 })
	const first = await sources.list()
	assert.equal(first.items.length, 8, 'all reachable rows are merged (the shared URL counts once)')
	assert.equal(first.added, 8, 'the first poll adds every row')
	const times = first.items.map((row) => Date.parse(row.publishedAt))
	assert.deepEqual([...times].sort((a, b) => b - a), times, 'rows are newest first')
	assert.equal(first.items.filter((row) => row.url === 'https://example.org/shared').length, 1, 'a shared URL appears once')
	assert.equal(first.status.length, sourcesModule.SOURCE_PROVIDERS.length)
	assert.equal(first.status.find((entry) => entry.id === 'frontiers').ok, false, 'a dead provider is reported, not thrown')
	assert.equal(first.status.find((entry) => entry.id === 'nasa').ok, true)
	const before = calls.length
	await sources.list()
	assert.equal(calls.length, before, 'the list is cached')
	assert.equal((await sources.list()).added, 0, 'a cached list adds nothing')
	const forcedBefore = calls.length
	await sources.list({ force: true })
	assert.ok(calls.length > forcedBefore, 'a forced list bypasses the cache')
	const cached = first.items.find((row) => row.title === 'NASA newest')
	const found = await sources.get(cached.id)
	assert.equal(found.url, 'https://example.org/n1', 'a row can be fetched back by id')
	assert.equal(first.items.some((row) => row.text !== undefined), false, 'the list does not ship article bodies')
	const hashed = first.items.find((row) => row.url === 'https://example.org/n1')
	assert.equal(hashed.id, crypto.createHash('sha1').update('https://example.org/n1').digest('hex').slice(0, 12), 'a row id is the URL hash')
	checks += 1
}

{
	// A feed that carries the body is used directly; a teaser-only feed falls
	// back to the page with the same extraction as everywhere else.
	const now = 2000000000000
	const providerFeeds = sourcesModule.SOURCE_PROVIDERS.map((provider) => provider.feeds[0])
	const feeds = new Map()
	const pages = new Map()
	const body = 'This is a long feed body sentence with enough words to be usable. '.repeat(20)
	feeds.set(providerFeeds[3], `<rss><channel><item><title>WHO body</title><link>https://example.org/who</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>${body}</description></item></channel></rss>`)
	feeds.set(providerFeeds[0], `<rss><channel><item><title>NASA teaser</title><link>https://example.org/nasa</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>short teaser</description></item></channel></rss>`)
	pages.set('https://example.org/nasa', `<html><body><main><p>${'The page has the real article text, which the feed only teased. '.repeat(12)}</p></main></body></html>`)
	const fakeFetch = async (url) => {
		if (pages.has(url)) return { ok: true, status: 200, text: async () => pages.get(url) }
		if (!feeds.has(url)) throw new Error('offline')
		return { ok: true, status: 200, text: async () => feeds.get(url) }
	}
	const sources = sourcesModule.createSources({ fetch: fakeFetch, now: () => now, cacheMs: 1000 })
	const list = await sources.list()
	const who = list.items.find((row) => row.title === 'WHO body')
	const nasa = list.items.find((row) => row.title === 'NASA teaser')
	const whoArticle = await sources.article(who.id)
	assert.ok(whoArticle.text.includes('long feed body'), 'a feed with the body is used as-is')
	assert.equal(whoArticle.text.includes('The page has the real article'), false)
	const nasaArticle = await sources.article(nasa.id)
	assert.ok(nasaArticle.text.includes('The page has the real article'), 'a teaser-only feed fetches the page')
	assert.ok(nasaArticle.textWords > 60, 'the page text is long enough to rewrite')
	checks += 1
}

check(() => {
	// A feed that carries the body is used directly; a teaser-only feed falls
	// back to the page with the same extraction as everywhere else.
	const now = 2000000000000
	const providerFeeds = sourcesModule.SOURCE_PROVIDERS.map((provider) => provider.feeds[0])
	const feeds = new Map()
	const pages = new Map()
	const body = 'This is a long feed body sentence with enough words to be usable. '.repeat(20)
	feeds.set(providerFeeds[3], `<rss><channel><item><title>WHO body</title><link>https://example.org/who</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>${body}</description></item></channel></rss>`)
	feeds.set(providerFeeds[0], `<rss><channel><item><title>NASA teaser</title><link>https://example.org/nasa</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>short teaser</description></item></channel></rss>`)
	pages.set('https://example.org/nasa', `<html><body><main><p>${'The page has the real article text, which the feed only teased. '.repeat(12)}</p></main></body></html>`)
	const fakeFetch = async (url) => {
		if (pages.has(url)) return { ok: true, status: 200, text: async () => pages.get(url) }
		if (!feeds.has(url)) throw new Error('offline')
		return { ok: true, status: 200, text: async () => feeds.get(url) }
	}
	const sources = sourcesModule.createSources({ fetch: fakeFetch, now: () => now, cacheMs: 1000 })
	return (async () => {
		const list = await sources.list()
		const who = list.items.find((row) => row.title === 'WHO body')
		const nasa = list.items.find((row) => row.title === 'NASA teaser')
		const whoArticle = await sources.article(who.id)
		assert.ok(whoArticle.text.includes('long feed body'), 'a feed with the body is used as-is')
		assert.equal(whoArticle.text.includes('The page has the real article'), false)
		const nasaArticle = await sources.article(nasa.id)
		assert.ok(nasaArticle.text.includes('The page has the real article'), 'a teaser-only feed fetches the page')
		assert.ok(nasaArticle.textWords > 60, 'the page text is long enough to rewrite')
		checks += 1
	})()
})

check(() => {
	// Favicons: read the homepage's <link rel="icon">, keep only same-site
	// candidates, fall back to /favicon.ico, and cache the bytes on disk.
	return (async () => {
		const html =
			'<link rel="mask-icon" href="/mask.svg">' +
			'<link rel="icon" href="https://cdn.other.example/x.png">' +
			'<link rel="apple-touch-icon" href="/apple.png" sizes="180x180">' +
			'<link rel="icon" href="/assets/fav.png" type="image/png" sizes="32x32">'
		const candidates = faviconModule.iconCandidates(html, 'https://www.nasa.gov/')
		assert.equal(candidates[0], 'https://www.nasa.gov/assets/fav.png', 'a same-site PNG icon wins')
		assert.equal(candidates[candidates.length - 1], 'https://www.nasa.gov/favicon.ico', '/favicon.ico is the last resort')
		assert.equal(candidates.some((url) => url.includes('cdn.other.example')), false, 'off-site icons are ignored')
		assert.equal(candidates.some((url) => url.includes('mask')), false, 'mask icons are not favicons')

		const dir = path.join(storageDir, 'favicon-cache')
		const png = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4])
		const ico = Buffer.from([0, 0, 1, 0, 9, 9])
		const text = (body) => ({
			ok: true,
			headers: new Map([['content-type', 'text/html']]),
			text: async () => body,
			arrayBuffer: async () => Buffer.from(body),
		})
		const binary = (type, bytes) => ({
			ok: true,
			headers: new Map([['content-type', type]]),
			text: async () => '',
			arrayBuffer: async () => bytes,
		})
		let clock = 1000
		let calls = []
		const fakeFetch = async (url) => {
			const target = String(url)
			calls.push(target)
			if (target === 'https://www.nasa.gov/') return text('<link rel="icon" href="/assets/fav.png" type="image/png">')
			if (target === 'https://www.nasa.gov/assets/fav.png') return binary('image/png', png)
			if (target === 'https://www.noaa.gov/') return text('<html><head></head></html>')
			if (target === 'https://www.noaa.gov/favicon.ico') return binary('image/x-icon', ico)
			return text('')
		}
		const cache = faviconModule.createFavicons({ dir, fetch: fakeFetch, now: () => clock })
		const icon = await cache.get('nasa')
		assert.equal(icon.type, 'image/png')
		assert.deepEqual(Array.from(icon.bytes), Array.from(png))
		assert.ok(calls.includes('https://www.nasa.gov/assets/fav.png'), 'the declared icon is fetched')
		assert.ok(fs.existsSync(path.join(dir, 'nasa.png')), 'the bytes are cached on disk')
		assert.ok(fs.existsSync(path.join(dir, 'index.json')), 'the cache index is written')

		let offlineCalls = 0
		const offline = faviconModule.createFavicons({
			dir,
			fetch: async () => {
				offlineCalls += 1
				throw new Error('offline')
			},
			now: () => clock,
		})
		const cached = await offline.get('nasa')
		assert.deepEqual(Array.from(cached.bytes), Array.from(png), 'a fresh cache is served without the network')
		assert.equal(offlineCalls, 0, 'nothing is fetched while the cache is fresh')

		clock += 8 * 24 * 60 * 60 * 1000
		const expired = faviconModule.createFavicons({ dir, fetch: fakeFetch, now: () => clock })
		const refreshed = await expired.get('nasa')
		assert.deepEqual(Array.from(refreshed.bytes), Array.from(png))
		assert.ok(expired !== null)

		const fallbackDir = path.join(storageDir, 'favicon-fallback')
		const fallback = faviconModule.createFavicons({ dir: fallbackDir, fetch: fakeFetch, now: () => clock })
		const icoIcon = await fallback.get('noaa')
		assert.equal(icoIcon.type, 'image/x-icon', 'a page without <link> falls back to /favicon.ico')

		const whoPage = async (url) => {
			const target = String(url)
			if (target === 'https://www.who.int/') return text('<link rel="icon" href="/nothing.css">')
			return text('<html></html>')
		}
		const nonImage = faviconModule.createFavicons({ dir: path.join(storageDir, 'favicon-nonimage'), fetch: whoPage, now: () => clock })
		assert.equal(await nonImage.get('who'), null, 'a non-image body is rejected')

		const unknown = faviconModule.createFavicons({ dir: path.join(storageDir, 'favicon-unknown'), fetch: fakeFetch, now: () => clock })
		const before = calls.length
		assert.equal(await unknown.get('nope'), null, 'only known providers are fetched')
		assert.equal(calls.length, before, 'an unknown provider makes no request')
		checks += 1
	})()
})

check(() => {
	// A pasted article URL becomes a transient source row: title and prose are
	// fetched once, and the normal generate call reuses the cached text.
	return (async () => {
		const now = 2000000000000
		let calls = 0
		const html = `<html><head><title>Custom &amp; Story</title></head><body><main><p>${'A custom article sentence with enough words to exercise. '.repeat(12)}</p></main></body></html>`
		const fakeFetch = async () => {
			calls += 1
			return { ok: true, status: 200, text: async () => html }
		}
		const sources = sourcesModule.createSources({ fetch: fakeFetch, now: () => now })
		assert.equal(sourcesModule.isFetchableUrl('https://example.org/article'), true)
		assert.equal(sourcesModule.isFetchableUrl('http://127.0.0.1/a'), false, 'loopback is refused')
		assert.equal(sourcesModule.isFetchableUrl('ftp://example.org/a'), false)
		const row = await sources.ingest('https://www.example.org/custom')
		assert.equal(row.provider, 'custom')
		assert.equal(row.source, 'example.org')
		assert.equal(row.title, 'Custom & Story', 'the page title is decoded')
		assert.ok(row.words >= 40)
		assert.equal(row.id, crypto.createHash('sha1').update('https://www.example.org/custom').digest('hex').slice(0, 12))
		const article = await sources.article(row.id)
		assert.ok(article.text.includes('A custom article sentence'), 'the fetched prose is reused')
		assert.equal(calls, 1, 'the page is fetched once, not again for the article')
		const before = calls
		await assert.rejects(() => sources.ingest('http://localhost/a'), (error) => error.code === 'bad-url')
		assert.equal(calls, before, 'an unsafe URL is rejected before any request')
		const thin = sourcesModule.createSources({
			fetch: async () => ({ ok: true, status: 200, text: async () => '<html><body><p>Too short.</p></body></html>' }),
			now: () => now,
		})
		await assert.rejects(() => thin.ingest('https://example.org/thin'), (error) => error.code === 'no-article-text')
		checks += 1
	})()
})

check(() => {
	// The article timeline is an RSS reader's: a poll merges, nothing vanishes
	// when a feed rotates, read state survives a restart, old rows are pruned.
	return (async () => {
		const file = path.join(storageDir, 'feed-timeline.json')
		let clock = Date.parse('2026-11-18T00:00:00Z')
		const row = (id, url, hoursAgo, title) => ({
			id,
			url,
			provider: 'nasa',
			source: 'NASA',
			topic: 'science',
			title,
			publishedAt: new Date(clock - hoursAgo * 3600000).toISOString(),
			summary: 'teaser',
		})
		const store = feedModule.createFeedStore({ file, now: () => clock })
		const firstMerge = store.merge([row('a1', 'https://example.org/1', 1, 'First'), row('a2', 'https://example.org/2', 2, 'Second')])
		assert.deepEqual(plain(firstMerge), { added: 2, total: 2 }, 'the merge reports new rows')
		assert.equal(store.list().length, 2, 'a poll lands in the timeline')
		assert.deepEqual(store.list().map((entry) => entry.id), ['a1', 'a2'], 'newest first')
		assert.ok(store.list().every((entry) => entry.read === false), 'new rows start unread')
		assert.equal(store.markRead('a1'), true)
		assert.equal(store.get('a1').read, true, 'a preview marks the row read')
		assert.equal(store.markRead('missing'), false)
		const secondMerge = store.merge([row('a1', 'https://example.org/1', 1, 'First updated'), row('a3', 'https://example.org/3', 0.5, 'Third')])
		assert.deepEqual(plain(secondMerge), { added: 1, total: 3 }, 'only the unseen URL counts as new')
		assert.equal(store.list().length, 3, 'a later poll adds, it does not replace')
		assert.equal(store.list().find((entry) => entry.id === 'a1').title, 'First updated')
		assert.equal(store.list().find((entry) => entry.id === 'a1').read, true, 'read state survives a merge')

		const reopened = feedModule.createFeedStore({ file, now: () => clock })
		assert.equal(reopened.list().length, 3, 'the timeline survives a restart')
		assert.equal(reopened.get('a1').read, true)
		clock += 46 * 24 * 60 * 60 * 1000
		reopened.merge([])
		assert.equal(reopened.list().length, 0, 'rows older than the window are pruned')
		checks += 1
	})()
})

check(() => {
	// sources.list() persists what it fetched, and a later visit reads the
	// timeline even when every feed is offline.
	return (async () => {
		const dir = path.join(storageDir, 'sources-timeline')
		const now = 1800000000000
		let call = 0
		const fakeFetch = async () => {
			const index = call + 1
			call = index
			return {
				ok: true,
				status: 200,
				text: async () =>
					`<rss><channel><item><title>Story ${index}</title><link>https://example.org/story/${index}</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>teaser</description></item></channel></rss>`,
			}
		}
		const first = sourcesModule.createSources({ fetch: fakeFetch, dir, now: () => now, cacheMs: 10 * 60 * 1000 })
		const list = await first.list()
		assert.ok(list.items.length >= 7, 'every feed contributes a row')
		const target = list.items[0]
		assert.equal(first.markRead(target.id), true)
		assert.equal((await first.get(target.id)).read, true, 'the store answers by id')

		const offline = async () => {
			throw new Error('offline')
		}
		const second = sourcesModule.createSources({ fetch: offline, dir, now: () => now + 1000, cacheMs: 0 })
		const replayed = await second.list()
		assert.equal(replayed.items.length, list.items.length, 'the history is still there offline')
		assert.equal(replayed.items.find((row) => row.id === target.id).read, true, 'read state persisted')
		assert.ok(replayed.status.every((entry) => entry.ok === false), 'feeds are reported down')
		checks += 1
	})()
})

check(() => {
	// The timeline file is metadata only: title, URL, a short hook, dates,
	// licence and read state. Full prose is fetched on demand and never written.
	return (async () => {
		const dir = path.join(storageDir, 'metadata-only')
		const now = 1900000000000
		const body = 'Full article body word '.repeat(200)
		const feedXml = `<rss><channel><item><title>Meta only</title><link>https://example.org/meta-only</link><pubDate>${new Date(now).toUTCString()}</pubDate><description>${body}</description></item></channel></rss>`
		const pageHtml = `<html><body><main><p>${'Fetched page prose that must stay out of the timeline file. '.repeat(30)}</p></main></body></html>`
		const fakeFetch = async (url) => ({
			ok: true,
			status: 200,
			text: async () => (String(url).includes('meta-only') ? pageHtml : feedXml),
		})
		const sources = sourcesModule.createSources({ fetch: fakeFetch, dir, now: () => now, cacheMs: 10 * 60 * 1000 })
		const list = await sources.list()
		const file = path.join(dir, 'sources.json')
		const raw = fs.readFileSync(file, 'utf8')
		assert.equal(raw.includes(body), false, 'the full feed body is not persisted; only its 240-char hook')
		assert.equal(/"text"\s*:/.test(raw), false, 'no row has a text field')
		const rows = JSON.parse(raw).items
		assert.ok(rows.length > 0)
		assert.ok(rows.every((row) => String(row.summary || '').length <= 240), 'only a short summary is kept')
		const before = fs.statSync(file).size
		await sources.article(list.items[0].id)
		const after = fs.readFileSync(file, 'utf8')
		assert.equal(after.includes('Fetched page prose'), false, 'the article body is not persisted after a preview')
		assert.equal(fs.statSync(file).size, before, 'reading an article does not grow the timeline file')
		checks += 1
	})()
})

check(() => {
	// The built-in first practice is a normal saved unit: A2, 15 sentences,
	// translations, four ASK AI questions, and seeded exactly once.
	const dir = path.join(storageDir, 'first-practice-seed')
	const first = firstPractice.seedFirstPractice(dir, () => new Date('2026-11-18T00:00:00.000Z'))
	assert.equal(first, true, 'the first start seeds the exercise')
	const file = path.join(dir, 'articles', `${firstPractice.FIRST_PRACTICE_ID}.json`)
	const unit = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.equal(unit.id, firstPractice.FIRST_PRACTICE_ID)
	assert.equal(unit.cefr, 'A2')
	assert.equal(unit.sentences.length, 15)
	assert.ok(unit.sentences.every((sentence) => sentence.en !== '' && sentence.zh !== ''))
	assert.equal(unit.questions.length, 4)
	assert.ok(unit.questions.every((question) => !/插件|谁做|NASA|第一次练习/.test(question)), 'questions are not product/source meta')
	assert.ok(unit.questions.some((question) => question.includes('while')), 'questions are about the article language')
	assert.ok(unit.questions.some((question) => question.includes('agent')), 'questions quote the article vocabulary')
	assert.equal(unit.source.label, 'Fei')
	assert.equal(unit.source.license.label, 'Original')
	const words = unit.sentences.reduce((sum, sentence) => sum + sentence.en.split(/\s+/).filter(Boolean).length, 0)
	assert.equal(words, 113)
	const joined = unit.sentences.map((sentence) => sentence.en).join(' ')
	const verdict = rewrite.validateRewrite(joined, 'A2')
	assert.ok(verdict.ok, `the built-in article is A2: ${verdict.reason}`)
	assert.equal(firstPractice.seedFirstPractice(dir, () => new Date('2026-11-19T00:00:00.000Z')), false, 'the marker prevents a second seed')
	unit.questions = ['这个插件是谁做的？']
	fs.writeFileSync(file, `${JSON.stringify(unit, null, 2)}\n`)
	firstPractice.seedFirstPractice(dir, () => new Date('2026-11-19T00:00:00.000Z'))
	const refreshed = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.ok(refreshed.questions.some((question) => question.includes('while')), 'an existing built-in gets its questions refreshed')
	assert.equal(refreshed.sentences.length, 15, 'the refresh does not touch the sentences')
	fs.rmSync(file, { force: true })
	assert.equal(firstPractice.seedFirstPractice(dir, () => new Date('2026-11-20T00:00:00.000Z')), false, 'deleting it does not bring it back')
	checks += 1
})

check(() => {
	// A practice unit is one whole sentence: the split is the curriculum.
	const text =
		'In these rooms, people use hammers to break old TVs, plates, and boxes. Owners say most of their visitors are women. Too short. It costs 30 dollars per person and is very popular.'
	const sentences = article.practiceSentences(text)
	assert.ok(sentences.length >= 1)
	assert.ok(
		sentences.every((sentence) => {
			const words = sentence.split(/\s+/).filter(Boolean)
			return words.length >= article.PRACTICE_MIN_WORDS && words.length <= article.PRACTICE_MAX_WORDS
		}),
		'every practice sentence is within the 4-24 word window',
	)
	assert.ok(sentences.some((sentence) => sentence.includes('30 dollars')), 'digits are kept and printed, not typed')
	assert.deepEqual(article.splitSentences('One two. Three four! Five six?'), ['One two.', 'Three four!', 'Five six?'])
	checks += 1
})

check(() => {
	// The graded feed wraps the prose in a date, a glossary and a WordPress
	// footer. Left in, those blocks are either dropped (digits) or overwhelm the
	// article, so the whole text can collapse to one or two usable sentences.
	const cleaned = article.cleanArticleText(
		'16-11-2026 07:00 In these rooms, people break things. Difficult words: hammer (a tool), stressed (worried). The post Women pay to break things appeared first on English news.',
	)
	assert.ok(cleaned.startsWith('In these rooms'), 'the feed date is stripped')
	assert.ok(!/Difficult words/i.test(cleaned), 'the glossary is stripped')
	assert.ok(!/appeared first on/i.test(cleaned), 'the footer is stripped')

	// A long article sentence is split at a clause boundary instead of being
	// thrown away (level 2/3 articles are made of such sentences).
	const long =
		'Instead, they view it as a helpful short-term release of energy for everyone, and advise individuals dealing with deep-seated emotional pain to seek professional long-term support from a doctor or a therapist.'
	const units = article.practiceSentences(long)
	assert.ok(units.length >= 2, 'a long sentence becomes two practice units')
	assert.ok(
		units.every((unit) => {
			const words = unit.split(/\s+/).filter(Boolean)
			return words.length >= article.PRACTICE_MIN_WORDS && words.length <= article.PRACTICE_MAX_WORDS
		}),
		'each split unit is still typeable',
	)
	assert.ok(units.every((unit) => /^[A-Z].*[.!?]$/.test(unit)), 'each unit reads as a sentence')
	checks += 1
})

check(() => {
	// The article sentence is typed word by word: letters inside the box,
	// punctuation printed beside it (the learner never types it).
	const units = clientTest.sentenceUnits('Many women are visiting, "rage rooms".')
	assert.equal(units.length, 6, 'one unit per word')
	assert.equal(units[0].plain, 'many')
	assert.equal(units[0].display, 'Many')
	assert.equal(units[3].plain, 'visiting')
	assert.equal(units[3].suffix, ',')
	assert.equal(units[4].prefix, '"')
	assert.equal(units[5].plain, 'rooms')
	assert.equal(units[5].suffix, '".')
	checks += 1
})

check(() => {
	// Names, companies and places are printed, not typed. The heuristic covers
	// old articles; the model's explicit list can also mark a whole title.
	const flags = (sentence, given) => clientTest.sentenceUnits(sentence, given).map((unit) => ({ display: unit.display, given: unit.given === true }))
	assert.deepEqual(plain(flags('I met Mary in London.', [])), [
		{ display: 'I', given: false },
		{ display: 'met', given: false },
		{ display: 'Mary', given: true },
		{ display: 'in', given: false },
		{ display: 'London', given: true },
	])
	assert.deepEqual(plain(flags('We put them on Videos in Levels.', []).filter((unit) => unit.given).map((unit) => unit.display)), ['Videos', 'in', 'Levels'])
	assert.deepEqual(plain(flags('She is a girl.', []).map((unit) => unit.given)), [false, false, false, false])
	assert.deepEqual(plain(flags('I met Mary in London.', ['Mary in London']).filter((unit) => unit.given).map((unit) => unit.display)), ['Mary', 'in', 'London'])
	assert.equal(flags('I met YouTube yesterday.', [])[2].given, true, 'internal capitals are names')
	assert.deepEqual(plain(flags('I like English.', []).map((unit) => unit.given)), [false, false, false], 'languages are dictation')
	assert.deepEqual(plain(flags('I like English.', ['English']).map((unit) => unit.given)), [false, false, false], 'a model-tagged language is still typed')
	assert.deepEqual(plain(flags('We met on Monday.', []).map((unit) => unit.given)), [false, false, false, false], 'weekdays are dictation')
	assert.deepEqual(plain(flags('She watched TV.', []).map((unit) => unit.given)), [false, false, false], 'common abbreviations are dictation')
	assert.equal(flags('The UK is in Europe.', [])[1].given, true, 'countries are names')
	const numeric = clientTest.sentenceUnits('It costs 30 dollars in 2026.', [])
	assert.deepEqual(plain(numeric.filter((unit) => unit.given).map((unit) => unit.display)), ['30', '2026.'], 'Arabic numerals are printed')
	assert.equal(numeric.filter((unit) => !unit.given).length, 4, 'only words remain editable')
	assert.equal(clientTest.typingLetter({ key: 'a' }), true)
	assert.equal(clientTest.typingLetter({ key: 'Z', shiftKey: true }), true)
	assert.equal(clientTest.typingLetter({ key: ' ' }), false)
	assert.equal(clientTest.typingLetter({ key: 'Enter' }), false)
	assert.equal(clientTest.typingLetter({ key: 'Backspace' }), false)
	assert.equal(clientTest.typingLetter({ key: '1' }), false)
	assert.equal(clientTest.typingLetter({ key: ',' }), false)
	assert.equal(clientTest.typingLetter({ key: 'a', metaKey: true }), false)
	assert.equal(clientTest.typingLetter({ key: 'a', ctrlKey: true }), false)
	assert.equal(clientTest.typingLetter({ key: 'a', altKey: true }), false)
	assert.equal(clientTest.typingLetter({ key: 'a', repeat: true }), false)
	assert.equal(clientTest.typingLetter({ key: 'a', isComposing: true }), false)
	checks += 1
})

check(() => {
	// The article screen leaves a given word out of the input row entirely.
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const t = (key, vars) => client2.__test.fill(client2.__test.LOCALE_ZH[key] || key, vars)
	stateful.cursor = 0
	const tree = client2.__test.ArticleSentence({
		t,
		sentence: 'I met Mary yesterday.',
		zh: '我昨天遇见了玛丽。',
		given: ['Mary'],
		index: 0,
		total: 3,
		onNext: () => {},
		onReplay: () => {},
		onPhase: () => {},
	})
	const found = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			found.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'input') found.push('input')
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	assert.equal(found.filter((value) => value === 'input').length, 3, 'only the editable words have boxes')
	assert.ok(found.includes('Mary'), 'the name is displayed')
	const dotNodes = []
	const dotStack = [tree]
	while (dotStack.length > 0) {
		const node = dotStack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) dotStack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[1] && node.args[1].className === 'dsh-de-dot') dotNodes.push(node)
		for (const child of node.args ? node.args.slice(2) : []) dotStack.push(child)
	}
	assert.equal(dotNodes.length, 13, 'one dot per editable character (I + met + yesterday)')
	assert.equal(dotNodes.filter((node) => node.args[1]['data-hidden'] === 'true').length, 0, 'nothing is typed yet')
	checks += 1
})

check(() => {
	// Typing the article sentence: one box per word, Enter checks, a wrong word is
	// marked and a correct one moves to the next sentence on the second Enter.
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const t = (key, vars) => client2.__test.fill(client2.__test.LOCALE_ZH[key] || key, vars)
	const props = { t, sentence: 'He is happy.', zh: '他很开心。', index: 0, total: 3, onNext: () => {}, onReplay: () => {} }
	let tree = null
	const render = () => {
		stateful.cursor = 0
		tree = client2.__test.ArticleSentence(props)
	}
	const collect = (node, predicate) => {
		const found = []
		const stack = [node]
		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			if (Array.isArray(current)) {
				for (const child of current) stack.push(child)
				continue
			}
			if (typeof current === 'string') {
				if (predicate(current)) found.push(current)
				continue
			}
			if (typeof current !== 'object') continue
			if (predicate(current)) found.push(current)
			for (const child of current.args || []) stack.push(child)
		}
		return found
	}
	const inputs = () => collect(tree, (node) => Array.isArray(node.args) && node.args[0] === 'input').map((node) => node.args[1]).reverse()
	render()
	assert.equal(inputs().length, 3, 'one box per word')
	assert.ok(inputs().every((input) => input.style.textAlign === 'left'), 'an empty box keeps the caret at the first cell')
	const dots = () => collect(tree, (node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-dot')
	assert.equal(dots().length, 9, 'one dot per character of He is happy')
	assert.equal(dots().filter((node) => node.args[1]['data-hidden'] === 'true').length, 0)
	inputs()[0].onChange({ target: { value: 'He' } })
	render()
	assert.equal(dots().filter((node) => node.args[1]['data-hidden'] === 'true').length, 2, 'typing hides its dots')
	inputs()[1].onChange({ target: { value: 'is' } })
	render()
	inputs()[2].onChange({ target: { value: 'happy' } })
	render()
	assert.deepEqual(inputs().map((input) => input.value), ['He', 'is', 'happy'], 'the boxes hold the typed words')
	assert.equal(dots().filter((node) => node.args[1]['data-hidden'] === 'true').length, dots().length, 'all dots hide when the sentence is typed')

	// The focused box gets the primary underline (not only the shell's default).
	inputs()[1].onFocus()
	render()
	assert.ok(inputs()[1].style.borderBottomColor.includes('#4f6bed'), 'the focused box is underlined in the primary color')
	assert.ok(!inputs()[0].style.borderBottomColor.includes('#4f6bed'), 'the other boxes are not')

	// Alt/Option toggles the sentence audio; the typing and result screens install
	// the listener themselves so it works while focus is in a word box.
	assert.equal(clientTest.isReplayShortcut({ key: 'Alt' }), true, 'Option/Alt replays or pauses')
	assert.equal(clientTest.isReplayShortcut({ key: 'Alt', ctrlKey: true }), false, 'Ctrl+Alt is not the shortcut')
	assert.equal(clientTest.isReplayShortcut({ key: 'Alt', metaKey: true }), false)
	assert.equal(clientTest.isReplayShortcut({ key: 'Alt', shiftKey: true }), false)
	assert.equal(clientTest.isReplayShortcut({ key: 'AltGraph' }), false, 'AltGraph is a character, not Alt')
	assert.equal(clientTest.isReplayShortcut({ key: 'p', metaKey: true, shiftKey: true }), false, 'the old Command+Shift+P is gone')
	// Left/Right at the edges of a word jump to the neighbouring word.
	assert.equal(clientTest.arrowDestination({ key: 'ArrowLeft', selectionStart: 0, selectionEnd: 0 }, 5, true, true), 'previous')
	assert.equal(clientTest.arrowDestination({ key: 'ArrowRight', selectionStart: 5, selectionEnd: 5 }, 5, true, true), 'next')
	assert.equal(clientTest.arrowDestination({ key: 'ArrowLeft', selectionStart: 2, selectionEnd: 2 }, 5, true, true), null)
	assert.equal(clientTest.arrowDestination({ key: 'ArrowRight', selectionStart: 2, selectionEnd: 2 }, 5, true, true), null)
	assert.equal(clientTest.arrowDestination({ key: 'ArrowLeft', selectionStart: 0, selectionEnd: 0, shiftKey: true }, 5, true, true), null)
	assert.equal(clientTest.arrowDestination({ key: 'ArrowLeft', selectionStart: 0, selectionEnd: 0 }, 5, false, true), null)
	assert.equal(clientTest.arrowDestination({ key: 'ArrowRight', selectionStart: 5, selectionEnd: 5 }, 5, true, false), null)
	assert.equal(clientTest.arrowDestination({ key: 'ArrowLeft', selectionStart: 0, selectionEnd: 0, isComposing: true }, 5, true, true), null)
	const sentenceSource = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
	const sentenceStart = sentenceSource.indexOf('function ArticleSentence')
	const sentenceEnd = sentenceSource.indexOf('/* ───────────────────────────── Dashboard', sentenceStart)
	const sentenceBody = sentenceSource.slice(sentenceStart, sentenceEnd)
	assert.ok(sentenceBody.includes('isReplayShortcut(event)'), 'the article screen watches the shortcut')
	assert.ok(sentenceBody.includes("addEventListener('keydown', down, true)"), 'the shortcut is global in the typing phase')

	inputs()[2].onKeyDown({ key: 'Enter', preventDefault() {} })
	render()
	assert.equal(inputs().length, 0, 'the input screen is replaced by the result screen')
	assert.ok(
		collect(tree, (node) => node && node.args && node.args[1] && node.args[1].className === 'dsh-de-sentence-result').length > 0,
		'the result is its own screen',
	)
	assert.ok(collect(tree, (value) => value === 'He').length > 0, 'the result shows the words')
	assert.ok(collect(tree, (value) => value === 'happy').length > 0, 'the result shows the words')
	assert.ok(collect(tree, (value) => value === 'X1').length >= 3, 'each word carries its attempt count')
	assert.equal(clientTest.sentenceResultAction({ key: 'Enter' }), 'next')
	assert.equal(clientTest.sentenceResultAction({ key: ' ' }), 'next')
	assert.equal(clientTest.sentenceResultAction({ key: 'p' }), null)

	// The design's clock and summary numbers.
	assert.equal(clientTest.formatTimer(368000), '00:06:08')
	assert.deepEqual(plain(clientTest.durationParts(493000)), { minutes: 8, seconds: 13 })
	// The clock only advances while a sentence waits for typing on a visible page;
	// every other state dims it to 50%.
	assert.equal(clientTest.timerRunning(true, 'typing'), true)
	assert.equal(clientTest.timerRunning(false, 'typing'), false, 'a blurred/hidden page pauses it')
	assert.equal(clientTest.timerRunning(true, 'listening'), false, 'the listen gate pauses it')
	assert.equal(clientTest.timerRunning(true, 'result'), false, 'the result screen pauses it')
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('data-paused'), 'the topbar marks the paused clock')
	assert.ok(source.includes('.dsh-de-timer-wrap[data-paused="true"] { opacity: .5; }'), 'a paused clock is drawn at 50% opacity')
	// The practice clock pauses on the result page / leaving and resumes from the
	// saved value instead of restarting.
	let now = 1000
	const clock = clientTest.createTimer({ now: () => now })
	assert.equal(clock.value(), 0)
	clock.set(5000)
	assert.equal(clock.value(), 5000)
	clock.resume()
	now += 2000
	assert.equal(clock.value(), 7000)
	clock.pause()
	assert.equal(clock.value(), 7000)
	now += 5000
	assert.equal(clock.value(), 7000, 'paused time does not advance')
	clock.resume()
	now += 1000
	assert.equal(clock.value(), 8000)
	clock.pause()
	clock.set(1200)
	assert.equal(clock.value(), 1200, 'restored time is not running')
	clock.resume()
	now += 300
	assert.equal(clock.value(), 1500)


	// A wrong word gets the red state, not the whole sentence.
	const wrongState = createStatefulReact()
	const client3 = definition.factory((name) => stateful.React && name === 'react' ? wrongState.React : undefined)
	const wrongT = (key, vars) => client3.__test.fill(client3.__test.LOCALE_ZH[key] || key, vars)
	const wrongProps = { t: wrongT, sentence: 'He is happy.', zh: '他很开心。', index: 0, total: 3, onNext: () => {}, onReplay: () => {} }
	let wrongTree = null
	const renderWrong = () => {
		wrongState.cursor = 0
		wrongTree = client3.__test.ArticleSentence(wrongProps)
	}
	const wrongInputs = () => collect(wrongTree, (node) => Array.isArray(node.args) && node.args[0] === 'input').map((node) => node.args[1]).reverse()
	renderWrong()
	wrongInputs()[0].onChange({ target: { value: 'He' } })
	renderWrong()
	wrongInputs()[1].onChange({ target: { value: 'is' } })
	renderWrong()
	wrongInputs()[2].onChange({ target: { value: 'sad' } })
	renderWrong()
	wrongInputs()[2].onKeyDown({ key: 'Enter', preventDefault() {} })
	renderWrong()
	assert.equal(wrongInputs()[2]['data-state'], 'wrong', 'only the wrong word is marked')
	assert.notEqual(wrongInputs()[0]['data-state'], 'wrong')

	// Fixing the word accepts the sentence; the word that needed a retry carries
	// X2 (amber) in the result, while the untouched words stay X1 (green).
	wrongInputs()[2].onChange({ target: { value: 'happy' } })
	renderWrong()
	wrongInputs()[2].onKeyDown({ key: 'Enter', preventDefault() {} })
	renderWrong()
	assert.ok(collect(wrongTree, (value) => value === 'X2').length > 0, 'the retried word is X2')
	assert.ok(collect(wrongTree, (value) => value === 'happy').length > 0, 'the result shows the correct word')
	checks += 1
})

check(() => {
	// Reopening a sentence whose result was already shown restores that result
	// page, with its attempt counts, instead of the typing screen.
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const t = (key, vars) => client2.__test.fill(client2.__test.LOCALE_ZH[key] || key, vars)
	stateful.cursor = 0
	const tree = client2.__test.ArticleSentence({
		t,
		sentence: 'He is happy.',
		zh: '他很开心。',
		index: 1,
		total: 3,
		onNext: () => {},
		onResult: () => {},
		onReplay: () => {},
		onPhase: () => {},
		resumeResult: {
			index: 1,
			en: 'He is happy.',
			zh: '他很开心。',
			words: [
				{ raw: 'He', display: 'He', plain: 'he', prefix: '', suffix: '', given: false, attempts: 1 },
				{ raw: 'is', display: 'is', plain: 'is', prefix: '', suffix: '', given: false, attempts: 1 },
				{ raw: 'happy.', display: 'happy', plain: 'happy', prefix: '', suffix: '.', given: false, attempts: 3 },
			],
		},
	})
	const texts = []
	let inputs = 0
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			texts.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'input') inputs += 1
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	assert.equal(inputs, 0, 'the restored result has no input boxes')
	assert.ok(texts.includes('X3'), 'the attempt count is restored')
	assert.ok(texts.includes('happy'), 'the correct word is shown')
	assert.ok(texts.includes('他很开心。'), 'the translation is shown')
	checks += 1
})

check(() => {
	// A remount (sidebar/window switch) restores the typed draft in place.
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const t = (key, vars) => client2.__test.fill(client2.__test.LOCALE_ZH[key] || key, vars)
	stateful.cursor = 0
	const tree = client2.__test.ArticleSentence({
		t,
		sentence: 'He is happy.',
		zh: '他很开心。',
		index: 0,
		total: 2,
		unitId: 'unit-1',
		draft: {
			unitId: 'unit-1',
			index: 0,
			answers: ['He', 'is', 'happy'],
			wrong: [false, false, false],
			attempts: [1, 2, 3],
			mark: '',
			focusIndex: 2,
		},
		onNext: () => {},
		onResult: () => {},
		onReplay: () => {},
		onPhase: () => {},
		onDraft: () => {},
	})
	const values = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'input') values.push(node.args[1].value)
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	assert.deepEqual(plain(values.reverse()), ['He', 'is', 'happy'], 'the typed words come back')
	checks += 1
})

check(() => {
	// The article screen itself lives outside React so a panel/window remount
	// restores it; losing window focus only pauses the clock.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('let articleMemory = null'), 'article state is kept outside React')
	assert.ok(source.includes('handleSentenceDraft'), 'the typed draft is mirrored into that memory')
	assert.ok(source.includes("window.addEventListener('blur'"), 'window blur pauses the practice clock')
	assert.ok(source.includes('restoredDraft'), 'the sentence restores its draft')
	checks += 1
})

check(() => {
	// One content column for every screen, matching the DSH plugin list page.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('--de-page-inset: clamp(24px, 4vw, 48px);'), 'the page inset matches the plugin manager')
	assert.ok(source.includes('--de-page-max: 960px;'), 'the page column matches the plugin manager width')
	for (const selector of ['.dsh-de-wrap', '.dsh-de-homewrap', '.dsh-de-addwrap']) {
		const start = source.indexOf(`${selector} {`)
		assert.ok(start > 0, `${selector} exists`)
		const rule = source.slice(start, source.indexOf('}', start))
		assert.ok(rule.includes('max-width: calc(var(--de-page-max) + 2 * var(--de-page-inset))'), `${selector} caps its content at the shared column`)
		assert.ok(rule.includes('var(--de-page-inset)'), `${selector} uses the shared inset`)
	}
	// The practice page is exempt: its bar/footer are full-bleed (as before the
	// column change) and only its centred sentence column is capped.
	const topbar = source.slice(source.indexOf('.dsh-de-topbar {'), source.indexOf('}', source.indexOf('.dsh-de-topbar {')))
	assert.equal(topbar.includes('max-width'), false, 'the practice topbar spans the panel')
	const footer = source.slice(source.indexOf('.dsh-de-practice-footer {'), source.indexOf('}', source.indexOf('.dsh-de-practice-footer {')))
	assert.equal(footer.includes('max-width'), false, 'the practice footer spans the panel')
	assert.ok(source.includes('.dsh-de-center {\n\tposition: relative; width: 100%; max-width: 780px;'), 'the sentence column keeps its readable width')
	assert.ok(source.includes('.dsh-de-summary-inner { width: 82%; min-width: 360px; max-width: 900px;'), 'the summary keeps its wide reading column')
	checks += 1
})

check(() => {
	// Menus are icon-studio surfaces and behave like real context menus: they
	// hang below the row, close on an outside press, and hold the row still.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('.dsh-de-menu-row { position: static; }'), 'a row menu anchors to the row')
	assert.ok(source.includes("document.addEventListener('pointerdown', closeOpenMenus, true)"), 'an outside press closes the menu')
	assert.ok(source.includes("document.querySelectorAll('details.dsh-de-menu[open]')"), 'every open menu is considered')
	assert.ok(source.includes('box-shadow: 0 10px 28px rgba(0,0,0,.28);'), 'the panel uses the icon-studio shadow')
	assert.ok(source.includes('border-radius: 9px;'), 'the panel uses the icon-studio radius')
	assert.ok(source.includes('height: 28px; padding: 0 8px; box-sizing: border-box;'), 'menu rows match icon-studio')
	checks += 1
})

check(() => {
	// Refresh means refresh: the button asks the Host to bypass the ten-minute
	// list cache, while merely opening the add page keeps it.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes("sources: (force) => request(force === true ? '/sources?force=1' : '/sources')"), 'the client can force')
	assert.ok(source.includes('reloadSources(true)'), 'the refresh button forces')
	assert.ok(source.includes('await api.sources(force === true)'), 'the reload passes the flag')
	const host = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(host.includes("url.searchParams.get('force') === '1'"), 'the route understands force=1')
	assert.ok(host.includes('sources.list({ force:'), 'the route hands it to the source layer')
	checks += 1
})

check(() => {
	// DSH's light theme resolves bg-layer-2 to plain white; a card filled from it
	// would disappear. Every subtle fill therefore uses our own text-colour tint.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('--de-fill: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 7%, transparent);'), 'the shared subtle fill is theme-safe')
	assert.ok(source.includes('--de-fill-strong: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 12%, transparent);'), 'tracks get a stronger tint')
	assert.ok(source.includes('border-radius: 10px; background: var(--de-fill, #f0f0f0);'), 'the stat cards use it')
	assert.equal(source.includes('dsw-alias-bg-layer-2'), false, 'no fill depends on the white-in-light token')
	checks += 1
})

check(() => {
	// Pointing at a row keeps it at full strength and dims every other row by the
	// same amount: a local highlight with no movement.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('.dsh-de-exlist:has(.dsh-de-exrow:hover) .dsh-de-exrow:not(:hover)'), 'the pointed row highlights')
	assert.ok(source.includes('.dsh-de-exlist:focus-within .dsh-de-exrow:not(:focus-within)'), 'keyboard focus highlights too')
	assert.ok(source.includes('{ opacity: .45; }'), 'the other rows dim uniformly')
	assert.ok(source.includes(':not(:has(.dsh-de-menu[open]))'), 'an open menu keeps its row — and itself — opaque')
	assert.ok(source.includes('transition: opacity .16s ease;'), 'the dim is animated')
	assert.equal(source.includes('fishEyeScale'), false, 'the lens is gone')
	assert.equal(source.includes('onMouseMove: trackLens'), false, 'the list no longer tracks the pointer')
	assert.equal(source.includes('scale(1.06)'), false, 'the rows no longer scale')
	checks += 1
})


check(() => {
	// The home is the design's first screen: five counters, then every exercise
	// as a row (level badge, title, progress, open, menu).
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const collect = (tree) => {
		const texts = []
		const nodes = []
		const stack = [tree]
		while (stack.length > 0) {
			const node = stack.pop()
			if (!node) continue
			if (Array.isArray(node)) {
				for (const child of node) stack.push(child)
				continue
			}
			if (typeof node === 'string') {
				texts.push(node)
				continue
			}
			if (typeof node !== 'object') continue
			nodes.push(node)
			for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
		}
		return { texts, nodes }
	}
	const exercises = [
		{ id: 'a1', title: 'Are squishy toys safe?', cefr: 'A2', sentences: 6, started: true, phase: 'typing', current: 1, elapsedMs: 198000 },
		{ id: 'a2', title: 'A done article', cefr: 'B1', sentences: 6, started: true, phase: 'done', current: 6, elapsedMs: 198000, score: { value: 88, comprehension: 77, listenFactor: 0.77, band: 'good' } },
	]
	const summary = { articles: 2, started: 2, done: 1, elapsedMs: 8.1 * 3600000, vocabulary: 200, accuracy: 50, listening: 77, dictation: 88 }
	const tree = clientTest.Home({ t, data: { streak: 40, totals: { minutes: 0 }, runs: [] }, savedArticles: exercises, summary })
	const { texts } = collect(tree)
	for (const label of ['累计耗时', '听写文章', '平均得分', '词汇覆盖', '连续坚持']) {
		assert.ok(texts.includes(label), `the home shows the ${label} counter`)
	}
	assert.ok(texts.includes('8.1'), 'total time is rendered in hours once past an hour')
	assert.ok(texts.includes('h'), 'the hour unit is its own element')
	assert.ok(texts.includes('88') && texts.includes('200') && texts.includes('40'), 'dictation score, coverage and streak are all shown')
	assert.ok(texts.includes('练习(2)'), 'the exercise count is the list length')
	assert.ok(texts.includes('Are squishy toys safe?'), 'the graded suffix is stripped from the title')
	assert.ok(texts.includes('1/6'), 'a row shows where the reader stopped')
	assert.ok(texts.includes('6/6'), 'a finished row shows full progress')
	const status = collect(tree).nodes.find((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-exstatus')
	assert.ok(status, 'every row has one status group')
	assert.ok(texts.includes('88'), 'a finished row shows its saved score')
	assert.ok(texts.includes('进行中'), 'a started row says in progress')
	// level badges: one per row, coloured by level
	const badges = collect(tree).nodes.filter((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-level')
	assert.equal(badges.length, 2, 'one level badge per exercise')
	assert.deepEqual(badges.map((node) => node.args[2]).sort(), ['A2', 'B1'], 'the badge prints the CEFR level')
	assert.deepEqual(badges.map((node) => node.args[1]['data-band']).sort(), ['A', 'B'], 'the badge colour follows the band')
	assert.equal(clientTest.exerciseCefr({ title: 'Old – level 3' }), 'B2', 'legacy units fall back to a CEFR guess')
	assert.equal(clientTest.exerciseCefr({ title: 'Old – level 1' }), 'A2')

	// the open button opens that exercise, and the menu restarts it
	const clicks = { opened: '', removed: '', added: 0 }
	const live = clientTest.Home({
		t,
		data: { streak: 0, totals: { minutes: 0 }, runs: [] },
		savedArticles: exercises,
		summary: null,
		onOpenSaved: (id) => {
			clicks.opened = id
		},
		onRemoveSaved: (id) => {
			clicks.removed = id
		},
		onAddExercise: () => {
			clicks.added += 1
		},
	})
	const buttons = []
	const stack = [live]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'button') buttons.push({ props: node.args[1] || {}, children: node.args[2] })
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	const add = buttons.find((button) => button.props.className === 'dsh-de-addbtn')
	assert.ok(add, 'the header offers add an exercise')
	add.props.onClick()
	assert.equal(clicks.added, 1, 'the add button reaches the add page')
	const open = buttons.filter((button) => button.props.className === 'dsh-de-rowgo')
	assert.equal(open.length, 2, 'every row has an open button')
	const openedRows = []
	const liveWithIds = clientTest.Home({
		t,
		data: { streak: 0, totals: { minutes: 0 }, runs: [] },
		savedArticles: exercises,
		summary: null,
		onOpenSaved: (id) => openedRows.push(id),
	})
	const liveButtons = []
	const liveStack = [liveWithIds]
	while (liveStack.length > 0) {
		const node = liveStack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) liveStack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'button') liveButtons.push({ props: node.args[1] || {}, children: node.args[2] })
		for (const child of node.args ? node.args.slice(2) : []) liveStack.push(child)
	}
	const liveOpen = liveButtons.filter((button) => button.props.className === 'dsh-de-rowgo')
	liveOpen.forEach((button) => button.props.onClick())
	assert.deepEqual(openedRows.sort(), ['a1', 'a2'], 'each row opens its own exercise')
	// removal is the only row-menu action now
	const rowMenuItems = collect(live).nodes.filter((node) => node.args && node.args[1] && String(node.args[1].className).startsWith('dsh-de-menu-item'))
	assert.equal(rowMenuItems.length, 2, 'one menu item per exercise')
	assert.ok(rowMenuItems.every((node) => node.args[2] === t('home.remove')), 'the restart action is gone')
	assert.ok(rowMenuItems.every((node) => String(node.args[1].className).includes('dsh-de-menu-item-danger')), 'removal is destructive')
	const remove = rowMenuItems[0]
	assert.ok(remove, 'the row menu offers removal')
	remove.args[1].onClick({ currentTarget: null })
	assert.ok(['a1', 'a2'].includes(clicks.removed), 'removal asks the page to archive that exercise')
	checks += 1
})

check(() => {
	// Removed exercises keep their source/meta, and the archive can regenerate.
	const dir = path.join(storageDir, 'archive-store')
	const store = archiveModule.createArchive({ dir, now: () => new Date('2026-11-18T00:00:00.000Z') })
	const unit = {
		id: 'abcdef123456',
		title: 'An archived article',
		cefr: 'A2',
		link: '',
		source: { provider: 'nasa', label: 'NASA', url: 'https://example.org/article', license: { id: 'pd', label: 'Public domain' }, title: 'The source article' },
		publishedAt: '2026-11-01T00:00:00.000Z',
		generatedAt: '2026-11-02T00:00:00.000Z',
		sentences: [{ en: 'A short sentence.' }, { en: 'Another short sentence.' }],
		questions: ['What is this?'],
	}
	const record = store.save(unit)
	assert.equal(record.id, 'abcdef123456')
	assert.equal(record.cefr, 'A2')
	assert.equal(record.sourceUrl, 'https://example.org/article')
	assert.equal(record.sentences, 2)
	assert.equal(record.words, 6)
	assert.equal(record.builtin, false)
	assert.equal(record.removedAt, '2026-11-18T00:00:00.000Z')
	assert.equal(store.list().length, 1)
	assert.equal(store.get('abcdef123456').title, 'An archived article')
	assert.equal(store.remove('abcdef123456'), true)
	assert.equal(store.get('abcdef123456'), null)
	const rewritten = archiveModule.withArchivedSource(
		{ provider: 'custom', source: 'example.org', url: 'https://example.org/article', title: 'Fetched title', license: { id: 'unknown', label: 'Unknown' } },
		record,
	)
	assert.equal(rewritten.provider, 'nasa')
	assert.equal(rewritten.source, 'NASA')
	assert.equal(rewritten.title, 'The source article')
	assert.equal(rewritten.license.label, 'Public domain')
	checks += 1
})

check(() => {
	// The archive page lists removed exercises and offers regeneration.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const archived = [
		{ id: 'abcdef123456', title: 'An archived article', cefr: 'A2', source: { label: 'NASA' }, sourceUrl: 'https://example.org/article', removedAt: '2026-11-18T00:00:00.000Z', builtin: false },
	]
	let regenerated = ''
	const tree = clientTest.Archive({
		data: { runs: [], profile: { tags: {} }, totals: { runs: 0, sentences: 0, minutes: 0 } },
		t,
		archived,
		busyId: '',
		onRegenerate: (id) => {
			regenerated = id
		},
		onBack: () => {},
	})
	const nodes = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		nodes.push(node)
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	const button = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[2] === t('archive.regenerate'))
	assert.ok(button, 'the archive offers a regenerate button')
	button.args[1].onClick()
	assert.equal(regenerated, 'abcdef123456', 'regenerate asks for that archived id')
	assert.ok(JSON.stringify(tree).includes('An archived article'), 'the archived title is listed')
	const empty = clientTest.Archive({ data: { runs: [], profile: { tags: {} }, totals: { runs: 0, sentences: 0, minutes: 0 } }, t, archived: [], onBack: () => {} })
	assert.ok(JSON.stringify(empty).includes(t('archive.noRemoved')), 'an empty archive says so')
	checks += 1
})

check(() => {
	// An empty book says so instead of rendering an empty list.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const tree = clientTest.Home({ t, data: null, savedArticles: [], summary: null })
	assert.ok(JSON.stringify(tree).includes(t('home.empty')), 'an empty book explains how to add one')
	assert.ok(JSON.stringify(tree).includes(t('home.exercises').replace('{n}', '0')), 'the count is zero, not hidden')
	checks += 1
})

check(() => {
	// The counters fall back to the list itself when the Host sends no summary,
	// so a page talking to an older Host still shows numbers.
	const stats = clientTest.homeStats(
		{ streak: 3, totals: { minutes: 2 }, runs: [{ sentences: 10, accuracy: 80 }, { sentences: 10, accuracy: 60 }] },
		[
			{ started: true, elapsedMs: 60000 },
			{ started: false, elapsedMs: 0 },
		],
		null,
	)
	assert.equal(stats.articles, 1, 'only started exercises count')
	assert.equal(stats.elapsedMs, 60000 + 120000, 'list time plus the legacy profile minutes')
	assert.equal(stats.accuracy, 70, 'accuracy is weighted by sentence count')
	assert.equal(stats.streak, 3)
	assert.equal(clientTest.timeStatOf(8.1 * 3600000).value, '8.1', 'past an hour the value is hours')
	assert.equal(clientTest.timeStatOf(8.1 * 3600000).unitKey, 'home.unitHour')
	assert.equal(clientTest.timeStatOf(30 * 60000).unitKey, 'home.unitMinute', 'under an hour it stays minutes')
	checks += 1
})

check(() => {
	// The add page is a time-ordered list plus a topic filter. The level is not a
	// page filter: the plus opens the dialog, and the row only becomes a check
	// once that article is in the book at some level.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const now = Date.now()
	const items = Array.from({ length: clientTest.ADD_PAGE_SIZE + 4 }, (_, index) => ({
		id: `id${index}`,
		source: index % 3 === 0 ? 'NASA' : index % 3 === 1 ? 'WHO' : 'NOAA',
		provider: index % 3 === 0 ? 'nasa' : index % 3 === 1 ? 'who' : 'noaa',
		read: index % 2 === 0,
		topic: index % 3 === 0 ? 'science' : index % 3 === 1 ? 'health' : 'environment',
		title: `Source story ${index}`,
		url: `https://example.org/source/${index}`,
		publishedAt: new Date(now - index * 3600000).toUTCString(),
		license: { id: 'cc-by-4.0', label: 'CC BY 4.0' },
		attribution: { label: 'Example', url: 'https://example.org' },
	}))
	const added = []
	const topics = []
	const status = [
		{ id: 'nasa', label: 'NASA', ok: true, count: 4 },
		{ id: 'who', label: 'WHO', ok: true, count: 4 },
		{ id: 'frontiers', label: 'Frontiers', ok: false, count: 0, error: 'timeout' },
	]
	const tree = clientTest.AddExercise({
		t,
		items,
		status,
		savedArticles: [
			{ id: 'saved1', title: 'WHO story', cefr: 'A2', source: { url: 'https://example.org/source/1', label: 'WHO' } },
			{ id: 'id2', title: 'By id', cefr: 'B2' },
		],
		myLevel: 'B1',
		topic: 'all',
		busyId: '',
		notice: '',
		refreshing: false,
		onAdd: (item, level) => added.push(`${item.id}:${level}`),
		onTopic: (topic) => topics.push(topic),
		onBack: () => {},
		onRefresh: () => {},
	})
	const collect = (root) => {
		const nodes = []
		const texts = []
		const stack = [root]
		while (stack.length > 0) {
			const node = stack.pop()
			if (!node) continue
			if (Array.isArray(node)) {
				for (const child of node) stack.push(child)
				continue
			}
			if (typeof node === 'string') {
				texts.push(node)
				continue
			}
			if (typeof node !== 'object') continue
			nodes.push(node)
			for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
		}
		return { nodes, texts }
	}
	const { nodes, texts } = collect(tree)
	const rows = nodes.filter((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-addrow')
	assert.equal(rows.length, clientTest.ADD_PAGE_SIZE, 'the first page is ADD_PAGE_SIZE rows')
	assert.ok(texts.includes('Source story 0'), 'a row shows the title')
	assert.equal(texts.includes('NASA'), false, 'the grey meta no longer repeats the source; the favicon names it')
	assert.ok(texts.includes('科学'), 'a row shows its topic label')
	assert.ok(texts.some((line) => /小时前|天前|分钟前/.test(line)), 'a row shows how old the article is')
	// No page-level level selector anymore.
	const segButtons = nodes.filter((node) => node.args && node.args[1] && node.args[1].className && String(node.args[1].className).startsWith('dsh-de-segbtn'))
	assert.equal(segButtons.length, 0, 'the level lives in the dialog, not on the page')
	// Topic chips still filter the list.
	const chips = nodes.filter((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className && String(node.args[1].className).startsWith('dsh-de-chip'))
	assert.equal(chips.length, 7, 'all + the six fixed topics are offered')
	const health = chips.find((node) => node.args[2] === '健康')
	health.args[1].onClick()
	assert.deepEqual(topics, ['health'], 'choosing a topic reaches the page')
	// A row already in the book shows a check at the level it was added.
	const done = nodes.filter((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-adddone')
	assert.equal(done.length, 2, 'saved rows show a check, by URL and by the URL-hash id')
	assert.ok(done.some((node) => node.args[1].title === t('add.addedAt', { level: 'A2' })), 'the URL match names its level')
	assert.ok(done.some((node) => node.args[1].title === t('add.addedAt', { level: 'B2' })), 'the id match names its level')
	// The plus opens the dialog; it must not add anything by itself.
	const plus = nodes.filter((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className && String(node.args[1].className).startsWith('dsh-de-addcircle'))
	assert.equal(plus.length, clientTest.ADD_PAGE_SIZE - 2, 'rows already in the book replace the plus with a check')
	assert.equal(plus[0].args[1].title, t('add.chooseLevel'), 'the plus announces the level dialog')
	const iconNodes = nodes.filter((node) => node.args && node.args[0] === clientTest.SourceIcon)
	assert.ok(iconNodes.length > 0, 'each row gets a source mark')
	const unreadDots = nodes.filter((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-unread')
	assert.ok(unreadDots.length > 0, 'unread rows carry a dot')
	const searchInput = nodes.find((node) => node.args && node.args[0] === 'input' && node.args[1] && node.args[1].className === 'dsh-de-searchinput')
	assert.ok(searchInput, 'the list has a search / custom-URL input')
	assert.equal(searchInput.args[1].value, '')
	const openLinks = nodes.filter((node) => node.args && node.args[0] === 'a' && node.args[1] && node.args[1].className === 'dsh-de-openlink')
	assert.ok(openLinks.length > 0, 'each row has an open-original link')
	assert.ok(openLinks.every((node) => /^https:\/\//.test(node.args[1].href)), 'the link points at the article URL')
	assert.ok(openLinks.every((node) => node.args[1].target === '_blank'), 'it opens in a new tab')
	assert.ok(rows.some((node) => node.args[1]['data-read'] === 'true'), 'read rows are marked')
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('.dsh-de-addrow[data-read="true"] .dsh-de-addrow-title'), 'read rows recede')
	assert.ok(source.includes('const generatedQuestions = unit && Array.isArray(unit.questions)'), 'the coach uses the generated questions')
	assert.ok(source.includes("showToast(t('add.failedLevel', { level }), 'warning')"), 'add failures go through the toast')
	assert.ok(iconNodes.every((node) => typeof node.args[1].provider === 'string' && node.args[1].provider !== ''), 'the mark knows its provider id')
	plus[0].args[1].onClick()
	assert.equal(added.length, 0, 'the plus asks for a level before generating')
	// Source health line.
	assert.ok(texts.some((line) => line.includes('个源')), 'the page says how many sources answered')
	assert.equal(texts.some((line) => /\d+ 条/.test(line)), false, 'the article count is not shown; it was never exact')
	assert.ok(texts.some((line) => line.includes('1 个源暂不可用')), 'a dead source is named in the count, not thrown')
	// Loading more.
	const more = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-addmore')
	assert.ok(more, 'the list offers loading more while articles remain')
	checks += 1
})

check(() => {
	// The toast is a shell-level surface with its own tiny store: showing one
	// replaces the previous line, a success carries the check tone, and dismissal
	// clears it (the timer is cleared with it, so a test process can exit).
	clientTest.dismissToast()
	assert.equal(clientTest.toastSnapshot().text, '', 'no toast by default')
	clientTest.showToast('已加入练习簿：A new park（B1）', 'success')
	const shown = clientTest.toastSnapshot()
	assert.equal(shown.text, '已加入练习簿：A new park（B1）')
	assert.equal(shown.tone, 'success')
	clientTest.showToast('加不进来', 'warning')
	assert.equal(clientTest.toastSnapshot().tone, 'warning', 'errors use the warning tone')
	clientTest.showToast('已加入练习簿：A new park（B1）', 'success')
	const Toast = clientTest.makeToast()
	const tree = Toast()
	const stack = [tree]
	let text = ''
	let className = ''
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			text += node
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[1] && node.args[1].className === 'dsh-de-toast') {
			className = node.args[1].className
			assert.equal(node.args[1]['data-tone'], 'success')
			assert.equal(node.args[1].role, 'status')
		}
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	assert.equal(className, 'dsh-de-toast')
	assert.ok(text.includes('已加入练习簿：A new park（B1）'), 'the toast prints the localized line')
	clientTest.showToast('second', 'plain')
	assert.equal(clientTest.toastSnapshot().text, 'second', 'a new toast replaces the old one')
	clientTest.dismissToast()
	assert.equal(clientTest.toastSnapshot().text, '')
	checks += 1
})

check(() => {
	// The dictation page's topbar prints the same CEFR level as the home and the
	// summary: the old "L1/L2/L3" badge must not survive anywhere.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const start = source.indexOf("if (view === 'sentences' && sentenceUnit)")
	const end = source.indexOf("if (view === 'summary' && sentenceUnit)", start)
	assert.ok(start > 0 && end > start, 'the sentence page is findable')
	const body = source.slice(start, end)
	assert.ok(body.includes('exerciseCefr(sentenceUnit)'), 'the sentence topbar derives the CEFR level')
	assert.equal(body.includes('L${level}'), false, 'no legacy L-number badge remains')
	assert.equal(source.includes('`L${level}`'), false, 'no legacy badge anywhere in the bundle')
	checks += 1
})

check(() => {
	// The practice page breathes with the spoken sentence: a bottom glow exists
	// only while the TTS is speaking, and it is drawn from analyser levels.
	const fakeTts = {
		subscribe: () => () => {},
		isSpeaking: () => false,
		analyser: () => null,
	}
	const tree = clientTest.SoundGlow({ tts: fakeTts })
	assert.equal(tree.args[1].className, 'dsh-de-glow', 'the glow starts hidden')
	const spans = tree.args.slice(2).filter((child) => child && child.args && child.args[0] === 'span')
	assert.equal(spans.length, 4, 'four colour fields make the gradient')
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('.dsh-de-glow {\n\tposition: absolute;'), 'the glow is anchored to the page bottom')
	assert.ok(source.includes('pointer-events: none;'), 'the glow never steals a click')
	assert.ok(source.includes('mask-image: linear-gradient(to top, #000 0%, #000 52%, transparent 96%);'), 'the clipped top edge fades out instead of cutting')
	assert.ok(source.includes('--de-glow-a: #a365f2;') && source.includes('--de-glow-b: #45ceb1;') && source.includes('--de-glow-c: #dacf5c;'), 'the three seed colours')
	assert.ok(source.includes('color-mix(in srgb, var(--de-glow-a) 90%, transparent)'), 'the layers mix from the seeds')
	assert.ok(source.includes('color-mix(in srgb, var(--de-glow-c) 65%, transparent)'), 'the yellow layer is in the mix')
	assert.ok(source.includes('linear-gradient(\n\t\t90deg,\n\t\tcolor-mix(in srgb, var(--de-glow-a) 26%, transparent)'), 'a horizontal band blends all three seeds')
	assert.ok(source.includes('@keyframes dsh-de-glow-a'), 'the fields drift on their own clock')
	assert.ok(source.includes('h(SoundGlow, { key: \'sound-glow\', tts })'), 'the sentences page mounts the glow')
	assert.ok(source.includes('--de-glow'), 'the analyser drives the glow through a CSS variable')
	assert.ok(source.includes('prefers-reduced-motion: reduce') && source.includes('.dsh-de-glow span { animation: none'), 'reduced motion stills the glow')
	const tts = clientTest.createTts({
		synth: { getVoices: () => [{ name: 'Samantha', lang: 'en-US' }], speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} },
		SpeechUtterance: function Utterance(text) { this.text = text },
	})
	assert.equal(typeof tts.analyser, 'function', 'TTS exposes an analyser')
	assert.equal(tts.analyser(), null, 'no player means no analyser')
	assert.equal(typeof tts.isSpeaking, 'function')
	checks += 1
})

check(() => {
	// The search box decides between a title search and a custom article URL.
	assert.equal(clientTest.isHttpUrl('https://example.org/article'), true)
	assert.equal(clientTest.isHttpUrl('http://example.org'), true)
	assert.equal(clientTest.isHttpUrl('ftp://example.org/x'), false)
	assert.equal(clientTest.isHttpUrl('http://127.0.0.1/x'), true, 'the client only recognises a URL; the Host rejects private hosts')
	assert.equal(clientTest.isHttpUrl('plain words'), false)
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes("className: 'dsh-de-searchinput'"), 'the input is in the list')
	assert.ok(source.includes("const ADD_TOPICS = ['science', 'environment', 'technology', 'health', 'society', 'psychology']"), 'the topic bar is fixed')
	assert.ok(source.includes("className: 'dsh-de-skrow'"), 'loading renders skeleton rows')
	assert.ok(source.includes('ADD_SKELETON_ROWS = 8'), 'the skeleton has a stable row count')
	assert.ok(source.includes("t('add.refreshAdded', { n: added })"), 'refresh reports how many rows arrived')
	assert.ok(source.includes("t('add.refreshNoChange')"), 'refresh reports a no-op too')
	const hostSource = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(hostSource.includes('added: payload.added || 0'), 'the route reports how many rows were new')
	assert.ok(source.includes('props.onIngestUrl(target)'), 'a pasted URL goes to the Host ingest route')
	checks += 1
})

check(() => {
	// Every exercise can be traced back: the practice and summary titles carry a
	// small link to the original article in a new tab.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const link = clientTest.SourceLink({ url: 'https://example.org/article', t })
	assert.equal(link.args[0], 'a')
	assert.equal(link.args[1].href, 'https://example.org/article')
	assert.equal(link.args[1].target, '_blank')
	assert.ok(String(link.args[1].rel).includes('noopener'))
	assert.equal(link.args[1].title, '查看原文（新标签页）')
	assert.equal(clientTest.SourceLink({ url: '', t }), null, 'an exercise without a source URL has no link')
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes("url: (sentenceUnit.source && sentenceUnit.source.url) || sentenceUnit.link || ''"), 'the sentence title uses the stored source URL')
	assert.ok(source.includes("url: (unit && unit.source && unit.source.url) || (unit && unit.link) || ''"), 'the summary title uses the stored source URL')
	checks += 1
})

check(() => {
	// The source mark: a same-origin favicon image, or a lettered square when
	// the provider id is unknown (or the image fails to load).
	const image = clientTest.SourceIcon({ provider: 'nasa', label: 'NASA' })
	assert.equal(image.args[0], 'img', 'a known provider renders an image')
	assert.equal(image.args[1].className, 'dsh-de-addico')
	assert.ok(String(image.args[1].src).endsWith('/favicon?provider=nasa'), 'the image points at the Host route')
	assert.equal(image.args[1].alt, '', 'the mark is decorative; the label still names the source')
	const fallback = clientTest.SourceIcon({ provider: '', label: 'NASA' })
	assert.equal(fallback.args[0], 'span', 'no provider renders the fallback square')
	assert.equal(fallback.args[1].className, 'dsh-de-addico dsh-de-addico-fallback')
	assert.equal(fallback.args[2], 'N', 'the fallback carries the source initial')
	checks += 1
})

check(() => {
	// Voice settings are a modal now, sharing the level dialog's surface.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const tts = {
		englishVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
		checkCloud: async () => true,
		engine: () => 'cloud',
		cloudVoice: () => 'stella',
		cloudReady: () => true,
		voiceName: () => 'Samantha',
	}
	let closed = 0
	const updates = []
	const tree = clientTest.VoicePanel({
		t,
		tts,
		ttsVersion: 0,
		settings: { engine: 'cloud', cloudVoice: 'stella', rate: 1 },
		updateSettings: (patch) => updates.push(patch),
		onPreview: () => {},
		onClose: () => {
			closed += 1
		},
		dialog: true,
	})
	const nodes = []
	const texts = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			texts.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		nodes.push(node)
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	assert.ok(nodes.some((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-modal'), 'voice settings are a modal')
	assert.ok(nodes.some((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-dialog dsh-de-voicedialog'), 'the modal has its own panel')
	assert.ok(texts.includes('语音设置'), 'the modal is titled')
	assert.ok(texts.includes('发音来源'), 'voice source labels are inside')
	const select = nodes.find((node) => node.args && node.args[0] === 'select')
	assert.ok(select, 'Edge and local voices share one dropdown')
	assert.equal(select.args[1].value, 'cloud:stella')
	assert.equal(select.args[1].disabled, false)
	const groups = nodes.filter((node) => node.args && node.args[0] === 'optgroup').map((node) => node.args[1].label)
	assert.deepEqual(plain(groups).sort(), ['Edge 语音（在线）', '系统语音'].sort())
	const options = nodes.filter((node) => node.args && node.args[0] === 'option').map((node) => node.args[1].value)
	assert.deepEqual(plain(options).sort(), ['cloud:stella', 'cloud:tide', 'system:Samantha'].sort())
	select.args[1].onChange({ target: { value: 'system:Samantha' } })
	assert.deepEqual(plain(updates[0]), { engine: 'system', voiceName: 'Samantha' }, 'picking a local voice switches the engine')
	assert.equal(nodes.some((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-card'), false, 'it is not the inline card')
	const close = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-dialog-close')
	close.args[1].onClick()
	assert.equal(closed, 1, 'the close button closes the modal')
	const confirm = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-dialog-go')
	assert.ok(confirm, 'the footer has a confirm button')
	confirm.args[1].onClick()
	assert.equal(closed, 2, 'confirm also closes the modal')
	checks += 1
})

check(() => {
	// With no Edge TTS and no system voice the dropdown and preview are disabled:
	// there is nothing to select.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const tts = {
		englishVoices: () => [],
		checkCloud: async () => false,
		engine: () => 'cloud',
		cloudVoice: () => 'stella',
		cloudReady: () => false,
		voiceName: () => '',
	}
	const tree = clientTest.VoicePanel({
		t,
		tts,
		ttsVersion: 0,
		settings: { engine: 'cloud', cloudVoice: 'stella', rate: 1 },
		updateSettings: () => {},
		onPreview: () => {},
		onClose: () => {},
		dialog: true,
	})
	const nodes = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		nodes.push(node)
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	const select = nodes.find((node) => node.args && node.args[0] === 'select')
	assert.equal(select.args[1].disabled, true, 'no source means no choice')
	const options = nodes.filter((node) => node.args && node.args[0] === 'option')
	assert.ok(options.some((node) => node.args[1].value === '' && node.args[1].disabled === true), 'a placeholder names the empty state')
	const preview = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-secondary')
	assert.equal(preview.args[1].disabled, true, 'preview is disabled too')
	checks += 1
})

check(() => {
	// The dialog: article card, one vertical level list, definition, footer.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const item = {
		id: 'id1',
		title: 'A telescope story',
		summary: 'The AVATAR investigation will look at how tissue reacts in space.',
		source: 'NASA',
		provider: 'nasa',
		url: 'https://science.nasa.gov/telescope',
	}
	const seen = { level: '', confirmed: '', cancelled: 0 }
	const tree = clientTest.LevelDialog({
		t,
		item,
		value: 'B1',
		myLevel: 'B1',
		busy: false,
		modelName: 'deepseek-flash',
		onChange: (level) => {
			seen.level = level
		},
		onConfirm: (level) => {
			seen.confirmed = level
		},
		onCancel: () => {
			seen.cancelled += 1
		},
	})
	const collect = (root) => {
		const nodes = []
		const texts = []
		const stack = [root]
		while (stack.length > 0) {
			const node = stack.pop()
			if (!node) continue
			if (Array.isArray(node)) {
				for (const child of node) stack.push(child)
				continue
			}
			if (typeof node === 'string') {
				texts.push(node)
				continue
			}
			if (typeof node !== 'object') continue
			nodes.push(node)
			for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
		}
		return { nodes, texts }
	}
	const { nodes, texts } = collect(tree)
	assert.ok(nodes.some((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-dialog'), 'the dialog renders')
	assert.ok(texts.includes('将文章生成听力练习'), 'the panel title is the new one')
	assert.ok(texts.includes('选择等级'), 'the level section has its own heading')
	assert.ok(texts.includes('A telescope story'), 'the article card names the article')
	assert.ok(texts.includes('The AVATAR investigation will look at how tissue reacts in space.'), 'the card carries the summary')
	assert.ok(texts.includes('science.nasa.gov'), 'the card shows the source domain')
	const articleLink = nodes.find((node) => node.args && node.args[0] === clientTest.SourceLink)
	assert.ok(articleLink, 'the card links to the original')
	assert.equal(articleLink.args[1].url, 'https://science.nasa.gov/telescope')
	assert.ok(texts.some((line) => line.includes('6–20 句')), 'the hint states the sentence window')
	assert.ok(texts.some((line) => line.includes('中级')), 'each level carries its name')
	assert.ok(texts.some((line) => line.includes('能应对旅行、学习和工作中的常见场景')), 'the selected level definition is shown')
	const select = nodes.find((node) => node.args && node.args[0] === 'select' && node.args[1] && node.args[1].className === 'dsh-de-levelselect')
	assert.ok(select, 'the six levels are one native dropdown')
	assert.equal(select.args[1].value, 'B1', 'the saved level is preselected')
	assert.equal(select.args[1].disabled, false)
	const options = []
	const optionStack = [select]
	while (optionStack.length > 0) {
		const node = optionStack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) optionStack.push(child)
			continue
		}
		if (typeof node !== 'object') continue
		if (node.args && node.args[0] === 'option') options.push(node)
		for (const child of node.args ? node.args.slice(2) : []) optionStack.push(child)
	}
	assert.equal(options.length, 6, 'six levels are offered')
	assert.ok(options.some((node) => node.args[1].value === 'B1' && String(node.args[2]).includes('中级')), 'the option carries its level name')
	select.args[1].onChange({ target: { value: 'A2' } })
	assert.equal(seen.level, 'A2', 'changing the dropdown changes the choice')
	assert.ok(nodes.some((node) => node.args && node.args[0] === clientTest.CheckedGlyph), 'the footer checkbox uses the workspace <checked> glyph')
	const tick = clientTest.CheckedGlyph({ size: 16 })
	assert.equal(tick.args[1].width, 16)
	assert.equal(tick.args[2].args[1].d, 'M3 8.5 6.5 12 13 4', 'the glyph is the library check')
	const levelCss = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(levelCss.includes('height: 44px; box-sizing: border-box; padding: 0 40px 0 12px;'), 'the dropdown uses the standard field metrics')
	assert.ok(levelCss.includes('.dsh-de-levelchevron {') && levelCss.includes('opacity: .5;') && levelCss.includes('right: 16px;'), 'the arrow is a translucent custom chevron, 16px from the edge')
	assert.ok(levelCss.includes('margin-top: 16px;'), 'the field has a 16px gap above it')
	assert.ok(levelCss.includes('.dsh-de-leveldef {\n\tmargin: 8px 0 0;'), 'the definition sits 8px under the field')
	assert.ok(levelCss.includes('border-radius: 10px; background: var(--de-fill'), 'the dropdown matches the app field surface')
	assert.ok(texts.includes('采用 deepseek-flash 生成'), 'the footer names the Host model doing the rewrite')
	const checkbox = nodes.find((node) => node.args && node.args[1] && node.args[1].className === 'dsh-de-checkbox')
	assert.ok(checkbox, 'the footer checkbox is the shared one')
	assert.equal(checkbox.args[2].args[0], clientTest.CheckedGlyph, 'it uses the <checked> glyph')
	const fallbackTree = clientTest.LevelDialog({ t, item, value: 'B1', myLevel: 'B1', busy: false, modelName: '', onChange: () => {}, onConfirm: () => {}, onCancel: () => {} })
	assert.ok(collect(fallbackTree).texts.includes('使用宿主的 LLM 生成'), 'without a model name it falls back to the host LLM')
	const confirm = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-dialog-go')
	assert.equal(confirm.args[1].disabled, false)
	confirm.args[1].onClick()
	assert.equal(seen.confirmed, 'B1', 'confirm reports the active level')
	const close = nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-dialog-close')
	close.args[1].onClick()
	assert.equal(seen.cancelled, 1, 'the close button cancels')
	const busyTree = clientTest.LevelDialog({ t, item, value: 'B1', myLevel: 'B1', busy: true, onChange: () => {}, onConfirm: () => {}, onCancel: () => {} })
	const busyConfirm = collect(busyTree).nodes.find((node) => node.args && node.args[0] === 'button' && node.args[1] && node.args[1].className === 'dsh-de-dialog-go')
	assert.equal(busyConfirm.args[1].disabled, true, 'a generating page cannot confirm twice')
	checks += 1
})



check(() => {
	// The level dialog's Options expander exposes TTS voice and rate, preselected
	// from the profile, and changes go through onSettings.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const tts = {
		englishVoices: () => [{ name: 'Samantha', lang: 'en-US' }],
		cloudReady: () => true,
		engine: () => 'cloud',
		cloudVoice: () => 'stella',
		voiceName: () => 'Samantha',
	}
	const seen = []
	const tree = clientTest.LevelDialog({
		t,
		item: { id: 'id1', title: 'Story', summary: '', source: 'NASA', provider: 'nasa', url: 'https://example.org/a' },
		value: 'B1',
		myLevel: 'B1',
		busy: false,
		modelName: '',
		settings: { engine: 'cloud', cloudVoice: 'stella', voiceName: 'Samantha', rate: 0.95 },
		tts,
		onSettings: (patch) => seen.push(patch),
		onChange: () => {},
		onConfirm: () => {},
		onCancel: () => {},
	})
	const nodes = []
	const texts = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			texts.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		nodes.push(node)
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	const details = nodes.find((node) => node.args && node.args[0] === 'details' && node.args[1] && node.args[1].className === 'dsh-de-addopts')
	assert.ok(details, 'the dialog has an Options expander')
	assert.ok(!details.args[1].open, 'Options starts collapsed')
	assert.ok(texts.includes('选项'), 'the expander is labelled')
	const voiceSelect = nodes.find((node) => node.args && node.args[0] === 'select' && node.args[1] && node.args[1].className === 'dsh-de-opts-select')
	assert.equal(voiceSelect.args[1].value, 'cloud:stella', 'the current cloud voice is preselected')
	voiceSelect.args[1].onChange({ target: { value: 'system:Samantha' } })
	assert.deepEqual(plain(seen[0]), { engine: 'system', voiceName: 'Samantha' }, 'picking a voice updates the settings')
	const range = nodes.find((node) => node.args && node.args[0] === 'input' && node.args[1] && node.args[1].type === 'range')
	assert.equal(String(range.args[1].value), '0.95', 'the current rate is preselected')
	range.args[1].onChange({ target: { value: '0.8' } })
	assert.equal(seen[1].rate, 0.8, 'moving the slider updates the rate')
	checks += 1
})

check(() => {
	// Old titles keep their graded suffix out of the row, and a missing date is
	// an empty age rather than "NaN days".
	assert.equal(clientTest.displayTitle('Women pay to break things – level 2'), 'Women pay to break things')
	assert.equal(clientTest.displayTitle('No suffix here'), 'No suffix here')
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	assert.equal(clientTest.ageText('', t), '', 'no date, no age line')
	assert.ok(/天前/.test(clientTest.ageText(new Date(Date.now() - 5 * 86400000).toUTCString(), t)), 'a five-day-old article says so')
	checks += 1
})

check(() => {
	// The ended state: score header, green/amber chips, translation, completion
	// and a retry button.
	const t = (key, vars) => clientTest.fill(clientTest.LOCALE_ZH[key] || key, vars)
	const word = (display, attempts, suffix = '') => ({ raw: `${display}${suffix}`, display, plain: display.toLowerCase(), prefix: '', suffix, attempts })
	const unit = {
		title: 'Test article – level 1',
		cefr: 'B1',
		source: { label: 'NASA', url: 'https://example.org/park', license: { label: 'Public domain' } },
		sentences: [
			{ en: 'She is a girl.', zh: '她是一个女孩。' },
			{ en: 'She saw a boy.', zh: '她看见一个男孩。' },
		],
	}
	const stats = [
		{ words: [word('She', 1), word('is', 1), word('a', 1), word('girl', 6, '.')] },
		{ words: [word('She', 1), word('saw', 5), word('a', 1), word('boy', 1, '.')] },
	]
	const tree = clientTest.ArticleSummary({
		t,
		unit,
		stats,
		elapsed: 493000,
		onBack: () => {},
		onRetry: () => {},
	})
	const texts = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			texts.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		for (const child of node.args || []) stack.push(child)
	}
	assert.ok(texts.includes('听写得分'), 'the score header is shown')
	assert.ok(texts.some((line) => line.includes('拼写准确度：')), 'the header shows spelling accuracy')
	assert.ok(texts.some((line) => line.includes('听辨流畅度：')), 'the header shows listening fluency')
	assert.ok(texts.some((line) => line.includes('你完成 2 句练习') && line.includes('耗时 8 分 13 秒')), 'completion and time share one line')
	assert.ok(texts.includes('她是一个女孩。她看见一个男孩。'), 'the full translation is shown')
	assert.ok(texts.includes('girl'), 'the word chips are kept')
	assert.equal(texts.includes('X6'), false, 'the weak-word list is gone')
	assert.equal(texts.includes('来源：NASA · Public domain'), false, 'the source line is gone')
	assert.equal(texts.includes('学习行为'), false, 'the old behaviour section is gone')
	assert.equal(texts.includes('/ 100'), false, 'the score is a single number, not a fraction')
	assert.ok(texts.includes('重新练习'), 'the footer offers retry')
	checks += 1
})

check(() => {
	// Empty checks are visual errors, not attempts; duplicate wrong answers are
	// one error; a successful check adds the final attempt.
	const stateful = createStatefulReact()
	const client2 = definition.factory((name) => {
		assert.equal(name, 'react')
		return stateful.React
	})
	const t = (key, vars) => client2.__test.fill(client2.__test.LOCALE_ZH[key] || key, vars)
	const results = []
	const props = {
		t,
		sentence: 'He is happy.',
		zh: '他很开心。',
		index: 0,
		total: 1,
		onNext: () => {},
		onResult: (words) => results.push(words),
		onReplay: () => {},
		onPhase: () => {},
	}
	let tree = null
	const render = () => {
		stateful.cursor = 0
		tree = client2.__test.ArticleSentence(props)
	}
	const inputs = () => {
		const found = []
		const stack = [tree]
		while (stack.length > 0) {
			const node = stack.pop()
			if (!node) continue
			if (Array.isArray(node)) {
				for (const child of node) stack.push(child)
				continue
			}
			if (typeof node !== 'object') continue
			if (node.args && node.args[0] === 'input') found.push(node.args[1])
			for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
		}
		return found.reverse()
	}
	const check = (box) => {
		box.onKeyDown({
			key: 'Enter',
			preventDefault() {},
			currentTarget: { selectionStart: 0, selectionEnd: 0 },
			target: null,
		})
		render()
	}
	render()
	inputs()[0].onChange({ target: { value: 'X' } })
	render()
	check(inputs()[0])
	inputs()[0].onChange({ target: { value: 'X' } })
	render()
	check(inputs()[0])
	inputs()[0].onChange({ target: { value: 'Y' } })
	render()
	check(inputs()[0])
	inputs()[0].onChange({ target: { value: 'He' } })
	inputs()[1].onChange({ target: { value: 'is' } })
	inputs()[2].onChange({ target: { value: 'happy' } })
	render()
	check(inputs()[0])
	render()
	const texts = []
	const stack = [tree]
	while (stack.length > 0) {
		const node = stack.pop()
		if (!node) continue
		if (Array.isArray(node)) {
			for (const child of node) stack.push(child)
			continue
		}
		if (typeof node === 'string') {
			texts.push(node)
			continue
		}
		if (typeof node !== 'object') continue
		for (const child of node.args ? node.args.slice(2) : []) stack.push(child)
	}
	const counts = texts.filter((line) => /^X\d+$/.test(line)).sort()
	assert.deepEqual(counts, ['X1', 'X1', 'X3'], 'X, duplicate X, Y and the success = three attempts; empties are not attempts')
	checks += 1
})

check(() => {
	// Dictation score: per-word attempts + hints, then the input-phase replay
	// coefficient. Given words are excluded.
	const score = clientTest.dictationScore([
		{
			replays: 4,
			words: [
				{ plain: 'one', given: false, attempts: 1 },
				{ plain: 'two', given: false, attempts: 2 },
				{ plain: 'Mary', given: true, attempts: 0 },
				{ plain: 'four', given: false, attempts: 1, peekBeforeInput: 1, peeks: 1 },
			],
		},
		{
			replays: 4,
			words: [
				{ plain: 'five', given: false, attempts: 2, peekAfterWrong: 1, peeks: 1 },
				{ plain: 'six', given: false, attempts: 3 },
				{ plain: 'seven', given: false, attempts: 1, peekOnCorrect: 1, peeks: 1 },
			],
		},
	])
	assert.equal(score.words, 6, 'given words do not count')
	assert.equal(score.firstTry, 3, 'three words were right on the first check')
	assert.equal(score.hints, 2, 'peeks after the word was already correct are not hints')
	assert.equal(score.raw, 58.5)
	assert.equal(score.replays, 8)
	assert.equal(score.avgReplay, 4)
	assert.equal(score.listenFactor, 0.88)
	assert.equal(score.value, 51)
	assert.equal(score.comprehension, 88, 'without a baseline, fluency is just the replay factor')
	assert.equal(score.efficiencyFactor, 1)
	assert.equal(score.referencePace, 0)
	assert.equal(score.band, 'weak')
	assert.equal(clientTest.scoreBand(95), 'excellent')
	assert.equal(clientTest.scoreBand(80), 'good')
	assert.equal(clientTest.scoreBand(65), 'pass')
	assert.equal(clientTest.scoreBand(45), 'weak')
	assert.equal(clientTest.scoreBand(20), 'retry')
	assert.equal(clientTest.dictationScore([]).value, 0, 'an empty article has no score')
	checks += 1
})

check(() => {
	// Efficiency is relative to the learner's own median pace at the same level;
	// until three samples exist it is neutral.
	const items = [
		{ id: 'a', phase: 'done', cefr: 'B1', words: 100, elapsedMs: 500000 },
		{ id: 'b', phase: 'done', cefr: 'B1', words: 100, elapsedMs: 600000 },
		{ id: 'c', phase: 'done', cefr: 'B1', words: 100, elapsedMs: 400000 },
		{ id: 'd', phase: 'typing', cefr: 'B1', words: 100, elapsedMs: 100000 },
	]
	assert.equal(clientTest.referencePaceOf(items, 'B1', 'current'), 5, 'median seconds per word')
	assert.equal(clientTest.referencePaceOf(items.slice(0, 2), 'B1', 'current'), 0, 'three samples are required')
	const words = Array.from({ length: 3 }, (_, index) => ({ plain: `w${index}`, attempts: 1 }))
	const score = clientTest.dictationScore(
		[
			{ words, replays: 4 },
			{ words, replays: 4 },
		],
		{ elapsedMs: 45000, referencePace: 5 },
	)
	assert.equal(score.efficiencyFactor, 0.93, '50% slower than baseline costs 7.5%')
	assert.equal(score.comprehension, 81, 'fluency combines replay and efficiency')
	assert.equal(score.value, 81, 'perfect spelling × fluency')
	const hostScore = scoreModule.dictationScore(
		[
			{ words, replays: 4 },
			{ words, replays: 4 },
		],
		{ elapsedMs: 45000, referencePace: 5 },
	)
	assert.deepEqual(plain(hostScore), plain(score), 'the Host fallback and the client agree')
	checks += 1
})

check(() => {
	// Sentence results and the article summary have their own sounds; without an
	// AudioContext the calls must still be silent no-ops, never throws.
	const engine = clientTest.createSound()
	engine.congrats()
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('tts.speak(current.en'), 'a live sentence result replays the sentence')
	assert.ok(!source.includes('sound.success()'), 'the old success chime is gone from the result flow')
	assert.ok(source.includes('sound.wrong()'), 'a wrong check plays the error sound')
	assert.ok(source.includes('resultSoundSuppressed'), 'a restored result stays silent')
	assert.ok(source.includes('sound.congrats()'), 'the finished article plays the congrats fanfare')
	checks += 1
})

check(() => {
	// Footer: speed selector on the left, sentence count on the right.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('const PLAYBACK_RATES = [0.5, 0.8, 1, 1.5, 2]'))
	assert.ok(source.includes('dsh-de-footer-speed'))
	assert.ok(source.includes('dsh-de-footer-count'))
	assert.ok(source.includes('dsh-de-footer-hint kbd'), 'shortcut keys get a rounded cap')
	assert.ok(source.includes('shortcutHint'), 'the hint renders key caps')
	checks += 1
})

check(() => {
	// Translation failures must not be saved as an article with no Chinese, and
	// older empty units are repaired when opened.
	const hostSource = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(hostSource.includes('translation-failed'), 'an untranslated article is rejected')
	assert.ok(hostSource.includes('async function translateArticle'), 'translation is a validated helper')
	assert.ok(hostSource.includes('Older generations could be saved after a failed translation'), 'old untranslated units are repaired')
	checks += 1
})

check(() => {
	// A sentence starts in listening: no boxes until Enter/Space, and the clock
	// starts from that key, not from the page load.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('sentence.listenPrompt'), 'the listening prompt is localized')
	assert.ok(source.includes('dsh-de-listen-translation'), 'the listening screen shows the Chinese line')
	assert.ok(source.includes("setSentencePhase('listening')"), 'new sentences enter listening')
	assert.ok(source.includes('const startTyping'), 'Enter/Space starts typing')
	assert.ok(source.includes("listening: sentencePhase === 'listening'"), 'the sentence receives the listening phase')
	checks += 1
})

check(() => {
	// The AI teacher is an article-scoped 360px sidebar on result pages only.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const hostSource = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(source.includes('function CoachPanel'), 'the sidebar component exists')
	assert.ok(source.includes('dsh-de-coach-host-open'), 'opening pushes the page')
	assert.ok(source.includes('width: 360px'), 'the sidebar is 360px')
	assert.ok(source.includes("view === 'sentences' && sentencePhase === 'result'"), 'the entry is the sentence result only')
	assert.ok(source.includes('coachThreads'), 'threads are article-scoped')
	assert.ok(source.includes('function AiChatGlyph'), 'the entry uses the <ai-chat> icon')
	assert.ok(source.includes('function CoachButton'), 'the entry is an icon button')
	assert.ok(source.includes("disabled: sentencePhase !== 'result'"), 'the entry is disabled while writing')
	assert.ok(source.includes('dsh-de-icobtn:disabled'), 'disabled buttons look disabled')
	assert.ok(source.includes('onCoach: () => setCoachOpen((value) => !value)'), 'the summary toggles the sidebar')
	assert.ok(source.includes("h(CoachButton, { t, open: coachOpen === true, disabled: false, onToggle: onCoach })"), 'the summary title bar carries the ASK AI entry')
	assert.ok(source.includes('dsh-de-composer'), 'the composer is its own rounded box')
	assert.ok(source.includes('.dsh-de-coach-message[data-role="user"]') && source.includes('color: var(--dsw-alias-bg-base'), 'the user bubble flips its text colour with the theme')
	assert.ok(source.includes('toggleVoice'), 'the composer keeps voice input')
	assert.ok(source.includes('function MicGlyph'), 'voice is an icon button')
	assert.ok(source.includes('dsh-de-composer-send'), 'the send control is an icon-sized button')
	assert.ok(hostSource.includes('coach route'), 'the host exposes the coach')
	assert.ok(hostSource.includes('voice route'), 'the host exposes local speech recognition')
	assert.ok(source.includes('MediaRecorder'), 'the client records audio locally')
	assert.ok(source.includes('audioBase64'), 'the recording is sent as PCM WAV')
	checks += 1
})

check(() => {
	// The practice topbar uses the workspace <back> icon in a ghost button.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('function BackGlyph'), 'the back icon is inlined')
	assert.ok(source.includes('dsh-de-icobtn-ghost'), 'the back button uses the ghost style')
	assert.equal(source.includes("'←'"), false, 'the text arrow is gone')
	checks += 1
})

check(() => {
	// The footer's sound icon must follow playback, not stay a static glyph.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('h(Wave, { speaking: tts.isSpeaking() })'), 'the footer wave follows the TTS state')
	assert.ok(source.includes('.dsh-de-wave[data-speaking="true"] i { animation: dsh-de-wave'), 'the wave animates while speaking')
	checks += 1
})

check(() => {
	// Unclosed paragraphs are the normal case on real pages: a <header> after an
	// open <p> must close it, not be swallowed into "the first paragraph".
	const unclosed = `<html><body><main>
		<div class="nav"><p><a href="/a">News</a> <a href="/b">Topics</a> <a href="/c">Research</a></p></div>
		<header><h1>Site title</h1></header>
		<p>This is the first real paragraph of the article and it is long enough.</p>
		<p>School of Life Sciences, Example University, Somewhere</p>
		<p>This is the second real paragraph, also long enough to survive the filter.</p>
	</main></body></html>`
	const text = rss.extractArticleText(unclosed)
	assert.ok(text.includes('first real paragraph'), 'prose after a stray header is kept')
	assert.ok(text.includes('second real paragraph'), 'the rest of the prose is kept')
	assert.equal(text.includes('Site title'), false, 'the header is not folded into a paragraph')
	assert.equal(text.includes('News Topics Research'), false, 'a link-only menu paragraph is dropped')
	assert.equal(text.includes('School of Life Sciences'), false, 'an affiliation line is dropped')
	checks += 1
})

check(() => {
	// The PLOS abstract arrives with its author line in front of "Introduction";
	// neither belongs in the English the model rewrites.
	const cleaned = sourcesModule.cleanSourceText('by Ada Lovelace, Grace Hopper Introduction Lassa fever is a priority disease.')
	assert.ok(cleaned.startsWith('Lassa fever'), 'the author prefix is stripped')
	assert.equal(
		sourcesModule.cleanSourceText('A normal sentence with a https://example.org/link inside.'),
		'A normal sentence with a inside.',
		'URLs are removed from source prose',
	)
	checks += 1
})

check(() => {
	// A feed body wins over its teaser, and every string it returns is markup-free
	// (the same rule as the parser test above, on the old graded-feed shape).
	const xml = `<rss><channel>
		<item>
			<title><![CDATA[Women pay to break things – level 1]]></title>
			<link>https://www.newsinlevels.com/products/example/</link>
			<description><![CDATA[<p>Many women visit rage rooms.</p>]]></description>
			<pubDate>Mon, 16 Nov 2026 06:00:10 +0000</pubDate>
			<content:encoded><![CDATA[<p>In these rooms, people use hammers to break old TVs.</p>]]></content:encoded>
		</item>
	</channel></rss>`
	const items = rss.parseFeed(xml)
	assert.equal(items.length, 1)
	assert.equal(items[0].title, 'Women pay to break things – level 1')
	assert.equal(items[0].link, 'https://www.newsinlevels.com/products/example/')
	assert.ok(items[0].text.includes('people use hammers'), 'the feed body is kept')
	assert.ok(!items[0].summary.includes('<p>'), 'markup is stripped from the summary')
	checks += 1
})


check(() => {
	// The home page is the dashboard from the design: counters + the exercise
	// book, with the "add an exercise" page as its only other screen. The old
	// scene word lists (cafe, airport, …) are gone; the article is the unit now.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const start = source.indexOf('return h(Home, {')
	assert.ok(start > 0, 'the home page renders Home')
	assert.ok(!source.includes('return h(TagList'), 'the category list is not the home page anymore')
	const end = source.indexOf('})', start)
	const body = source.slice(start, end)
	for (const prop of ['savedArticles', 'summary', 'onOpenSaved', 'onAddExercise', 'generatingArticle']) {
		assert.ok(body.includes(prop), `Home receives ${prop}`)
	}
	assert.equal(body.includes('onOpenArticle'), false, 'the home no longer renders the raw feed')
	// The add page is a real screen with its own props, reachable from the home.
	const addStart = source.indexOf('return h(AddExercise, {')
	assert.ok(addStart > 0, 'the add page renders AddExercise')
	const addBody = source.slice(addStart, source.indexOf('})', addStart))
	for (const prop of ['items', 'status', 'savedArticles', 'myLevel', 'topic', 'onTopic', 'busyId', 'onAdd', 'onIngestUrl', 'settings', 'tts', 'ttsVersion', 'onSettings', 'modelName', 'onBack', 'onRefresh', 'refreshing']) {
		assert.ok(addBody.includes(prop), `AddExercise receives ${prop}`)
	}
	// Both screens are reachable from the page's router.
	assert.ok(source.includes("setView('add')"), 'the add button navigates to the add page')
	assert.ok(source.includes("view === 'add'"), 'the router renders the add page')
	checks += 1
})


check(() => {
	// Pressing Up peeks at the focused box's word immediately; only a wrong box
	// counts as a miss, a box that already holds the right word is free.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	const start = source.indexOf('function ArticleSentence')
	const end = source.indexOf('/* ───────────────────────────── Dashboard', start)
	assert.ok(start > 0 && end > start, 'the article sentence component is findable')
	const body = source.slice(start, end)
	assert.ok(body.includes("event.key === 'ArrowUp'"), 'Up peeks at the focused box')
	assert.ok(body.includes('dsh-de-peek-inplace-word'), 'the peek replaces the input in place')
	assert.ok(body.includes('onKeyUp'), 'releasing the key hides the peek')
	assert.ok(body.includes('peekCaret'), 'holding Up preserves the caret')
	assert.ok(!body.includes('spot === unitAt && !units[spot].given'), 'a peek is a hint, not a scoring attempt')
	assert.ok(body.includes('alreadyRight') && body.includes('matchesTarget('), 'a correct box is excluded from the miss')
	assert.equal(body.includes("event.key === 'Alt'"), false, 'the old Alt sentence peek is gone')
	checks += 1
})

check(() => {
	assert.equal(clientTest.articleLevelOf('Women pay to break things – level 1'), 1)
	assert.equal(clientTest.articleLevelOf('Videos in Levels – level 3'), 3)
	assert.equal(clientTest.articleLevelOf('No level in this title'), 1)
	checks += 1
})

{
	// The whole source → exercise chain, with a fake model: a rejected first
	// rewrite is retried with the reason, translation runs only after the level
	// passes, and the saved unit carries its level and its attribution.
	const passage = [
		'The town opens a new park this week.',
		'The park is next to the river.',
		'Families can walk there on Sunday.',
		'Children like the small wooden bridge.',
		'There is a quiet place for a picnic.',
		'People can sit and watch the birds.',
		'A small shop sells water and fruit.',
		'The town wants more green places.',
		'It plans to build two more next year.',
		'Everyone can use the park for free.',
		'Many people helped to plan it.',
		'They asked for trees and flowers.',
		'The park has a long path for bikes.',
		'It is open from morning to night.',
		'The town hopes people will keep it clean.',
	].join(' ')
	const sourceArticle = {
		provider: 'nasa',
		source: 'NASA',
		title: 'A new park in town',
		url: 'https://example.org/park',
		publishedAt: '2026-11-17T00:00:00.000Z',
		license: { id: 'public-domain', label: 'Public domain', url: 'https://example.org/licence' },
		attribution: { label: 'NASA', url: 'https://www.nasa.gov/' },
		text: 'A source report about parks, towns and green places, in its own words.',
	}
	const sentenceRows = [
		{ en: 'The town opens a new park this week.', zh: '小镇这周开放了一个新公园。', given: [] },
		{ en: 'The park is next to the river.', zh: '公园就在河边。', given: [] },
		{ en: 'NASA helped the town plan the space.', zh: 'NASA 帮小镇规划了这片空间。', given: ['NASA', 'Missing'] },
		{ en: 'Families can walk there on Sunday.', zh: '周日家人可以在那里散步。', given: [] },
		{ en: 'Children like the small wooden bridge.', zh: '孩子们喜欢那座小木桥。', given: [] },
		{ en: 'A small shop sells water and fruit.', zh: '一家小店卖水和水果。', given: [] },
	]
	const reply = JSON.stringify({
		title: 'A new park',
		sentences: sentenceRows,
		questions: ['公园在哪里？', '为什么孩子们喜欢这里？'],
	})
	const promptsSeen = []
	let calls = 0
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-generate-'))
	const generator = generateModule.createSourceGenerator({
		sources: { article: async () => sourceArticle },
		store: { dir },
		tts: { synthesize: async () => null },
		callModel: async (request) => {
			calls += 1
			promptsSeen.push(request)
			return reply
		},
		now: () => new Date('2026-11-17T12:00:00.000Z'),
	})
	const result = await generator.generate({ id: 'row1' }, 'B1', '')
	assert.equal(calls, 1, 'the whole exercise is one model call')
	assert.ok(promptsSeen[0].user.includes('questions'), 'the same call asks for the learner questions')
	const saved = JSON.parse(fs.readFileSync(path.join(dir, 'articles', `${result.unit.id}.json`), 'utf8'))
	assert.equal(saved.cefr, 'B1')
	assert.equal(saved.source.label, 'NASA', 'attribution travels with the exercise')
	assert.equal(saved.source.url, 'https://example.org/park', 'the source URL travels with the exercise')
	assert.equal(saved.id, crypto.createHash('sha1').update('https://example.org/park').digest('hex').slice(0, 12), 'the unit id is the URL hash')
	assert.equal(saved.source.license.label, 'Public domain')
	assert.equal(saved.title, 'A new park', 'the rewritten title is used')
	assert.equal(saved.sentences.length, 6, 'the exercise uses the sentences from the same reply')
	assert.equal(saved.sentences[0].zh, '小镇这周开放了一个新公园。', 'translations come from the same reply')
	assert.deepEqual(saved.sentences[2].given, ['NASA'], 'given words must occur in their sentence')
	assert.equal(saved.questions.length, 2, 'the article questions are saved with the exercise')
	assert.equal(saved.generatedAt, '2026-11-17T12:00:00.000Z')
	assert.equal(result.stats.words > 0, true, 'the level stats are returned')

	// A bad reply fails visibly, and there is no second call.
	let failedCalls = 0
	const failing = generateModule.createSourceGenerator({
		sources: { article: async () => sourceArticle },
		store: { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-generate-fail-')) },
		tts: { synthesize: async () => null },
		callModel: async () => {
			failedCalls += 1
			return 'not json'
		},
	})
	await assert.rejects(() => failing.generate({ id: 'row2' }, 'B1', ''), (error) => error.code === 'rewrite-failed')
	assert.equal(failedCalls, 1, 'an invalid reply is not retried')

	// A single malformed sentence makes the whole exercise fail, with its position.
	const broken = JSON.stringify({
		title: 'A new park',
		sentences: [...sentenceRows.slice(0, 5), { en: 'Too short.', zh: '太短。', given: [] }],
		questions: [],
	})
	const malformed = generateModule.createSourceGenerator({
		sources: { article: async () => sourceArticle },
		store: { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-generate-short-')) },
		tts: { synthesize: async () => null },
		callModel: async () => broken,
	})
	await assert.rejects(() => malformed.generate({ id: 'row4' }, 'B1', ''), (error) => error.code === 'rewrite-failed' && /第 6 句/.test(error.detail))

	// A level failure is a failure, not a retry.
	const a1 = JSON.stringify({
		title: 'A park',
		sentences: [
			{ en: 'She has finished her work at the office.', zh: '她已经完成了办公室的工作。', given: [] },
			{ en: 'The park is open today.', zh: '公园今天开放。', given: [] },
			{ en: 'Families walk there after lunch.', zh: '午饭后家人在那里散步。', given: [] },
			{ en: 'The small shop sells fruit.', zh: '小店卖水果。', given: [] },
		],
		questions: [],
	})
	const levelFail = generateModule.createSourceGenerator({
		sources: { article: async () => sourceArticle },
		store: { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-generate-level-')) },
		tts: { synthesize: async () => null },
		callModel: async () => a1,
	})
	await assert.rejects(() => levelFail.generate({ id: 'row5' }, 'A1', ''), (error) => error.code === 'rewrite-failed' && /完成时/.test(error.detail))

	// A missing article is its own code, not a generic failure.
	const noText = generateModule.createSourceGenerator({
		sources: { article: async () => null },
		store: { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dictation-generate-empty-')) },
		tts: { synthesize: async () => null },
		callModel: async () => reply,
	})
	await assert.rejects(() => noText.generate({ id: 'row3' }, 'B1', ''), (error) => error.code === 'no-article-text')
	checks += 1
}

/* ═══════════════════════ 8. Host routes, end to end ═══════════════════════ */

const routes = new Map()
const models = { itemCalls: 0, reportCalls: 0, mode: 'ok' }
/**
 * The fake model's sentences. There are more of them than the longest run in
 * the tests answers, because nothing is prefetched any more: every sentence
 * comes from a fresh call, and the Host rejects a repeat of the last ten.
 */
const SENTENCES = [
	'I like to eat fresh apples every morning.',
	'She walks to the office when the weather is nice.',
	'We are planning to visit our friends next weekend.',
	'He forgot to bring his umbrella to the office.',
	'The children were playing in the garden all afternoon.',
	'My brother is taller than me by a few inches.',
	'There is a small library near the train station.',
	'If it rains tomorrow, we will stay at home.',
	'She has been learning to swim for almost three years.',
	'The book that you lent me was really interesting.',
	'I would rather walk than wait for the bus.',
	'Please make sure the door is locked before you leave.',
	'The meeting was cancelled because the manager was ill.',
	'Although he was tired, he finished all his homework.',
	'They have already moved to a bigger apartment downtown.',
]

function fakeStream(options) {
	const system = String(options.system || '')
	const user = String(options.messages?.[0]?.content?.[0]?.text || '')
	return (async function* stream() {
		if (models.mode === 'fail') throw new Error('model down')
		let text = ''
		if (system.includes('题库作者')) {
			{
				const prompt = String(user || '')
				if (prompt.includes('「咖啡店」')) {
					const sentence = 'Could I have a large iced latte with oat milk.'
					text = JSON.stringify({
						item: {
							en: sentence,
							zh: '我可以要一杯大杯冰拿铁加燕麦奶吗？',
							function: 'request',
							words: sentence.split(' ').map((word) => ({ text: word, pos: 'other', zh: '词' })),
						},
					})
					yield { type: 'block-start', index: 0, blockType: 'text' }
					yield { type: 'text-delta', index: 0, text }
					yield { type: 'finish', reason: { kind: 'stop' } }
					return
				}
				models.itemCalls += 1
				const target = Number((/约为 ([\d.]+)\/12/.exec(system) || [])[1] || 5)
				const sentence = SENTENCES[models.itemCalls % SENTENCES.length]
				text = JSON.stringify({
					item: {
						en: sentence,
						zh: '一句中文。',
						words: sentence.split(' ').map((word) => ({ text: word, pos: 'other', zh: '词' })),
						difficulty: target,
						tags: ['tense'],
					},
				})
			}
		} else if (system.includes('教练')) {
			models.reportCalls += 1
			if (models.mode === 'fabricated') {
				text = JSON.stringify({ report: { verdict: '你写的是 "zzz"，这是听音问题。', detail: '' } })
			} else {
				text = JSON.stringify({ report: { verdict: '这是听音问题，不是语法问题。', detail: '注意 /æ/ 的口型。', action: { type: 'replay_sentence' } } })
			}
		}
		yield { type: 'block-start', index: 0, blockType: 'text' }
		yield { type: 'text-delta', index: 0, text }
		yield { type: 'finish', reason: { kind: 'stop' } }
	})()
}

const ctx = {
	effect(fn) {
		const dispose = fn()
		return typeof dispose === 'function' ? dispose : () => {}
	},
	get(name) {
		if (name === 'llm') return { stream: fakeStream }
		if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake-model' }) }
		return undefined
	},
	webServer: {
		register(route) {
			routes.set(route.path, route.handler)
			return () => routes.delete(route.path)
		},
	},
}

host.apply(ctx)

function makeReq(method, body) {
	const listeners = new Map()
	const req = {
		method,
		url: '/',
		on(event, listener) {
			listeners.set(event, listener)
			return req
		},
		destroy() {},
	}
	// Deliver the body on the next tick, after the handler has subscribed.
	setTimeout(() => {
		const data = listeners.get('data')
		const end = listeners.get('end')
		if (data && body !== undefined) data(Buffer.from(JSON.stringify(body)))
		if (end) end()
	}, 0)
	return req
}

function makeRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writeHead(status, headers) {
			res.statusCode = status
			res.headers = headers || {}
			res.headersSent = true
			return res
		},
		end(chunk) {
			if (chunk !== undefined) res.body += chunk
			res.done = true
		},
	}
	return res
}

async function call(routeName, method = 'GET', body) {
	const handler = routes.get(`${rules.API_PREFIX}${routeName}`)
	assert.ok(handler, `route ${routeName} is registered`)
	const res = makeRes()
	await handler(makeReq(method, body), res)
	assert.ok(res.done, `route ${routeName} replied`)
	return { status: res.statusCode, data: JSON.parse(res.body || '{}') }
}

check(() => {
	const expected = ['/profile', '/profile/band', '/profile/settings', '/profile/reset', '/run/start', '/run/answer', '/run/finish', '/report/retry', '/tts/cache', '/sources', '/sources/article', '/sources/read', '/sources/url', '/sources/generate', '/articles/remove', '/archive/articles', '/archive/regenerate', '/favicon']
	for (const path of expected) assert.ok(routes.has(`${rules.API_PREFIX}${path}`), `route ${path}`)
	assert.equal(routes.has(`${rules.API_PREFIX}/articles`), false, 'the old single-feed list is gone')
	assert.equal(routes.has(`${rules.API_PREFIX}/articles/generate`), false, 'the old generation route is gone')
})

check(() => {
	// The remove route keeps source/meta and deletes the unit + progress; the
	// built-in can be counted as removed and restored without a network fetch.
	return (async () => {
		const dir = path.join(storageDir, 'articles')
		fs.mkdirSync(dir, { recursive: true })
		const id = 'aaaabbbbcccc'
		const unit = {
			id,
			title: 'Route removal unit',
			cefr: 'A2',
			link: '',
			source: { provider: 'nasa', label: 'NASA', url: 'https://example.org/route-removal' },
			publishedAt: '2026-11-01T00:00:00.000Z',
			generatedAt: '2026-11-02T00:00:00.000Z',
			sentences: [{ en: 'A short sentence.', zh: '一个短句。' }],
		}
		fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(unit))
		fs.writeFileSync(path.join(dir, `${id}.progress.json`), JSON.stringify({ index: 0, phase: 'typing' }))
		const removed = await call('/articles/remove', 'POST', { id })
		assert.equal(removed.status, 200)
		assert.equal(removed.data.ok, true)
		assert.equal(fs.existsSync(path.join(dir, `${id}.json`)), false, 'the active unit is gone')
		assert.equal(fs.existsSync(path.join(dir, `${id}.progress.json`)), false, 'its progress is gone')
		assert.equal(removed.data.archived.sourceUrl, 'https://example.org/route-removal')
		const listed = await call('/archive/articles')
		assert.equal(listed.status, 200)
		assert.ok(listed.data.articles.some((record) => record.id === id))
		// The built-in restore path.
		const builtin = firstPractice.firstPracticeUnit(new Date('2026-11-18T00:00:00.000Z'))
		fs.writeFileSync(path.join(dir, `${builtin.id}.json`), JSON.stringify(builtin))
		await call('/articles/remove', 'POST', { id: builtin.id })
		const restored = await call('/archive/regenerate', 'POST', { id: builtin.id })
		assert.equal(restored.status, 200)
		assert.equal(restored.data.article.id, builtin.id)
		assert.equal(fs.existsSync(path.join(dir, `${builtin.id}.json`)), true, 'the built-in is restored')
		const after = await call('/archive/articles')
		assert.equal(after.data.articles.some((record) => record.id === builtin.id), false, 'the archive record is dropped')
		// Leave no archive rows for later saved-list tests.
		for (const record of after.data.articles) fs.rmSync(path.join(storageDir, 'archive', `${record.id}.json`), { force: true })
		checks += 1
	})()
})

check(() => {
	// Leaving a finished summary clears that article's audio on both sides; the
	// Host's /audio is not hidden behind a browser cache.
	const source = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')
	assert.ok(source.includes('api.ttsClear(texts, settings.cloudVoice)'), 'the summary clears the article cache on back')
	assert.ok(source.includes('tts.releaseMany(texts)'), 'prefetched Blob URLs are released too')
	const hostSource = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')
	assert.ok(hostSource.includes("cache-control': 'no-store'"), 'audio responses are not browser-cached')
	checks += 1
})

{
	// Article progress keeps the phase and enough data to restore a result page
	// or the ended summary; the unit route hands the same object back.
	const id = 'abcdef123456'
	const dir = path.join(storageDir, 'articles')
	fs.mkdirSync(dir, { recursive: true })
	const progressReply = await call('/articles/progress', 'POST', {
		id,
		progress: {
			index: 2,
			phase: 'result',
			records: [
				// the old shape: no `plain`, the word is in `display`
				{ index: 0, en: 'He is ready.', zh: '他准备好了。', words: [{ display: 'He.', attempts: 1 }] },
				{
					index: 1,
					en: 'She walks fast.',
					zh: '她走得很快。',
					words: [
						{ display: 'She', plain: 'she', attempts: 1 },
						{ display: 'walks', plain: 'walks', attempts: 3 },
					],
				},
			],
			current: { index: 2, en: 'He is happy.', zh: '他很开心。', words: [{ display: 'happy', attempts: 3 }] },
			elapsedMs: 5200,
			score: { value: 77, raw: 80, listenFactor: 0.96, avgReplay: 2, firstTry: 4, words: 6, hints: 1, replays: 12, band: 'good' },
		},
	})
	assert.equal(progressReply.status, 200)
	const stored = JSON.parse(fs.readFileSync(path.join(dir, `${id}.progress.json`), 'utf8'))
	assert.equal(stored.phase, 'result')
	assert.equal(stored.current.index, 2)
	assert.equal(stored.elapsedMs, 5200)
	fs.writeFileSync(
		path.join(dir, `${id}.json`),
		JSON.stringify({
			id,
			title: 'Progress test',
			link: 'https://example.com/p',
			cefr: 'B1',
			source: { provider: 'nasa', label: 'NASA', url: 'https://example.com/p', license: { id: 'public-domain', label: 'Public domain' } },
			sentences: [{ en: 'He is happy.', zh: '他很开心。' }],
		}),
	)
	const unitHandler = routes.get(`${rules.API_PREFIX}/articles/unit`)
	assert.ok(unitHandler, 'the unit route is registered')
	const unitRes = makeRes()
	const unitReq = makeReq('GET')
	unitReq.url = `${rules.API_PREFIX}/articles/unit?id=${id}`
	await unitHandler(unitReq, unitRes)
	const unitData = JSON.parse(unitRes.body || '{}')
	assert.equal(unitRes.statusCode, 200)
	assert.equal(unitData.article.progress.phase, 'result')
	assert.equal(unitData.article.progressIndex, 2)
	const savedReply = await call('/articles/saved')
	const savedEntry = savedReply.data.articles.find((entry) => entry.id === id)
	assert.ok(savedEntry, 'the saved library includes the unit')
	assert.equal(savedEntry.started, true)
	assert.equal(savedEntry.phase, 'result')
	assert.equal(savedEntry.current, 1)
	assert.equal(savedEntry.elapsedMs, 5200)
	assert.equal(savedEntry.words, 3, 'the row carries its word count')
	assert.equal(savedEntry.cefr, 'B1', 'the row carries its CEFR level')
	assert.equal(savedEntry.score.value, 77, 'the row carries the saved score')
	assert.equal(savedEntry.source.label, 'NASA', 'the row carries its source for attribution')
	assert.equal(savedEntry.publishedAt, '', 'an old unit without a feed date is an empty string, not null')
	// The home counters are derived from the progress files, not stored.
	const summary = savedReply.data.summary
	assert.equal(summary.articles >= 1, true, 'the summary counts the book')
	assert.equal(summary.started >= 1, true, 'started exercises are counted')
	assert.equal(summary.elapsedMs >= 5200, true, 'the summary adds the practice time')
	assert.equal(summary.vocabulary, 3, 'distinct words: he (from display), she and walks (from plain)')
	assert.equal(summary.accuracy, 67, 'first-try words over typed words, old display records included')
	fs.writeFileSync(
		path.join(dir, 'deadbeef1234.json'),
		JSON.stringify({ id: 'deadbeef1234', title: 'Incomplete', sentences: [{ en: 'No Chinese.', zh: '' }] }),
	)
	const savedWithIncomplete = await call('/articles/saved')
	assert.equal(
		savedWithIncomplete.data.articles.some((entry) => entry.id === 'deadbeef1234'),
		false,
		'an incomplete article stays out of the library',
	)
	// A completed exercise from before scores existed still gets one.
	const legacyId = 'feedface1234'
	fs.writeFileSync(
		path.join(dir, `${legacyId}.json`),
		JSON.stringify({ id: legacyId, title: 'Legacy done', cefr: 'B1', sentences: [{ en: 'He is happy.', zh: '他很开心。' }] }),
	)
	fs.writeFileSync(
		path.join(dir, `${legacyId}.progress.json`),
		JSON.stringify({
			index: 0,
			phase: 'done',
			records: [
				{
					timeMs: 10000,
					replays: 0,
					words: [
						{ display: 'happy', plain: 'happy', attempts: 1 },
						{ display: 'day', plain: 'day', attempts: 2 },
					],
				},
			],
			elapsedMs: 10000,
		}),
	)
	const legacySaved = await call('/articles/saved')
	const legacyEntry = legacySaved.data.articles.find((entry) => entry.id === legacyId)
	assert.ok(legacyEntry, 'the legacy completed exercise is listed')
	assert.equal(legacyEntry.score.value, 80, 'the Host derives a score for a completed article')
	assert.equal(legacyEntry.score.raw, 80)
	assert.equal(legacySaved.data.summary.listening, 100, 'the home listening average uses the derived comprehension')
	assert.equal(legacySaved.data.summary.dictation, 80, 'the home dictation average uses the derived score')
	fs.rmSync(path.join(dir, `${legacyId}.json`), { force: true })
	fs.rmSync(path.join(dir, `${legacyId}.progress.json`), { force: true })
	checks += 1
}

// No packaged question bank: topic word sets ship (they are data, not
// questions), and the profile carries no bank cursor.
check(() => {
	assert.equal(fs.existsSync(path.join(root, 'data', 'fallback.json')), false, 'no offline sentence bank on disk')
	assert.equal(manifest.files.some((entry) => entry.startsWith('data/')), true, 'topic word sets ship with the plugin')
	assert.equal(manifest.files.some((entry) => entry.includes('fallback')), false, 'no question list in the published files')
	const profile = rules.emptyProfile()
	assert.equal('fallbackCursor' in profile.stats, false, 'no bank cursor in the profile')
	assert.equal(fs.existsSync(path.join(root, 'lib', 'tags.js')), true, 'topics come from the category packs')
})

// The JSON calls ask for "no thinking": the Host default (`high`) is billed
// against the same `maxTokens` budget, so the reply came back truncated and
// unparsable and three attempts in a row produced no sentence at all.
{
	const withOff = await host.__test.reasoningEffortOf(
		{ listModels: async () => [{ id: 'm-off', reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' } }] },
		{ provider: 'p', model: 'm-off' },
	)
	assert.equal(withOff, 'off', 'a model that offers "off" gets asked for it')

	const withoutOff = await host.__test.reasoningEffortOf(
		{ listModels: async () => [{ id: 'm-high', reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'high' } }] },
		{ provider: 'p', model: 'm-high' },
	)
	assert.equal(withoutOff, undefined, 'a model without "off" keeps the Host default')

	const noReasoning = await host.__test.reasoningEffortOf(
		{ listModels: async () => [{ id: 'm-none' }] },
		{ provider: 'p', model: 'm-none' },
	)
	assert.equal(noReasoning, undefined, 'a model without reasoning metadata is left alone')

	const noListing = await host.__test.reasoningEffortOf({}, { provider: 'p', model: 'm-nolist' })
	assert.equal(noListing, undefined, 'no model listing is not an error')

	// The exact-model lookup is the authority; the advisory catalog is a fallback.
	const resolved = await host.__test.reasoningEffortOf(
		{ resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'high' }], defaultEffort: 'high' } }) },
		{ provider: 'p', model: 'm-resolved' },
	)
	assert.equal(resolved, 'off', 'the exact-model metadata decides')

	const resolvedWins = await host.__test.reasoningEffortOf(
		{
			resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'high' } }),
			listModels: async () => [{ id: 'm-catalog', reasoning: { efforts: [{ id: 'off' }] } }],
		},
		{ provider: 'p', model: 'm-catalog' },
	)
	assert.equal(resolvedWins, undefined, 'the catalog cannot override the exact-model metadata')

	const catalogFallback = await host.__test.reasoningEffortOf(
		{
			resolveModelInfo: async () => ({}),
			listModels: async () => [{ id: 'm-empty-info', reasoning: { efforts: [{ id: 'off' }] } }],
		},
		{ provider: 'p', model: 'm-empty-info' },
	)
	assert.equal(catalogFallback, 'off', 'an empty exact lookup falls back to the catalog')
	checks += 1
}

// The generating call really passes that choice through to the model service.
{
	const calls = []
	const fakeCtx = {
		get(name) {
			if (name === 'llm') {
				return {
					listModels: async () => [{ id: 'm-stream', reasoning: { efforts: [{ id: 'off' }], defaultEffort: 'off' } }],
					stream(options) {
						calls.push(options)
						return (async function* stream() {
							yield { type: 'text-delta', text: '{}' }
							yield { type: 'finish', reason: { kind: 'stop' } }
						})()
					},
				}
			}
			if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p2', model: 'm-stream' }) }
			return undefined
		},
	}
	const text = await host.__test.callModel(fakeCtx, { system: 's', user: 'u', maxTokens: 1600, temperature: 0.7, timeoutMs: 5000 })
	assert.equal(text, '{}')
	assert.equal(calls.length, 1)
	assert.equal(calls[0].reasoningEffort, 'off', 'the stream is created with thinking off')
	assert.equal(calls[0].maxTokens, 1600)
	checks += 1
}

// 1. empty dashboard
const empty = await call('/profile')
assert.equal(empty.status, 200)
assert.equal(empty.data.activeRun, null)
assert.equal(empty.data.profile.band, '')
assert.equal(empty.data.model, 'fake-model', 'the dashboard names the Host model')
assert.equal(empty.data.today.sentences, 0)
checks += 1

// 2. self assessment
const band = await call('/profile/band', 'POST', { band: 'B1' })
assert.equal(band.data.profile.band, 'B1')
assert.equal(band.data.profile.theta, 6)
checks += 1

// 3. start a run: the model supplies the first sentence
const started = await call('/run/start', 'POST', {})
assert.equal(started.data.ok, true)
assert.ok(started.data.item && typeof started.data.item.en === 'string')
checks += 1

const firstItem = started.data.item
const runId = started.data.runId

// The run is written on demand only: nothing is prefetched, so the Host holds
// no queue and no variant pool.
{
	const dash = await call('/profile')
	assert.equal('queueDepth' in dash.data, false, 'the dashboard has no prefetch queue')
	assert.equal('variantDepth' in dash.data, false, 'the dashboard has no variant pool')
	const stored = JSON.parse(fs.readFileSync(path.join(storageDir, 'profile.json'), 'utf8'))
	assert.equal('queue' in stored, false, 'the profile stores no prefetched sentences')
	assert.equal('variants' in stored, false, 'the profile stores no variants')
	checks += 1
}

// Answering a sentence must not write the next one: the model is called for the
// review, and for a sentence only when 「继续」 asks for it.
const itemCallsBeforeAnswer = models.itemCalls

// An exact typed answer scores Perfect 100.
const answered = await call('/run/answer', 'POST', {
	runId,
	itemId: firstItem.id,
	typed: firstItem.en,
	elapsedMs: 4200,
	replays: 1,
	revealed: false,
	hadError: false,
	usedBackspace: false,
})
assert.equal(answered.status, 200)
assert.equal(answered.data.result, 'perfect')
assert.equal(answered.data.score, 100)
assert.equal(answered.data.combo, 1)
assert.equal(answered.data.totalScore, 100)
assert.ok(answered.data.report && answered.data.report.verdict, 'a review comes back with the answer')
assert.equal(answered.data.grade, 'SSS')
assert.equal(answered.data.next, null, 'the answer no longer carries the next sentence')
assert.equal(models.itemCalls, itemCallsBeforeAnswer, 'answering a sentence writes no new sentence')

answered.data.next = (await call('/run/next', 'POST', {})).data.item
assert.ok(answered.data.next && answered.data.next.id, '/run/next hands out the next sentence')
assert.equal(models.itemCalls, itemCallsBeforeAnswer + 1, 'one click, one generation')
assert.equal(answered.data.next.id === firstItem.id, false, 'the next sentence is new')
checks += 1

// A second answered sentence: hadError → pass, 40 points, combo reset.
const second = await call('/run/answer', 'POST', {
	runId,
	itemId: answered.data.next.id,
	typed: answered.data.next.en,
	elapsedMs: 3000,
	replays: 0,
	revealed: false,
	hadError: true,
	usedBackspace: false,
})
second.data.next = (await call('/run/next', 'POST', {})).data.item
assert.equal(second.data.result, 'pass')
assert.equal(second.data.score, 40)
assert.equal(second.data.combo, 0)
assert.equal(second.data.totalScore, 140)
checks += 1

// A revealed sentence scores nothing.
const third = await call('/run/answer', 'POST', {
	runId,
	itemId: second.data.next.id,
	typed: 'I',
	elapsedMs: 1200,
	replays: 0,
	revealed: true,
	hadError: false,
	usedBackspace: false,
})
assert.equal(third.data.result, 'reveal')
assert.equal(third.data.score, 0)
assert.equal(third.data.totalScore, 140)
third.data.next = (await call('/run/next', 'POST', {})).data.item
checks += 1

// A submitted sentence that is wrong still counts as 过关 (40): with free typing
// a wrong character stays on screen, so a near miss is not «放弃».
const mismatch = await call('/run/answer', 'POST', {
	runId,
	itemId: third.data.next.id,
	typed: 'totally different',
	elapsedMs: 1000,
	replays: 0,
	revealed: false,
	hadError: false,
	usedBackspace: false,
})
assert.equal(mismatch.data.result, 'pass')
assert.equal(mismatch.data.score, 40)
assert.equal(mismatch.data.totalScore, 180)
assert.equal(mismatch.data.mismatch, true)
checks += 1

// Skipping one word is a missed word: the sentence still passes (40), not a
// reveal (0) — and the skipped word is left out of the compared text.
mismatch.data.next = (await call('/run/next', 'POST', {})).data.item
const skipTarget = mismatch.data.next
const skipTyped = skipTarget.words
	.map((word, index) => (index === 2 ? '' : rules.normalizeWord(word.text)))
	.filter((word) => word !== '')
	.join(' ')
const skipped = await call('/run/answer', 'POST', {
	runId,
	itemId: skipTarget.id,
	typed: skipTyped,
	elapsedMs: 5000,
	replays: 1,
	revealed: false,
	hadError: true,
	usedBackspace: false,
	skippedWords: [2, 99, -1, 2],
})
assert.equal(skipped.status, 200)
assert.equal(skipped.data.result, 'pass')
assert.equal(skipped.data.score, 40)
assert.equal(skipped.data.totalScore, 220)
assert.ok(skipped.data.report, 'a skipped word still gets a review')
checks += 1

// Replaying the same item id is rejected as stale.
const stale = await call('/run/answer', 'POST', {
	runId,
	itemId: firstItem.id,
	typed: firstItem.en,
	elapsedMs: 100,
	replays: 0,
	revealed: false,
})
assert.equal(stale.status, 409)
assert.equal(stale.data.code, 'stale-item')
checks += 1

// Back to the dashboard and resume: the run continues at the saved sentence.
const dashboard = await call('/profile')
assert.ok(dashboard.data.activeRun)
assert.equal(dashboard.data.activeRun.index, 5)
assert.ok(dashboard.data.today.sentences >= 4)
checks += 1

const resumed = await call('/run/start', 'POST', {})
assert.equal(resumed.data.resumed, false)
assert.equal(resumed.data.index, 5)
assert.ok(resumed.data.item)
checks += 1

// Recovery path for a lost response: the start route hands back the sentence the
// run already holds instead of writing a new one, so a click whose answer never
// arrived is recoverable without paying for another generation.
{
	const beforeCalls = models.itemCalls
	const again = await call('/run/start', 'POST', {})
	assert.equal(again.status, 200)
	assert.equal(again.data.resumed, true, 'the held sentence is resumed, not regenerated')
	assert.equal(again.data.item.id, resumed.data.item.id)
	assert.equal(models.itemCalls, beforeCalls, 'recovering costs no model call')
	checks += 1
}

// Review retry returns the stored review rather than asking the model again.
const before = models.reportCalls
const retried = await call('/report/retry', 'POST', { itemId: third.data.next.id })
assert.equal(retried.status, 200)
if (retried.data.report) assert.equal(models.reportCalls, before, 'the stored review is reused')
checks += 1

// Finish writes a run summary and clears the active run.
const finished = await call('/run/finish', 'POST', {})
assert.equal(finished.data.ok, true)
assert.ok(finished.data.summary)
assert.equal(finished.data.summary.sentences, 5)
assert.equal(finished.data.dashboard.activeRun, null)
assert.equal(finished.data.dashboard.runs.length, 1)
assert.ok(finished.data.dashboard.profile.tags.tense !== undefined)
checks += 1

// The model is down: the sentence is not substituted from a bank — the request
// fails and the page shows the reason.
models.mode = 'fail'
const offline = await call('/run/start', 'POST', {})
assert.equal(offline.status, 503, 'a failed generation is reported, not faked')
assert.equal(offline.data.ok, false)
checks += 1

// Nothing is substituted when the model fails mid-run: the plugin ships no
// sentence bank, so `/run/next` says the generation failed and the page offers a
// retry. The run itself — score, combo, history — is untouched.
models.mode = 'ok'
const midRun = await call('/run/start', 'POST', {})
assert.ok(midRun.data.item, 'the run opened with a model sentence')
models.mode = 'fail'
const failed = await call('/run/next', 'POST', {})
assert.equal(failed.status, 503, 'a failed generation is reported, not faked')
assert.equal(failed.data.code, 'generation-failed')
const survived = await call('/profile')
assert.ok(survived.data.activeRun, 'the run survives the failure')
assert.equal(survived.data.activeRun.combo, midRun.data.combo, 'and keeps its score state')
checks += 1

// The failure is not swallowed: it lands in <storage>/generation.log.
check(() => {
	const log = fs.readFileSync(path.join(storageDir, 'generation.log'), 'utf8')
	assert.ok(log.includes('item generation failed'), 'the reason for the failure is recorded')
	assert.ok(log.includes('model down'), 'the model error is part of the record')
})

// Still no blank page, and the run can be closed.
const closed = await call('/run/finish', 'POST', {})
assert.equal(closed.data.ok, true)
assert.equal(closed.data.dashboard.activeRun, null)
checks += 1

// A bad band is refused.
const badBand = await call('/profile/band', 'POST', { band: 'Z9' })
assert.equal(badBand.status, 400)
checks += 1

// Settings round-trip.
const settings = await call('/profile/settings', 'POST', { settings: { sound: false, rate: 0.7, voiceName: 'Samantha', cefr: 'A2' } })
assert.equal(settings.data.profile.settings.sound, false)
assert.equal(settings.data.profile.settings.rate, 0.7)
assert.equal(settings.data.profile.settings.voiceName, 'Samantha')
assert.equal(settings.data.profile.settings.cefr, 'A2', 'saving an add choice remembers the learner level')
const badCefr = await call('/profile/settings', 'POST', { settings: { cefr: 'Z9' } })
assert.equal(badCefr.data.profile.settings.cefr, 'A2', 'an invalid level is ignored')
checks += 1

// A fabricated quote is dropped from the review before it reaches the page.
models.mode = 'fabricated'
const again = await call('/run/start', 'POST', {})
const fabricated = await call('/run/answer', 'POST', {
	runId: again.data.runId,
	itemId: again.data.item.id,
	typed: 'I like',
	elapsedMs: 900,
	replays: 0,
	revealed: true,
	hadError: false,
	usedBackspace: false,
})
assert.ok(fabricated.data.report)
assert.ok(!String(fabricated.data.report.verdict).includes('zzz'), 'the invented quotation is removed')
checks += 1

// Every sentence request is traced end to end: a "begin" without an "end" is
// the shape of a request that died in flight.
{
	const log = fs.readFileSync(path.join(storageDir, 'requests.log'), 'utf8')
	assert.ok(log.includes('next begin'), 'a sentence request is traced from arrival')
	assert.ok(/next end 200 \d+ms/.test(log), 'the answered request is traced with its status')
	assert.ok(log.includes('start begin') && /start end 200 \d+ms/.test(log), 'the start route is traced too')
	checks += 1
}

// The page reports what it actually saw, so "network error" can be told apart
// from "the Host answered 500".
{
	const reported = await call('/client-log', 'POST', {
		where: 'run/next',
		name: 'TypeError',
		code: '',
		status: 0,
		message: 'Failed to fetch',
	})
	assert.equal(reported.status, 200)
	const log = fs.readFileSync(path.join(storageDir, 'client.log'), 'utf8')
	assert.ok(log.includes('run/next') && log.includes('Failed to fetch'))
	checks += 1
}

// Reset returns the first-run state but keeps the voice preferences.
const reset = await call('/profile/reset', 'POST', {})
assert.equal(reset.data.profile.band, '')
assert.equal(reset.data.runs.length, 0)
assert.equal(reset.data.totals.sentences, 0)
assert.equal(reset.data.activeRun, null)
assert.equal(reset.data.profile.settings.voiceName, 'Samantha', 'reset keeps settings')
checks += 1

check(() => {
	const summary = host.__test.summarizeRun(
		{
			id: 'r-x',
			startedAt: new Date(Date.now() - 9 * 60000).toISOString(),
			score: 240,
			bestCombo: 3,
			results: [
				{ itemId: 'a', result: 'perfect', item: { tags: ['spelling'] } },
				{ itemId: 'b', result: 'great', item: { tags: ['tense'] } },
				{ itemId: 'c', result: 'reveal', item: { tags: ['spelling'] } },
			],
		},
		{ tags: { spelling: 0.2, tense: 0.9 } },
	)
	assert.equal(summary.sentences, 3)
	assert.equal(summary.accuracy, 57)
	assert.equal(summary.grade, 'C', '1.0 + 0.7 + 0 averages 0.57')
	assert.deepEqual(summary.mainIssues, ['spelling', 'tense'], 'the weakest tag is listed first')
	assert.ok(summary.minutes >= 8)
})

/* ═══════════════════════ 9. tag practice ═══════════════════════ */

// The home screen is a list of topics; each sentence is generated from that
// topic's word set, and progress is measured per word, not per sentence count.
{
	const listed = await call('/tags')
	assert.equal(listed.status, 200)
	assert.equal(listed.data.categories.length, 20, 'all topic packs load')
	const cafe = listed.data.categories.find((entry) => entry.id === 'cafe')
	assert.ok(cafe && cafe.words > 100, 'the café set is there')
	assert.equal(cafe.progress.practiced, 0)

	const next = await call('/practice/next', 'POST', { tag: 'cafe' })
	assert.equal(next.status, 200)
	assert.ok(next.data.item && next.data.item.id, 'a sentence comes back')
	assert.ok(next.data.item.en.toLowerCase().includes('latte'), 'the sentence uses the word set')
	assert.ok(next.data.item.en.split(/\s+/).length >= 5, 'and has a dictation length')
	assert.equal(next.data.progress.practiced, 0)

	const done = await call('/practice/done', 'POST', {
		tag: 'cafe',
		itemId: next.data.item.id,
		result: 'perfect',
		words: next.data.item.words.map((word) => word.text),
	})
	assert.equal(done.status, 200)
	assert.equal(done.data.progress.practiced, 1)
	assert.ok(done.data.progress.wordsPracticed > 0, 'word coverage moved')

	const after = await call('/tags')
	const cafeAfter = after.data.categories.find((entry) => entry.id === 'cafe')
	assert.equal(cafeAfter.progress.practiced, 1, 'progress persists')
	assert.equal(cafeAfter.progress.mastery, 1, 'a perfect sentence sets mastery to 1')

	const unknown = await call('/practice/next', 'POST', { tag: 'no-such-tag' })
	assert.equal(unknown.status, 404)
	checks += 1
}

/* ═══════════════════════ 10. manifest & install surface ═══════════════════════ */

check(() => {
	assert.equal(manifest.name, 'dsh-english-dictation')
	assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
	assert.equal(manifest.dsh.client.platform, 'web')
	assert.ok(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0)
	assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-shortcuts'), false, 'the shortcut service is no longer injected')
	assert.ok(manifest.engines.dsh.includes('0.2.2-rc.1'))
	const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
	assert.ok(patch.includes(`id: ${manifest.name}`) || patch.includes("id: dsh-english-dictation"))
	assert.ok(patch.includes('name: ') && patch.includes(manifest.name))
	assert.ok(fs.existsSync(path.join(root, 'icon.svg')), 'the plugin icon ships')
	const icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8')
	assert.ok(icon.includes('viewBox="0 0 120 120"'), 'the icon is the dictation-colorful artwork')
	assert.ok(icon.includes('#F4C64F') && icon.includes('#3BB79C'), 'the plugin icon keeps its own palette')
	assert.equal(icon.includes('currentColor'), false, 'the colourful mark does not inherit a text colour')
	assert.ok(fs.existsSync(path.join(root, 'locale', 'zh.json')))
	assert.ok(fs.existsSync(path.join(root, 'locale', 'en.json')))
})

check(() => {
	// locale/*.json is what the plugin manager shows for this bundle.
	for (const locale of ['zh', 'en']) {
		const dict = JSON.parse(fs.readFileSync(path.join(root, 'locale', `${locale}.json`), 'utf8'))
		assert.ok(dict.meta && typeof dict.meta.title === 'string' && dict.meta.title !== '')
		const tagline = {
			zh: 'Agent工作的间隙，用英语短文练听写。',
			en: "Practice English dictation with short texts between the agent's tasks.",
		}
		assert.equal(dict.meta.description, tagline[locale], 'the plugin list tagline')
	}
})

fs.rmSync(storageDir, { recursive: true, force: true })
console.log(`✓ ${checks} checks passed`)
