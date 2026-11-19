/**
 * One source article → one saved exercise, in one model call.
 *
 * The source supplies a topic and an outline, not a text to translate. A single
 * call rewrites that outline into a levelled exercise and returns the whole
 * exercise JSON: the title, every dictation sentence with its Chinese
 * translation and its given (proper-noun) words, and the questions a learner is
 * likely to ask about this article. There is no second translation call and no
 * retry loop: the output is normalised and checked once, and a bad reply is a
 * `rewrite-failed` with the reason rather than another paid round trip.
 *
 * The generator knows nothing about HTTP or the plugin context: sources, store,
 * tts and the model call are injected.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeRewriteText, validateRewrite } from './rewrite.js'
import {
	EXERCISE_MAX_TOKENS,
	EXERCISE_TEMPERATURE,
	buildExercisePrompt,
	exerciseSystem,
	parseExerciseResponse,
} from './prompts.js'

/** Failure codes the route turns into HTTP replies. */
export const GENERATE_ERRORS = {
	noText: 'no-article-text',
	rewrite: 'rewrite-failed',
	translation: 'translation-failed',
}

/** A dictation sentence is 4–24 words; anything else is not usable. */
const MIN_SENTENCE_WORDS = 4
const MAX_SENTENCE_WORDS = 24
/** Fewer than this cannot make a practice run. */
const MIN_EXERCISE_SENTENCES = 4
/** A runaway reply is not an exercise either. */
const MAX_EXERCISE_SENTENCES = 24

/**
 * Create the source → exercise generator.
 * @param {object} deps - injected collaborators.
 * @param {object} deps.sources - source layer (`article(id)`).
 * @param {object} deps.store - profile store (`dir`).
 * @param {{synthesize: Function}} deps.tts - speech engine (prewarm only).
 * @param {Function} deps.callModel - `(ctx, request) => Promise<string>`.
 * @param {() => Date} [deps.now] - clock, for the saved timestamp.
 * @returns {{generate: Function}} generator.
 */
export function createSourceGenerator(deps) {
	const { sources, store, tts, callModel } = deps
	const now = typeof deps.now === 'function' ? deps.now : () => new Date()

	const failure = (reason) => Object.assign(new Error(`rewrite-failed: ${reason}`), {
		code: GENERATE_ERRORS.rewrite,
		detail: reason,
	})

	/**
	 * Generate and save one exercise.
	 * @param {object} row - aggregated source row.
	 * @param {string} cefr - target level.
	 * @param {string} voice - cloud voice to prewarm, or ''.
	 * @returns {Promise<{unit: object, stats: object}>} saved unit and level stats.
	 */
	async function generate(row, cefr, voice) {
		let article = null
		try {
			article = await sources.article(row.id)
		} catch (error) {
			if (error && error.code === GENERATE_ERRORS.noText) throw error
			throw Object.assign(new Error('no-article-text'), { code: GENERATE_ERRORS.noText })
		}
		if (article === null) {
			throw Object.assign(new Error('no-article-text'), { code: GENERATE_ERRORS.noText })
		}
		let reply = ''
		try {
			reply = await callModel({
				system: exerciseSystem(cefr),
				user: buildExercisePrompt({ level: cefr, title: article.title, text: article.text }),
				maxTokens: EXERCISE_MAX_TOKENS,
				temperature: EXERCISE_TEMPERATURE,
				timeoutMs: 60000,
			})
		} catch (error) {
			throw failure('模型没有返回结果')
		}
		const parsed = parseExerciseResponse(reply)
		if (parsed === null) throw failure('模型没有返回合法的练习题 JSON')

		// Normalise the model's typographic habits before judging the sentences.
		const sentences = []
		for (const row of parsed.sentences) {
			const en = normalizeRewriteText(row.en)
			if (en === '') continue
			const words = en.split(/\s+/).filter(Boolean)
			const number = sentences.length + 1
			if (words.length < MIN_SENTENCE_WORDS || words.length > MAX_SENTENCE_WORDS) {
				throw failure(`第 ${number} 句有 ${words.length} 个词，要求 ${MIN_SENTENCE_WORDS}–${MAX_SENTENCE_WORDS} 个词`)
			}
			if (row.zh === '') throw failure(`第 ${number} 句缺少中文翻译`)
			const given = row.given
				.filter((name) => typeof name === 'string' && name.trim() !== '' && en.toLowerCase().includes(name.toLowerCase()))
				.slice(0, 8)
			sentences.push({ en, zh: row.zh, given })
		}
		if (sentences.length < MIN_EXERCISE_SENTENCES) {
			throw failure(`只有 ${sentences.length} 句，至少 ${MIN_EXERCISE_SENTENCES} 句`)
		}
		if (sentences.length > MAX_EXERCISE_SENTENCES) {
			throw failure(`句子太多：${sentences.length} 句，最多 ${MAX_EXERCISE_SENTENCES} 句`)
		}
		// The level lives in the syntax and vocabulary of the whole passage; the
		// sentence/word counts are exercise length, so they are not judged here.
		const verdict = validateRewrite(sentences.map((line) => line.en).join(' '), cefr, article.text, { length: false })
		if (!verdict.ok) throw failure(verdict.reason)

		const questions = parsed.questions.filter((question) => question !== '').slice(0, 4)
		const prewarmAudio = voice !== '' ? tts.synthesize(sentences[0].en, voice).catch(() => null) : null
		const id = /^[a-f0-9]{8,40}$/.test(String(article.id || ''))
			? article.id
			: crypto.createHash('sha1').update(String(article.url)).digest('hex').slice(0, 12)
		const unit = {
			id,
			title: parsed.title || article.title,
			link: article.url,
			cefr,
			publishedAt: article.publishedAt || '',
			source: {
				provider: article.provider,
				label: article.source,
				url: article.url,
				license: article.license,
				attribution: article.attribution,
				title: article.title,
			},
			sentences,
			questions,
			generatedAt: now().toISOString(),
		}
		const dir = path.join(store.dir, 'articles')
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(unit, null, 2))
		try {
			fs.rmSync(path.join(dir, `${id}.progress.json`), { force: true })
		} catch (error) {
			/* a missing progress file is the normal case */
		}
		if (prewarmAudio) await prewarmAudio
		return { unit, stats: verdict.stats }
	}

	return { generate }
}
