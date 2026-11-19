/**
 * Host half of dsh-english-dictation.
 *
 * It owns three things the browser must not:
 *
 *   1. the local profile (~/.dsh/storages/dsh-english-dictation/profile.json),
 *   2. the deterministic score/theta/tag update after each sentence,
 *   3. the only two model calls — the next sentence and the review.
 *
 * The browser keeps the typing, the TTS and the instant feedback: it never
 * waits for the Host to tell the learner they were right.
 *
 * Routes, all under `/api/dsh-english-dictation`:
 *
 *   GET  /profile          dashboard + archive payload
 *   POST /profile/band     first self-assessment, or a manual band change
 *   POST /profile/settings rate / sound / voice / engine
 *   GET  /tts/status       whether Edge TTS / macOS `say` is available
 *   GET  /audio            one phrase as MP3 (Edge) or WAV (local `say`)
 *   POST /run/start        open or resume a run, returns the sentence to ask
 *   POST /run/answer       score one sentence, then review + next in parallel
 *   POST /run/finish       close the run and write its summary
 *   POST /report/retry     ask again for a review that failed or timed out
 *
 * @see lib/rules.js, lib/prompts.js, lib/store.js, lib/client.js
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEdgeTts } from './edge-tts.js'
import { createLocalTts } from './local-tts.js'
import { createCorpus } from './corpus.js'
import { countWords } from './article.js'
import { createSources, isFetchableUrl } from './sources.js'
import { PROVIDER_BY_ID } from './sources.js'
import { createFavicons } from './favicon.js'
import { seedFirstPractice, firstPracticeUnit } from './first-practice.js'
import { createSourceGenerator } from './generate.js'
import { createArchive, withArchivedSource } from './archive.js'
import { dictationScore, referencePaceOf } from './score.js'
import { isCefr } from './rewrite.js'
import {
	LEVEL_SCORE,
	buildPrompt as buildTagPrompt,
	createTagStore,
	categoryState,
	loadCategories,
	loadCore,
	parseCategoryItems,
	recordResult,
	specFor,
	validateCategoryItem,
	sensesOf,
} from './tags.js'
import {
	API_PREFIX,
	BANDS,
	CLOUD_VOICES,
	RECENT_WINDOW,
	TAGS,
	TAG_LABELS,
	bandOfTheta,
	clamp,
	dayKey,
	emptyProfile,
	normalizeProfile,
	normalizeSentence,
	normalizeWord,
	outcomeOf,
	rollingGrade,
	sanitizeReport,
	sentenceScore,
	streakOf,
	tagMasteryNext,
	targetDifficulty,
	thetaNext,
	thetaOfBand,
	validateItem,
} from './rules.js'
import {
	ITEM_MAX_TOKENS,
	ITEM_TEMPERATURE,
	REPORT_MAX_TOKENS,
	REPORT_TEMPERATURE,
	buildItemPrompt,
	buildReportPrompt,
	itemSystem,
	parseItemResponse,
	parseReportResponse,
	reportSystem,
} from './prompts.js'
import { createStore } from './store.js'

/** Hard dependency: routes need a carrier. `llm` and the model selection are */
/* resolved lazily so a profile without a model still opens the dashboard.    */
export const inject = ['webServer']

/** The plugin directory, where data/categories.json and data/core-words.json live. */
const PLUGIN_DIR = fileURLToPath(new URL('..', import.meta.url))

/** Loaded category packs + core words, read once. */
let tagPacks = null
let tagCore = new Set()
/** Per-category practice state, created once per profile. */
let tagStore = null
let tagStoreDir = ''

/**
 * The category packs and the always-allowed core words.
 * @returns {{categories: object[], byId: Map<string, object>, core: Set<string>}} packs.
 */
function packsOf() {
	if (tagPacks === null) {
		const loaded = loadCategories(PLUGIN_DIR)
		tagPacks = { categories: loaded.categories, byId: loaded.byId }
		tagCore = loadCore(PLUGIN_DIR)
	}
	return { ...tagPacks, core: tagCore }
}

/**
 * Practice state for this profile.
 * @param {object} store - profile store (its dir holds practice.json too).
 * @returns {object} tag store.
 */
function practiceStateOf(store) {
	if (tagStore === null || tagStoreDir !== store.dir) {
		tagStore = createTagStore(store.dir)
		tagStoreDir = store.dir
	}
	return tagStore
}

let corpusClient = null

/** @returns {object} corpus client, created on first use. */
function corpusOf() {
	if (corpusClient === null) {
		const enabled = String(process.env.DSH_DICTATION_CORPUS || '').toLowerCase() !== 'off'
		corpusClient = createCorpus({ enabled })
	}
	return corpusClient
}

/**
 * Compact progress for one category: practiced sentences, word coverage and a
 * rolling quality score.
 * @param {object} category - category.
 * @param {object} state - category state.
 * @returns {object} progress payload.
 */
function tagProgress(category, state) {
	const weight = { perfect: 1, great: 0.85, pass: 0.5, reveal: 0 }
	const results = Array.isArray(state.results) ? state.results : []
	const mastery = results.length > 0 ? results.reduce((sum, result) => sum + (weight[result] || 0), 0) / results.length : 0
	const wordsPracticed = Object.values(state.words || {}).filter((entry) => entry && entry.practiced > 0).length
	return {
		tag: category.id,
		level: category.level,
		practiced: state.practiced || 0,
		wordsPracticed,
		wordsTotal: category.words.length,
		mastery: Math.round(mastery * 100) / 100,
		combo: state.combo || 0,
		bestCombo: state.bestCombo || 0,
		functions: state.functions || {},
	}
}

/**
 * One generated sentence for a category, validated against its word set.
 * @param {object} ctx - host context.
 * @param {object} category - category.
 * @param {object} state - category state.
 * @returns {Promise<object|null>} item, or null.
 */
async function generateTagItem(ctx, category, state, store, core) {
	const recent = Array.isArray(state.recentEn) ? state.recentEn.slice(-40) : []
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const spec = specFor(category, state)
		try {
			const text = await callModel(ctx, {
				system: '你是一位英语听写题库作者，只输出一个 JSON 对象。',
				user: buildTagPrompt(category, spec),
				maxTokens: ITEM_MAX_TOKENS,
				temperature: ITEM_TEMPERATURE,
				timeoutMs: 9000,
			})
			for (const candidate of parseCategoryItems(text)) {
				const verdict = await validateCategoryItem(candidate, category, core, recent)
				if (verdict.ok) return { ...verdict.item, source: `tag:${category.id}`, function: spec.function }
			}
		} catch (error) {
			appendLog(store, 'generation.log', `tag ${category.id}: ${(error && error.message) || error}`)
		}
	}
	appendLog(store, 'generation.log', `tag ${category.id}: no usable sentence in 3 attempts`)
	return null
}

/** Build stamp compared by the offline test with package.json. */
export const BUILD = 'v0.48.1'

/** The one credential this plugin reads; the LLM route uses the same name. */

/**
 * Budget for the one request that writes a sentence: the learner is on the
 * loading screen and nothing is generated ahead of them. The browser waits
 * longer than this on purpose: a page that gives up before the Host can finish
 * throws away a sentence that was generated a moment later.
 */
const NEXT_ITEM_BUDGET_MS = 30000
/** Review budget; `/run/answer` waits at most this long for the review. */
const REPORT_BUDGET_MS = 6000
/** `/run/answer` overall budget: the learner is waiting on the verdict card. */
const ANSWER_BUDGET_MS = 5000

/* ───────────────────────────── HTTP plumbing ───────────────────────────── */

/**
 * Send a JSON body.
 * @param {object} res - response.
 * @param {number} status - status code.
 * @param {unknown} value - payload.
 * @returns {void}
 */
function json(res, status, value) {
	const body = JSON.stringify(value)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-store',
	})
	res.end(body)
}

/**
 * Send an error envelope.
 * @param {object} res - response.
 * @param {number} status - status code.
 * @param {string} code - machine-readable code.
 * @param {string} [message] - human message.
 * @returns {void}
 */
function fail(res, status, code, message = '') {
	json(res, status, { ok: false, code, message })
}

/**
 * Read a JSON request body.
 * @param {object} req - request.
 * @param {number} [limit] - byte cap.
 * @returns {Promise<object>} parsed body.
 */
function readBody(req, limit = 256 * 1024) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		req.on('data', (chunk) => {
			size += chunk.length
			if (size > limit) {
				reject(Object.assign(new Error('body-too-large'), { code: 'body-too-large' }))
				req.destroy()
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8').trim()
			if (raw === '') {
				resolve({})
				return
			}
			try {
				const parsed = JSON.parse(raw)
				resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
			} catch (error) {
				reject(Object.assign(new Error('invalid-json'), { code: 'invalid-body' }))
			}
		})
		req.on('error', reject)
	})
}

/**
 * Resolve a promise with a fallback when the budget expires.
 * @param {Promise<any>} promise - work.
 * @param {number} ms - budget.
 * @param {any} fallback - value on timeout or rejection.
 * @returns {Promise<any>} settled value.
 */
function withBudget(promise, ms, fallback) {
	return new Promise((resolve) => {
		let settled = false
		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			resolve(fallback)
		}, ms)
		promise.then(
			(value) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve(value)
			},
			() => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				resolve(fallback)
			},
		)
	})
}

/* ───────────────────────────── Model calls ───────────────────────────── */

/**
 * Resolve the model route to use: the harness default selection.
 * @param {object} ctx - host context.
 * @returns {{provider: string, model: string}|null} route.
 */
function resolveRoute(ctx) {
	try {
		const service = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : ctx.agentDefaultModel
		if (!service || typeof service.currentSelection !== 'function') return null
		const selection = service.currentSelection()
		const provider = selection && typeof selection.provider === 'string' ? selection.provider : ''
		const model = selection && typeof selection.model === 'string' ? selection.model : ''
		if (provider === '' || model === '') return null
		return { provider, model }
	} catch (error) {
		return null
	}
}

/** Resolved reasoning effort per provider/model; `undefined` means "Host default". */
const effortCache = new Map()

/**
 * The reasoning effort these tiny JSON calls should ask for.
 *
 * Both calls are formatting work: write one sentence, or write one review. The
 * Host default is usually `high`, and extended thinking is billed against the
 * same `maxTokens` budget — a long chain of thought then truncates the JSON, so
 * every attempt comes back unparsable and the page never gets a sentence. Ask
 * for `off` when the model declares it; keep the Host default when it does not.
 * @param {object} llm - llm service.
 * @param {{provider: string, model: string}} route - route.
 * @returns {Promise<string|undefined>} effort id, or undefined for the default.
 */
async function reasoningEffortOf(llm, route) {
	const key = `${route.provider}/${route.model}`
	if (effortCache.has(key)) return effortCache.get(key)
	let effort
	try {
		// The exact-model lookup is the authority (the advisory catalog can be
		// empty); the catalog is only a fallback for older Hosts.
		let info = null
		if (typeof llm.resolveModelInfo === 'function') {
			info = await withBudget(Promise.resolve(llm.resolveModelInfo(route.provider, route.model)), 2500, null)
		}
		if ((!info || !info.reasoning) && typeof llm.listModels === 'function') {
			const listing = await withBudget(Promise.resolve(llm.listModels(route.provider)), 2500, null)
			info = Array.isArray(listing) ? listing.find((entry) => entry && entry.id === route.model) || null : null
		}
		const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts)
			? info.reasoning.efforts.map((entry) => (typeof entry === 'string' ? entry : entry && entry.id)).filter((id) => typeof id === 'string')
			: []
		effort = efforts.includes('off') ? 'off' : undefined
	} catch (error) {
		effort = undefined
	}
	effortCache.set(key, effort)
	return effort
}

/**
 * Stream one small model call and concatenate its text.
 * @param {object} ctx - host context.
 * @param {{system: string, user: string, maxTokens: number, temperature: number, timeoutMs: number}} request - call.
 * @returns {Promise<string>} concatenated text.
 */
async function callModel(ctx, request) {
	const llm = typeof ctx.get === 'function' ? ctx.get('llm') : ctx.llm
	if (!llm || typeof llm.stream !== 'function') throw Object.assign(new Error('model service unavailable'), { code: 'no-llm' })
	const route = resolveRoute(ctx)
	if (route === null) throw Object.assign(new Error('no model route configured'), { code: 'no-route' })
	const reasoningEffort = await reasoningEffortOf(llm, route)
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), request.timeoutMs)
	try {
		let text = ''
		const stream = llm.stream({
			provider: route.provider,
			model: route.model,
			system: request.system,
			messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
			temperature: request.temperature,
			maxTokens: request.maxTokens,
			...(reasoningEffort === undefined ? {} : { reasoningEffort }),
			signal: controller.signal,
		})
		for await (const chunk of stream) {
			if (!chunk || typeof chunk !== 'object') continue
			if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
			if (chunk.type === 'finish' && chunk.reason) {
				const kind = chunk.reason.kind
				if (kind === 'error') throw Object.assign(new Error('model error'), { code: 'model-error' })
				if (kind === 'aborted') throw Object.assign(new Error('model aborted'), { code: 'aborted' })
				// Truncated output can never parse as JSON: say so instead of
				// handing the parser half an object.
				if (kind === 'max-tokens') throw Object.assign(new Error('max-tokens'), { code: 'max-tokens' })
			}
		}
		return text
	} finally {
		clearTimeout(timer)
	}
}

/* ───────────────────────────── Profile helpers ───────────────────────────── */

/**
 * The three weakest error tags that have data.
 * @param {object} profile - profile.
 * @param {number} [limit] - how many.
 * @returns {string[]} tag ids, weakest first.
 */
function weakTagsOf(profile, limit = 3) {
	return Object.entries(profile.tags)
		.filter(([, mastery]) => Number.isFinite(mastery))
		.sort((left, right) => left[1] - right[1])
		.slice(0, limit)
		.map(([tag]) => tag)
}

/**
 * Sentences to avoid, most recent last.
 * @param {object} run - active run.
 * @returns {string[]} sentences.
 */
function recentSentences(run) {
	if (!run) return []
	return run.results
		.slice(-RECENT_WINDOW)
		.map((entry) => (entry && typeof entry.en === 'string' ? entry.en : ''))
		.filter((line) => line !== '')
}

/** Every word needs its Chinese gloss: the input screen shows it. */
function hasWordGloss(item) {
	return Boolean(item && Array.isArray(item.words) && item.words.length > 0) &&
		item.words.every((word) => typeof word.zh === 'string' && word.zh !== '')
}

/**
 * The next sentence for the Run: generated now, never ahead of time.
 * @param {object} ctx - host context.
 * @param {object} profile - profile.
 * @param {object} run - active run.
 * @param {object} store - profile store, for the failure log.
 * @returns {Promise<object|null>} a valid item, or null.
 */
async function nextItem(ctx, profile, run, store) {
	const target = targetDifficulty(profile.theta, run.results.length)
	return withBudget(generateItem(ctx, profile, run, target, store), NEXT_ITEM_BUDGET_MS, null)
}

/**
 * Append one line to a diagnostic file under the storage dir, keeping it small.
 *
 * The Desktop Host's console is not visible, so "the model never gave me a
 * sentence" or "the page never got the answer" would otherwise leave nothing
 * behind. Three files carry the evidence:
 *
 *   generation.log  the model produced no usable sentence, and why
 *   requests.log    begin/end of every sentence request, with the real status
 *   client.log      what the page saw when it gave up (posted by the page)
 *
 * @param {object} store - profile store.
 * @param {string} name - file name.
 * @param {string} line - one record.
 * @returns {void}
 */
function appendLog(store, name, line) {
	try {
		const file = path.join(store.dir, name)
		const stamp = new Date().toISOString()
		fs.appendFileSync(file, `${stamp} ${line}\n`, 'utf8')
		const { size } = fs.statSync(file)
		if (size > 40960) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-20480), 'utf8')
	} catch (error) {
		/* diagnostics must never break the practice flow */
	}
}

/**
 * Wrap a sentence route so both ends of it are recorded.
 *
 * A "begin" without a matching "end" is the signature of a request that died
 * in flight: the Host never answered, so the page can only report a network
 * error while a sentence may still have been written.
 * @param {object} store - profile store.
 * @param {string} name - route name for the log.
 * @param {Function} handler - route handler.
 * @returns {Function} wrapped handler.
 */
function traced(store, name, handler) {
	return async (req, res) => {
		const started = Date.now()
		appendLog(store, 'requests.log', `${name} begin`)
		let status = 0
		const writeHead = res.writeHead.bind(res)
		res.writeHead = (code, ...rest) => {
			status = code
			return writeHead(code, ...rest)
		}
		try {
			await handler(req, res)
		} finally {
			res.writeHead = writeHead
			appendLog(store, 'requests.log', `${name} end ${status} ${Date.now() - started}ms`)
		}
	}
}

/**
 * Let the model pick, for every word, which dictionary sense fits the sentence.
 *
 * The dictionary supplies the senses (so the annotation is always real); the
 * model only answers with indexes. Any failure keeps the existing glosses.
 *
 * @param {object} ctx - host context.
 * @param {object} item - validated item with dictionary glosses.
 * @returns {Promise<object>} the item, possibly re-glossed.
 */
async function selectSenses(ctx, item) {
	try {
		const words = Array.isArray(item.words) ? item.words : []
		const listing = []
		for (const word of words) {
			const senses = await sensesOf(word.text)
			if (senses.length > 1) listing.push({ word, senses })
		}
		if (listing.length === 0) return item
		const lines = listing.map(({ word, senses }) =>
			`${word.text}: ${senses.map((sense, index) => `${index + 1}) ${sense.zh}(${sense.pos})`).join(' ')}`,
		)
		const reply = await callModel(ctx, {
			system: 'You pick dictionary senses. Reply with the JSON object only.',
			user: `sentence: ${item.en}\nPick the sense of each word that fits this sentence.\n${lines.join('\n')}\n` +
				'Reply: {"words":[{"text":"word","sense":1}]}',
			maxTokens: 300,
			temperature: 0,
			timeoutMs: 6000,
		})
		const match = String(reply || '').match(/\{[\s\S]*\}/)
		if (!match) return item
		const parsed = JSON.parse(match[0])
		const picked = Array.isArray(parsed.words) ? parsed.words : []
		for (const entry of picked) {
			const target = words.find((word) => String(word.text).toLowerCase() === String(entry.text || '').toLowerCase())
			const found = listing.find((row) => row.word === target)
			if (!target || !found) continue
			const index = Number(entry.sense) - 1
			if (!Number.isInteger(index) || index < 0 || index >= found.senses.length) continue
			const sense = found.senses[index]
			target.zh = sense.zh
			if (sense.pos !== 'other') target.pos = sense.pos
		}
	} catch (error) {
		/* keep the dictionary's first sense */
	}
	return item
}

/**
 * Ask the model for one sentence and validate it, retrying twice.
 * @param {object} ctx - host context.
 * @param {object} profile - profile.
 * @param {object} run - active run.
 * @param {number} target - target difficulty.
 * @param {object} [store] - profile store, for the failure log.
 * @returns {Promise<object|null>} a valid item, or null.
 */
async function generateItem(ctx, profile, run, target, store) {
	const recent = recentSentences(run)
	let lastError = ''
	let lastLength = 0
	const startedAt = Date.now()
	// Variety comes from a real corpus, not from the model's imagination: pull a
	// human-written sentence and let the model rewrite it to the target level.
	// A missing seed is not a failure — the sentence is then written from scratch.
	const seedStartedAt = Date.now()
	const seed = await corpusOf()
		.seed()
		.catch(() => null)
	if (store) {
		appendLog(store, 'corpus.log', seed ? `seed ${Date.now() - seedStartedAt}ms: ${seed.en}` : `no seed after ${Date.now() - seedStartedAt}ms`)
	}
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const text = await callModel(ctx, {
				system: itemSystem(target),
				user: buildItemPrompt({
					difficulty: target,
					asked: run.results.length,
					weakTags: weakTagsOf(profile, 3),
					recent,
					band: profile.band,
					seed: seed || undefined,
				}),
				maxTokens: ITEM_MAX_TOKENS,
				temperature: ITEM_TEMPERATURE,
				timeoutMs: 9000,
			})
			lastLength = text.length
			const verdict = validateItem(parseItemResponse(text), { targetDifficulty: target, recent })
			if (verdict.ok) {
				// The input screen shows a Chinese prompt per word: never accept an item
				// that the model generated without its glosses.
				const glossed = verdict.item.words.every((word) => typeof word.zh === 'string' && word.zh !== '')
				if (glossed) return { ...verdict.item, source: 'ai' }
				lastError = 'missing-word-zh'
			} else {
				lastError = verdict.errors.join(',')
			}
		} catch (error) {
			lastError = error && error.message ? error.message : 'model-error'
		}
	}
	if (lastError !== '') {
		const record = `item generation failed after 3 attempts in ${Date.now() - startedAt} ms: ${lastError} (last reply ${lastLength} chars, difficulty target ${target.toFixed(1)})`
		console.warn(`[dsh-english-dictation] ${record}`)
		if (store) appendLog(store, 'generation.log', record)
	}
	return null
}

/**
 * Ask the model for one review and sanitize it against the answer.
 * @param {object} ctx - host context.
 * @param {object} profile - profile.
 * @param {object} entry - the stored answer result.
 * @returns {Promise<object|null>} sanitized report, or null.
 */
async function generateReport(ctx, profile, entry) {
	try {
		const text = await callModel(ctx, {
			system: reportSystem(),
			user: buildReportPrompt({
				item: entry.item,
				typed: entry.typed,
				result: entry.result,
				elapsedMs: entry.elapsedMs,
				replays: entry.replays,
				revealed: entry.revealed,
				hadError: entry.hadError,
				usedBackspace: entry.usedBackspace,
				skipped: Array.isArray(entry.skippedWords)
					? entry.skippedWords.map((index) => (entry.item && entry.item.words && entry.item.words[index] ? entry.item.words[index].text : '')).filter((word) => word !== '')
					: [],
				theta: profile.theta,
			}),
			maxTokens: REPORT_MAX_TOKENS,
			temperature: REPORT_TEMPERATURE,
			timeoutMs: REPORT_BUDGET_MS,
		})
		const verdict = sanitizeReport(parseReportResponse(text), { typed: entry.typed, answer: entry.en, tags: entry.item?.tags })
		if (!verdict.ok) {
			console.warn(`[dsh-english-dictation] review rejected: ${verdict.errors.join(',')}`)
			return null
		}
		if (verdict.dropped.length > 0) {
			console.log(`[dsh-english-dictation] dropped fabricated quote(s): ${verdict.dropped.join(' | ')}`)
		}
		return verdict.report
	} catch (error) {
		return null
	}
}

/**
 * Add one answered sentence to today's counters.
 * @param {object} profile - profile.
 * @param {number} elapsedMs - time on the sentence.
 * @returns {void}
 */
function touchToday(profile, elapsedMs) {
	const key = dayKey()
	const day = profile.stats.days[key] || { sentences: 0, minutes: 0, seconds: 0 }
	day.sentences += 1
	day.seconds = Math.max(0, Number(day.seconds) || 0) + Math.max(0, Number(elapsedMs) || 0) / 1000
	day.minutes = Math.round(day.seconds / 60)
	profile.stats.days[key] = day
	profile.stats.sentences += 1
}

/**
 * Build the full dashboard payload.
 * @param {object} profile - profile.
 * @returns {object} payload.
 */
function dashboard(profile) {
	const today = profile.stats.days[dayKey()] || { sentences: 0, minutes: 0 }
	const weak = weakTagsOf(profile, 3).map((tag) => ({ tag, label: TAG_LABELS[tag] || tag, mastery: profile.tags[tag] }))
	const run = profile.activeRun
	return {
		ok: true,
		profile: {
			theta: Math.round(profile.theta * 10) / 10,
			band: profile.band,
			estimatedBand: bandOfTheta(profile.theta),
			tags: profile.tags,
			settings: profile.settings,
		},
		today: { sentences: today.sentences, minutes: today.minutes },
		totals: {
			runs: profile.stats.runs,
			sentences: profile.stats.sentences,
			minutes: profile.stats.minutes,
			replays: profile.stats.replays,
		},
		streak: streakOf(profile.stats.days),
		weak,
		lastRun: profile.runs[0] || null,
		runs: profile.runs.slice(0, 20),
		activeRun: run
			? {
					id: run.id,
					startedAt: run.startedAt,
					index: run.results.length,
					score: run.score,
					combo: run.combo,
					bestCombo: run.bestCombo,
					hasItem: Boolean(run.current),
					grade: rollingGrade(run.results),
				}
			: null,
	}
}

/**
 * Summarize one finished run.
 * @param {object} run - finished run.
 * @returns {object} summary.
 */
function summarizeRun(run, profile) {
	const grade = rollingGrade(run.results)
	const seen = new Set()
	for (const entry of run.results) {
		for (const tag of entry.item?.tags || []) seen.add(tag)
	}
	// Order the touched tags by how poorly they were mastered: that is what the
	// dashboard calls "主要问题".
	const issues = [...seen].sort((left, right) => {
		const a = profile && Number.isFinite(profile.tags[left]) ? profile.tags[left] : 0.5
		const b = profile && Number.isFinite(profile.tags[right]) ? profile.tags[right] : 0.5
		return a - b
	})
	const started = Date.parse(run.startedAt)
	const ended = Date.now()
	return {
		id: run.id,
		startedAt: run.startedAt,
		endedAt: new Date(ended).toISOString(),
		sentences: run.results.length,
		accuracy: Math.round(grade.rate * 100),
		grade: grade.grade,
		score: run.score,
		bestCombo: run.bestCombo,
		minutes: Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 60000)) : 0,
		mainIssues: issues.slice(0, 3),
	}
}

/* ───────────────────────────── Routes ───────────────────────────── */

/**
 * Mount the plugin.
 * @param {object} ctx - host context.
 * @returns {void}
 */
export function apply(ctx) {
	const store = createStore()
	// A brand-new profile opens on an empty book, which explains nothing. Seed
	// the built-in A2 introduction once; the marker keeps it from coming back
	// after it was removed. Tests turn this off through the env.
	if (String(process.env.DSH_DICTATION_SEED || '').toLowerCase() !== 'off') {
		seedFirstPractice(store.dir)
	}
	// The original DeepSeek audio cache is unused since the Edge/local switch;
	// drop it once so it cannot linger as dead weight on disk.
	try {
		fs.rmSync(path.join(store.dir, 'audio'), { recursive: true, force: true })
	} catch (error) {
		/* already absent or not removable */
	}
	// Edge TTS (online, no key) with the local macOS `say` as the fallback. Both
	// cache under the profile storage directory.
	const edgeTts = createEdgeTts({ dir: store.dir })
	const localTts = createLocalTts({ dir: store.dir })
	const tts = {
		async synthesize(text, voice) {
			const edge = await edgeTts.synthesize(text, voice)
			if (edge) return edge
			return localTts.synthesize(text, voice)
		},
		async status() {
			const edge = await edgeTts.status()
			if (edge.ready) return edge
			return localTts.status()
		},
		async removeMany(texts, voice) {
			const unique = [...new Set((Array.isArray(texts) ? texts : []).map((text) => String(text ?? '').trim()).filter(Boolean))]
			await Promise.allSettled(
				unique.map(async (text) => {
					await edgeTts.remove(text, voice)
					await localTts.remove(text, voice)
				}),
			)
		},
	}

	ctx.effect(() => {
		// Touch the profile once so a corrupt file is quarantined at load time
		// rather than in the middle of a sentence.
		store.read()
		return () => {}
	}, 'dsh-english-dictation: profile')

	/**
	 * Register one exact route, never taking the Host down on failure.
	 * @param {string} path - route path.
	 * @param {Function} handler - handler.
	 * @param {string} label - effect label.
	 * @returns {void}
	 */
	function route(path, handler, label) {
		ctx.effect(() => {
			try {
				return ctx.webServer.register({ kind: 'exact', path, handler })
			} catch (error) {
				console.warn(`[dsh-english-dictation] route ${path} failed: ${error && error.message}`)
				return () => {}
			}
		}, label)
	}

	// GET /tts/status → whether Edge TTS (or local `say`) can synthesize, and
	// the available host voices. The page chooses between host and system voice.
	route(
		`${API_PREFIX}/tts/status`,
		async (req, res) => {
			json(res, 200, await tts.status())
		},
		'dsh-english-dictation: tts status',
	)

	// GET /audio?text=... → Edge MP3, local `say` WAV, else 404 so the page
	// falls back to `speechSynthesis`. The rate is applied by the browser.
	route(
		`${API_PREFIX}/audio`,
		async (req, res) => {
			if (req.method !== 'GET') {
				res.writeHead(405)
				res.end()
				return
			}
			try {
				const url = new URL(req.url || '/', 'http://localhost')
				const text = String(url.searchParams.get('text') || '').slice(0, 400)
				const voice = String(url.searchParams.get('voice') || '').trim()
				const audio = await tts.synthesize(text, voice)
				if (!audio) {
					res.writeHead(404)
					res.end()
					return
				}
				res.writeHead(200, {
					'content-type': audio.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
					'cache-control': 'no-store',
				})
				res.end(audio.bytes)
			} catch (error) {
				res.writeHead(404)
				res.end()
			}
		},
		'dsh-english-dictation: audio',
	)

	const guard = (handler) => async (req, res) => {
		try {
			await handler(req, res)
		} catch (error) {
			const code = error && error.code === 'invalid-body' ? 400 : 500
			if (!res.headersSent) fail(res, code, (error && error.code) || 'internal', String((error && error.message) || ''))
			else res.end()
		}
	}

	// POST /tts/cache {action:'clearTexts', texts, voice} → drop this article's
	// audio after the learner has finished it and left the summary. The client
	// also revokes its prefetched Blob URLs, so the cache really shrinks.
	route(
		`${API_PREFIX}/tts/cache`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const voice = CLOUD_VOICES.includes(String(body.voice || '')) ? String(body.voice) : ''
			if (voice === '') return fail(res, 400, 'bad-voice')
			const texts = Array.isArray(body.texts)
				? [...new Set(body.texts.map((text) => String(text ?? '').trim()).filter((text) => text !== '' && text.length <= 400))]
				: []
			if (texts.length === 0) return fail(res, 400, 'nothing-to-clear')
			await tts.removeMany(texts.slice(0, 100), voice)
			json(res, 200, { ok: true, cleared: Math.min(texts.length, 100) })
		}),
		'dsh-english-dictation: tts cache',
	)

	// ---- page diagnostics ---------------------------------------------------
	//
	// The page reports the error it actually received (fetch failure, status
	// code, message). Without it "the page said network error" cannot be told
	// apart from "the Host answered 500" or "the request never arrived".
	// The corpus client stops with the plugin: no request outlives it.
	ctx.effect(
		() => () => {
			if (corpusClient !== null) corpusClient.stop()
		},
		'dsh-english-dictation: corpus client',
	)

	route(
		`${API_PREFIX}/client-log`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const text = JSON.stringify({
				where: typeof body.where === 'string' ? body.where.slice(0, 40) : '',
				name: typeof body.name === 'string' ? body.name.slice(0, 60) : '',
				code: typeof body.code === 'string' ? body.code.slice(0, 60) : '',
				status: Number.isFinite(Number(body.status)) ? Number(body.status) : 0,
				ms: Number.isFinite(Number(body.ms)) ? Math.round(Number(body.ms)) : 0,
				message: typeof body.message === 'string' ? body.message.slice(0, 160) : '',
			})
			appendLog(store, 'client.log', text)
			json(res, 200, { ok: true })
		}),
		'dsh-english-dictation: page diagnostics route',
	)

	// ---- article library ----------------------------------------------------
	//
	// The add page is one time-ordered stream from several open feeds (see
	// `lib/sources.js` for why these providers and not the obvious ones). The
	// Host aggregates them, drops duplicate URLs and sorts by publication time;
	// the page only renders what it gets.
	const sources = createSources({ dir: store.dir })
	const archive = createArchive({ dir: store.dir })
	const favicons = createFavicons({ dir: path.join(store.dir, 'favicons') })

	// GET /favicon?provider=nasa → the source icon bytes, cached on disk. The
	// page uses it in front of an article title; a provider without an icon
	// answers 404 and the page keeps its fallback square.
	route(
		`${API_PREFIX}/favicon`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const url = new URL(req.url || '/', 'http://localhost')
			const provider = String(url.searchParams.get('provider') || '')
			if (!PROVIDER_BY_ID.has(provider)) return fail(res, 400, 'bad-provider')
			const icon = await favicons.get(provider)
			if (icon === null) return fail(res, 404, 'no-favicon')
			res.writeHead(200, {
				'content-type': icon.type,
				'content-length': icon.bytes.length,
				'cache-control': 'public, max-age=86400',
				'x-content-type-options': 'nosniff',
			})
			res.end(icon.bytes)
		}),
		'dsh-english-dictation: favicon route',
	)

	// GET /sources → the aggregated, time-ordered feed list. Some providers may
	// be unreachable where the learner is; `status` says which, and the list is
	// still usable without them.
	route(
		`${API_PREFIX}/sources`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			// The refresh button asks for `force=1`: the page wants fresh feeds, not
			// the ten-minute list cache. Opening the page keeps the cache so feeds
			// are not hit on every visit.
			const url = new URL(req.url || '/', 'http://localhost')
			const payload = await sources.list({ force: url.searchParams.get('force') === '1' })
			json(res, 200, {
				ok: true,
				items: payload.items,
				status: payload.status,
				fetchedAt: payload.fetchedAt,
				added: payload.added || 0,
				unread: payload.items.filter((row) => row.read !== true).length,
			})
		}),
		'dsh-english-dictation: sources route',
	)

	/**
	 * Translate an article's sentences and tag the proper nouns the learner should
	 * not type. Returns empty arrays on model failure; callers must validate.
	 * @param {object} ctx - plugin context.
	 * @param {string[]} sentences - English sentences.
	 * @returns {Promise<{translations: string[], givens: string[][]}>} result.
	 */
	async function translateArticle(ctx, sentences) {
		const prompt =
			'For each sentence, translate it into natural Chinese and list the names that should be shown to the learner instead of typed: ' +
			'people names, company/brand names, place names and titles. Do not include languages, nationalities, weekdays or months — those belong to the dictation. Do not list ordinary words or pronouns, and do not list a word just because it starts the sentence.\n' +
			'Reply: {"sentences":[{"zh":"…","given":["YouTube","Videos in Levels"]}]}\n' +
			JSON.stringify(sentences)
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const reply = await callModel(ctx, {
					system: 'You translate English for Chinese learners and tag proper nouns. Reply with JSON only.',
					user: prompt,
					maxTokens: 3200,
					temperature: 0,
					timeoutMs: 30000,
				})
				const match = String(reply || '').match(/\{[\s\S]*\}/)
				const parsed = match ? JSON.parse(match[0]) : null
				let translations = []
				let givens = []
				if (parsed && Array.isArray(parsed.sentences)) {
					translations = parsed.sentences.map((entry) => String((entry && entry.zh) || '').trim())
					givens = parsed.sentences.map((entry) => {
						const list = entry && Array.isArray(entry.given) ? entry.given : []
						return [...new Set(list.map((word) => String(word || '').trim()).filter(Boolean))].slice(0, 12)
					})
				} else if (parsed && Array.isArray(parsed.zh)) {
					// Older replies only carried translations.
					translations = parsed.zh.map((item) => String(item || '').trim())
				}
				if (translations.length === sentences.length && translations.every((line) => line !== '')) {
					return { translations, givens }
				}
			} catch (error) {
				/* retry once; a timeout is often transient */
			}
		}
		return { translations: [], givens: [] }
	}

	// The one-call rewrite → exercise → save chain lives in `lib/generate.js`, so
	// its validation and failure codes can be driven without a browser.
	const generator = createSourceGenerator({
		sources,
		store,
		tts,
		callModel: (request) => callModel(ctx, request),
	})

	// GET /sources/article?id=… → the cleaned original text, for the level dialog's
	// preview. The text is cached by the source layer, so the generate call that
	// follows reuses it instead of fetching the page twice.
	route(
		`${API_PREFIX}/sources/article`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const url = new URL(req.url || '/', 'http://localhost')
			const id = String(url.searchParams.get('id') || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			try {
				const article = await sources.article(id)
				if (article === null) return fail(res, 404, 'source-not-found')
				// Opening the preview is reading the article in feed-reader terms.
				sources.markRead(id)
				json(res, 200, {
					ok: true,
					article: {
						id: article.id,
						title: article.title,
						url: article.url,
						source: article.source,
						topic: article.topic,
						publishedAt: article.publishedAt,
						license: article.license,
						attribution: article.attribution,
						text: article.text,
						words: article.textWords,
					},
				})
			} catch (error) {
				const code = error && typeof error.code === 'string' ? error.code : ''
				if (code === 'no-article-text') return fail(res, 422, 'no-article-text')
				return fail(res, 503, 'article-failed')
			}
		}),
		'dsh-english-dictation: source article route',
	)

	// POST /sources/read {id} → mark one article read in the timeline (the page
	// also marks it when the preview loads; this keeps an explicit path for the
	// client's local state and for tests).
	route(
		`${API_PREFIX}/sources/read`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			sources.markRead(id)
			json(res, 200, { ok: true })
		}),
		'dsh-english-dictation: source read route',
	)

	// POST /sources/url {url} → turn a pasted article link into a transient
	// source row (title, summary, text cached in memory). The normal generate
	// route then produces the exercise from it.
	route(
		`${API_PREFIX}/sources/url`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const url = String(body.url || '').trim().slice(0, 2000)
			try {
				const item = await sources.ingest(url)
				json(res, 200, { ok: true, item })
			} catch (error) {
				const code = error && typeof error.code === 'string' ? error.code : ''
				if (code === 'bad-url') return fail(res, 400, 'bad-url')
				if (code === 'no-article-text') return fail(res, 422, 'no-article-text')
				return fail(res, 502, 'source-url-failed')
			}
		}),
		'dsh-english-dictation: source url route',
	)

	// POST /sources/generate {id, cefr, voice} → rewrite one feed article to the
	// requested level, split it into dictation sentences, translate them and add
	// the exercise to the book.
	route(
		`${API_PREFIX}/sources/generate`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			if (!isCefr(body.cefr)) return fail(res, 400, 'bad-cefr')
			const voice = CLOUD_VOICES.includes(String(body.voice || '')) ? String(body.voice) : ''
			const row = await sources.get(id)
			if (row === null) return fail(res, 404, 'source-not-found')
			try {
				const payload = await generator.generate(row, String(body.cefr), voice)
				sources.markRead(id)
				json(res, 200, { ok: true, article: payload.unit, stats: payload.stats })
			} catch (error) {
				const code = error && typeof error.code === 'string' ? error.code : ''
				if (code === 'no-article-text') return fail(res, 422, 'no-article-text')
				if (code === 'rewrite-failed') return fail(res, 502, 'rewrite-failed', String(error.detail || ''))
				if (code === 'translation-failed') return fail(res, 502, 'translation-failed')
				return fail(res, 503, 'generate-failed')
			}
		}),
		'dsh-english-dictation: source generate route',
	)

	// POST /coach {id, sentenceIndex, question, history, answer} → article-scoped
	// teacher answer. The article supplies the context; the client keeps the chat.
	route(
		`${API_PREFIX}/coach`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			const question = String(body.question || '').trim().slice(0, 2000)
			if (question === '') return fail(res, 400, 'empty-question')
			let unit = null
			try {
				unit = JSON.parse(fs.readFileSync(path.join(store.dir, 'articles', `${id}.json`), 'utf8'))
			} catch (error) {
				return fail(res, 404, 'not-found')
			}
			if (!unit || !Array.isArray(unit.sentences) || unit.sentences.length === 0) return fail(res, 404, 'not-found')
			const rawIndex = body.sentenceIndex
			const index = rawIndex === null || rawIndex === undefined || rawIndex === '' ? -1 : Number.isInteger(Number(rawIndex)) ? Math.max(0, Math.min(unit.sentences.length - 1, Number(rawIndex))) : -1
			const current = index >= 0 ? unit.sentences[index] : null
			const context = unit.sentences
				.map((sentence, at) => `${at + 1}. ${sentence.en}\n   ${sentence.zh || ''}`)
				.join('\n')
			const history = (Array.isArray(body.history) ? body.history : [])
				.filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
				.slice(-8)
				.map((message) => `${message.role === 'user' ? 'Learner' : 'Teacher'}: ${String(message.content || '').slice(0, 1200)}`)
				.join('\n')
			const learnerAnswer = String(body.answer || '').trim().slice(0, 500)
			const prompt =
				`Article: ${unit.title || ''}\n` +
				`Sentences:\n${context}\n` +
				(current ? `Current sentence: ${current.en}\nCurrent translation: ${current.zh || ''}\n` : '') +
				(learnerAnswer ? `The learner's typed answer: ${learnerAnswer}\n` : '') +
				(history ? `Conversation so far:\n${history}\n` : '') +
				`Learner's question: ${question}`
			try {
				const answer = await callModel(ctx, {
					system:
						'You are a patient English teacher for a Chinese learner. Answer in Chinese. Quote the exact English from the article. Explain grammar, usage or vocabulary with one short example. Be concise; do not grade the learner or invent facts. If the question is not about English learning, say so briefly.',
					user: prompt,
					maxTokens: 1200,
					temperature: 0.3,
					timeoutMs: 30000,
				})
				const text = String(answer || '').trim()
				if (text === '') return fail(res, 502, 'empty-answer')
				json(res, 200, { ok: true, answer: text })
			} catch (error) {
				fail(res, 503, 'coach-failed')
			}
		}),
		'dsh-english-dictation: coach route',
	)

	// POST /voice {audioBase64, language} → text from the Host's speech service.
	// The browser records PCM; the local SenseVoice provider (Voice Input bundle)
	// owns recognition, so this works without cloud speech access.
	route(
		`${API_PREFIX}/voice`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const base64 = String(body.audioBase64 || '')
			if (base64 === '' || base64.length > 12 * 1024 * 1024) return fail(res, 400, 'bad-audio')
			const speech = typeof ctx.get === 'function' ? ctx.get('speechToText') : ctx.speechToText
			if (!speech || typeof speech.resolve !== 'function' || typeof speech.transcribe !== 'function') {
				return fail(res, 503, 'voice-unavailable')
			}
			let audio
			try {
				audio = new Uint8Array(Buffer.from(base64, 'base64'))
			} catch (error) {
				return fail(res, 400, 'bad-audio')
			}
			if (audio.length === 0) return fail(res, 400, 'bad-audio')
			try {
				const language = String(body.language || 'auto')
				const spec = speech.resolve({ audio, language })
				const transcript = await speech.transcribe(spec, AbortSignal.timeout(60000))
				json(res, 200, { ok: true, text: String((transcript && transcript.text) || '') })
			} catch (error) {
				fail(res, 502, 'voice-failed')
			}
		}),
		'dsh-english-dictation: voice route',
	)

	// POST /articles/remove {id} → move the exercise out of the book. The article
	// source and metadata stay in archive/ so it can be regenerated later; the
	// unit and its progress are deleted.
	route(
		`${API_PREFIX}/articles/remove`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			const dir = path.join(store.dir, 'articles')
			let unit = null
			try {
				unit = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))
			} catch (error) {
				return fail(res, 404, 'not-found')
			}
			if (!unit || unit.id !== id) return fail(res, 404, 'not-found')
			let archived = null
			try {
				archived = archive.save(unit)
			} catch (error) {
				return fail(res, 500, 'archive-failed')
			}
			fs.rmSync(path.join(dir, `${id}.json`), { force: true })
			fs.rmSync(path.join(dir, `${id}.progress.json`), { force: true })
			json(res, 200, { ok: true, archived })
		}),
		'dsh-english-dictation: remove article route',
	)

	// GET /archive/articles → removed exercises, newest removal first.
	route(
		`${API_PREFIX}/archive/articles`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			json(res, 200, { ok: true, articles: archive.list() })
		}),
		'dsh-english-dictation: archived articles route',
	)

	// POST /archive/regenerate {id, voice} → fetch the archived source again and
	// run the same single-call generator at the archived level.
	route(
		`${API_PREFIX}/archive/regenerate`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			const record = archive.get(id)
			if (record === null) return fail(res, 404, 'not-found')
			if (record.builtin === true) {
				const unit = firstPracticeUnit()
				fs.mkdirSync(path.join(store.dir, 'articles'), { recursive: true })
				fs.writeFileSync(path.join(store.dir, 'articles', `${unit.id}.json`), `${JSON.stringify(unit, null, 2)}\n`)
				archive.remove(id)
				return json(res, 200, { ok: true, article: { id: unit.id, title: unit.title, cefr: unit.cefr, sentences: unit.sentences.length, source: unit.source } })
			}
			const sourceUrl = String(record.sourceUrl || (record.source && record.source.url) || record.link || '')
			if (sourceUrl === '' || !isFetchableUrl(sourceUrl)) return fail(res, 422, 'no-source')
			let row = null
			try {
				row = withArchivedSource(await sources.ingest(sourceUrl), record)
			} catch (error) {
				const code = error && typeof error.code === 'string' ? error.code : ''
				if (code === 'bad-url') return fail(res, 400, 'bad-url')
				if (code === 'no-article-text') return fail(res, 422, 'no-article-text')
				return fail(res, 502, 'fetch-failed')
			}
			const level = isCefr(record.cefr) ? record.cefr : 'B1'
			const voice = CLOUD_VOICES.includes(String(body.voice || '')) ? String(body.voice) : ''
			try {
				const payload = await generator.generate(row, level, voice)
				archive.remove(id)
				json(res, 200, { ok: true, article: { id: payload.unit.id, title: payload.unit.title, cefr: payload.unit.cefr, sentences: payload.unit.sentences.length, source: payload.unit.source }, stats: payload.stats })
			} catch (error) {
				const code = error && typeof error.code === 'string' ? error.code : ''
				if (code === 'no-article-text') return fail(res, 422, 'no-article-text')
				if (code === 'rewrite-failed') return fail(res, 502, 'rewrite-failed', String(error.detail || ''))
				return fail(res, 503, 'generate-failed')
			}
		}),
		'dsh-english-dictation: regenerate archived route',
	)

	// GET /articles/saved → the exercise book: one row per generated article,
	// plus the home dashboard's counters.
	//
	// The counters are derived here rather than stored: the progress files are
	// the only truth, so the numbers cannot drift from what the learner actually
	// did, and deleting an article removes its contribution.
	route(
		`${API_PREFIX}/articles/saved`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const dir = path.join(store.dir, 'articles')
			const units = []
			const progressById = new Map()
			const vocabulary = new Set()
			let elapsedMs = 0
			let started = 0
			let done = 0
			let typedWords = 0
			let firstTryWords = 0
			try {
				for (const name of fs.readdirSync(dir)) {
					if (!name.endsWith('.json')) continue
					try {
						const unit = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
						if (!unit || !Array.isArray(unit.sentences)) continue
						// A half-generated unit is not a practice set: keep it out of the
						// library instead of showing a card that cannot be practised.
						if (!unit.sentences.every((sentence) => String(sentence.en || '').trim() !== '' && String(sentence.zh || '').trim() !== '')) {
							continue
						}
						const total = unit.sentences.length
						let progress = null
						try {
							progress = JSON.parse(fs.readFileSync(path.join(dir, `${unit.id}.progress.json`), 'utf8'))
						} catch (error) {
							/* no progress yet */
						}
						const legacyDone = progress && progress.phase === undefined && Number(progress.index) === 0
						const phase = legacyDone
							? 'done'
							: progress && ['typing', 'result', 'done'].includes(progress.phase)
								? progress.phase
								: progress
									? 'typing'
									: 'none'
						const index = progress && Number.isInteger(progress.index) ? progress.index : 0
						const current = phase === 'done' ? total : phase === 'none' ? 0 : Math.min(total, Math.max(1, index + 1))
						const unitElapsed = progress && Number.isFinite(Number(progress.elapsedMs)) ? Math.max(0, Math.floor(Number(progress.elapsedMs))) : 0
						elapsedMs += unitElapsed
						if (progress !== null) started += 1
						if (phase === 'done') done += 1
						// Word coverage and first-try accuracy come from the saved
						// per-word verdicts of every finished sentence. A word counts
						// once no matter how many sentences used it, and the printed
						// (proper-noun) words never count as coverage.
						const records = progress && Array.isArray(progress.records) ? progress.records : []
						if (records.length > 0) progressById.set(unit.id, progress)
						for (const record of records) {
							const words = record && Array.isArray(record.words) ? record.words : []
							for (const entry of words) {
								if (!entry || entry.given === true) continue
								// `plain` is the typed word without its punctuation; an older
								// record may only carry `display`, which is stripped to the same
								// letters so the two shapes count as one word.
								const word = String(entry.plain || entry.display || '')
									.trim()
									.toLowerCase()
									.replace(/[^a-z'-]/g, '')
								if (word === '') continue
								vocabulary.add(word)
								typedWords += 1
								if (Number(entry.attempts) === 1) firstTryWords += 1
							}
						}
						units.push({
							id: unit.id,
							title: unit.title,
							link: unit.link,
							cefr: typeof unit.cefr === 'string' ? unit.cefr : '',
							source: unit.source && typeof unit.source === 'object' ? unit.source : null,
							sentences: total,
							words: unit.sentences.reduce((sum, sentence) => sum + countWords(sentence.en), 0),
							publishedAt: String(unit.publishedAt || ''),
							generatedAt: unit.generatedAt,
							score: progress && progress.score ? progress.score : null,
							started: progress !== null,
							phase,
							current,
							elapsedMs: unitElapsed,
						})
					} catch (error) {
						/* skip a damaged unit */
					}
				}
			} catch (error) {
				/* no saved articles yet */
			}
			// Completed exercises written before scores existed still get a score on
			// the home row: derive it from their stored word records. Nothing is
			// written back; the same records are the truth.
			for (const row of units) {
				if (row.phase !== 'done') continue
				const stored = progressById.get(row.id)
				const storedRecords = stored && Array.isArray(stored.records) ? stored.records : []
				if (row.score && Number.isFinite(Number(row.score.value))) {
					// Older stored scores only carried the replay factor. Fill in the
					// listening dimension from the records for the home average.
					if (row.score.comprehension === undefined && storedRecords.length > 0) {
						const derived = dictationScore(storedRecords, {
							elapsedMs: Number(stored.elapsedMs) || row.elapsedMs,
							referencePace: referencePaceOf(units, row.cefr, row.id),
						})
						row.score = { ...row.score, comprehension: derived.comprehension, efficiencyFactor: derived.efficiencyFactor, listenFactor: derived.listenFactor }
					} else if (row.score.comprehension === undefined && Number.isFinite(Number(row.score.listenFactor))) {
						row.score = { ...row.score, comprehension: Math.round(Math.max(0, Math.min(1, Number(row.score.listenFactor))) * 100) }
					}
					continue
				}
				if (storedRecords.length === 0) continue
				row.score = dictationScore(storedRecords, {
					elapsedMs: Number(stored.elapsedMs) || row.elapsedMs,
					referencePace: referencePaceOf(units, row.cefr, row.id),
				})
			}
			const listeningScores = units
				.filter((row) => row.phase === 'done' && row.score && Number.isFinite(Number(row.score.comprehension)))
				.map((row) => Math.max(0, Math.min(100, Number(row.score.comprehension))))
			const listening = listeningScores.length === 0 ? 0 : Math.round(listeningScores.reduce((sum, value) => sum + value, 0) / listeningScores.length)
			const dictationScores = units
				.filter((row) => row.phase === 'done' && row.score && Number.isFinite(Number(row.score.value)))
				.map((row) => Math.max(0, Math.min(100, Number(row.score.value))))
			const dictation = dictationScores.length === 0 ? 0 : Math.round(dictationScores.reduce((sum, value) => sum + value, 0) / dictationScores.length)
			units.sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || '')))
			json(res, 200, {
				ok: true,
				articles: units,
				summary: {
					articles: units.length,
					started,
					done,
					elapsedMs,
					vocabulary: vocabulary.size,
					accuracy: typedWords === 0 ? 0 : Math.round((firstTryWords / typedWords) * 100),
					listening,
					dictation,
				},
			})
		}),
		'dsh-english-dictation: saved articles route',
	)

	// GET /articles/unit?id=… → one saved article with its sentences.
	route(
		`${API_PREFIX}/articles/unit`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const url = new URL(req.url || '/', 'http://localhost')
			const id = String(url.searchParams.get('id') || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			const requestedVoice = CLOUD_VOICES.includes(String(url.searchParams.get('voice') || ''))
				? String(url.searchParams.get('voice'))
				: ''
			try {
				const unit = JSON.parse(fs.readFileSync(path.join(store.dir, 'articles', `${id}.json`), 'utf8'))
				if (!unit || !Array.isArray(unit.sentences)) return fail(res, 404, 'not-found')
				let progress = null
				try {
					progress = JSON.parse(fs.readFileSync(path.join(store.dir, 'articles', `${id}.progress.json`), 'utf8'))
					if (progress && typeof progress === 'object') {
						unit.progress = progress
						unit.progressIndex = Number.isInteger(progress.index) ? progress.index : 0
					}
				} catch (error) {
					/* no progress yet */
				}
				// Older generations could be saved after a failed translation call; fill
				// those in on open instead of showing an article with no Chinese.
				if (unit.sentences.some((sentence) => !String(sentence.zh || '').trim())) {
					const repaired = await translateArticle(ctx, unit.sentences.map((sentence) => String(sentence.en || '')))
					if (repaired.translations.length === unit.sentences.length) {
						unit.sentences = unit.sentences.map((sentence, at) => ({
							...sentence,
							zh: repaired.translations[at] || sentence.zh || '',
							given: repaired.givens[at] && repaired.givens[at].length > 0 ? repaired.givens[at] : sentence.given || [],
						}))
						try {
							fs.writeFileSync(path.join(store.dir, 'articles', `${id}.json`), JSON.stringify(unit, null, 2))
						} catch (error) {
							/* keep the repaired copy in memory */
						}
					}
				}
				// A unit without full Chinese is not a practice unit. Opening it is
				// rejected instead of letting the learner type against blanks.
				if (unit.sentences.some((sentence) => !String(sentence.zh || '').trim())) {
					return fail(res, 422, 'incomplete-article')
				}
				// Opening a typing sentence: synthesize its audio before answering, so
				// the first sound is ready when the page appears. Result/done and the
				// legacy index-0 completion have nothing to play.
				const phase = progress && progress.phase
				const index = Math.max(0, Math.min(unit.sentences.length - 1, Number(unit.progressIndex) || 0))
				const legacyDone = progress && progress.phase === undefined && Number(progress.index) === 0
				if (requestedVoice && phase !== 'done' && phase !== 'result' && !legacyDone) {
					await tts.synthesize(unit.sentences[index].en, requestedVoice).catch(() => null)
				}
				json(res, 200, { ok: true, article: unit })
			} catch (error) {
				fail(res, 404, 'not-found')
			}
		}),
		'dsh-english-dictation: article unit route',
	)

	// POST /articles/progress {id, index} → remember where the reader stopped.
	route(
		`${API_PREFIX}/articles/progress`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const id = String(body.id || '')
			if (!/^[a-f0-9]{8,40}$/.test(id)) return fail(res, 400, 'bad-id')
			// New shape: {progress:{index,phase,records,current,elapsedMs}}. The old
			// {index} body is still accepted as a typing state.
			const source = body.progress && typeof body.progress === 'object' ? body.progress : body
			const index = Math.max(0, Math.floor(Number(source.index ?? body.index) || 0))
			const phase = ['typing', 'result', 'done'].includes(source.phase) ? source.phase : 'typing'
			const records = Array.isArray(source.records) ? source.records : []
			const current = source.current && typeof source.current === 'object' ? source.current : null
			const elapsedMs = Math.max(0, Math.floor(Number(source.elapsedMs) || 0))
			const score =
				source.score && typeof source.score === 'object'
					? {
							value: Math.max(0, Math.min(100, Math.round(Number(source.score.value) || 0))),
							raw: Math.max(0, Number(source.score.raw) || 0),
							listenFactor: Math.max(0.8, Math.min(1, Number(source.score.listenFactor) || 1)),
							comprehension: Math.max(0, Math.min(100, Math.round(Number(source.score.comprehension) || 0))),
							efficiencyFactor: Math.max(0.85, Math.min(1, Number(source.score.efficiencyFactor) || 1)),
							timeRatio: Math.max(0, Number(source.score.timeRatio) || 1),
							pace: Math.max(0, Number(source.score.pace) || 0),
							referencePace: Math.max(0, Number(source.score.referencePace) || 0),
							avgReplay: Math.max(0, Number(source.score.avgReplay) || 0),
							firstTry: Math.max(0, Number(source.score.firstTry) || 0),
							words: Math.max(0, Number(source.score.words) || 0),
							hints: Math.max(0, Number(source.score.hints) || 0),
							replays: Math.max(0, Number(source.score.replays) || 0),
							band: typeof source.score.band === 'string' ? source.score.band : '',
						}
					: null
			const progress = { index, phase, records, current, elapsedMs, score, at: new Date().toISOString() }
			try {
				const dir = path.join(store.dir, 'articles')
				fs.mkdirSync(dir, { recursive: true })
				fs.writeFileSync(path.join(dir, `${id}.progress.json`), JSON.stringify(progress))
			} catch (error) {
				return fail(res, 500, 'write-failed')
			}
			json(res, 200, { ok: true })
		}),
		'dsh-english-dictation: article progress route',
	)

	// ---- tag practice -------------------------------------------------------
	//
	// The word set is the curriculum: the page lists tags, and each sentence is
	// generated from that category's words, then recorded per word so coverage
	// (not "sentences done") is the progress the learner sees.
	route(
		`${API_PREFIX}/tags`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const packs = packsOf()
			const practice = practiceStateOf(store)
			const stored = practice.read()
			json(res, 200, {
				ok: true,
				categories: packs.categories.map((category) => ({
					id: category.id,
					label: category.label,
					group: category.group,
					level: category.level,
					goal: category.goal,
					words: category.words.length,
					progress: tagProgress(category, categoryState(stored, category.id)),
				})),
			})
		}),
		'dsh-english-dictation: tags route',
	)

	route(
		`${API_PREFIX}/practice/next`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const packs = packsOf()
			const category = packs.byId.get(typeof body.tag === 'string' ? body.tag : '')
			if (!category) return fail(res, 404, 'unknown-tag')
			const practice = practiceStateOf(store)
			const state = categoryState(practice.read(), category.id)
			// A generated-but-unpracticed sentence is resumed instead of paying for
			// another model call (a tab switch must not throw the sentence away).
			if (!state.current) {
				const item = await generateTagItem(ctx, category, state, store, packs.core)
				if (item === null) return fail(res, 503, 'generation-failed')
				state.current = item
				practice.save()
			}
			json(res, 200, { ok: true, item: state.current, progress: tagProgress(category, state) })
		}),
		'dsh-english-dictation: practice next route',
	)

	route(
		`${API_PREFIX}/practice/done`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const packs = packsOf()
			const category = packs.byId.get(typeof body.tag === 'string' ? body.tag : '')
			if (!category) return fail(res, 404, 'unknown-tag')
			const practice = practiceStateOf(store)
			const state = categoryState(practice.read(), category.id)
			const item = state.current
			if (!item || (typeof body.itemId === 'string' && item.id !== body.itemId)) {
				return fail(res, 409, 'stale-item')
			}
			const result = ['perfect', 'great', 'pass', 'reveal'].includes(body.result) ? body.result : 'pass'
			const typedWords = Array.isArray(body.words) ? body.words.map((word) => String(word ?? '')) : []
			recordResult(state, item, result, typedWords)
			state.recentEn = [...(Array.isArray(state.recentEn) ? state.recentEn : []), item.en].slice(-40)
			practice.save()
			json(res, 200, { ok: true, progress: tagProgress(category, state) })
		}),
		'dsh-english-dictation: practice done route',
	)

	// ---- dashboard ----------------------------------------------------------
	route(
		`${API_PREFIX}/profile`,
		guard(async (req, res) => {
			if (req.method !== 'GET') return fail(res, 405, 'method-not-allowed')
			const profile = store.read()
			const route = resolveRoute(ctx)
			// The add dialog names the model doing the rewrite; it is the Host's
			// session model, not a plugin-configured one.
			json(res, 200, { ...dashboard(profile), model: route === null ? '' : route.model })
		}),
		'dsh-english-dictation: profile route',
	)

	route(
		`${API_PREFIX}/profile/band`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const band = typeof body.band === 'string' ? body.band : ''
			if (!BANDS.some((entry) => entry.id === band)) return fail(res, 400, 'unknown-band')
			const profile = store.read()
			profile.band = band
			profile.theta = thetaOfBand(band)
			await store.save()
			json(res, 200, dashboard(profile))
		}),
		'dsh-english-dictation: band route',
	)

	route(
		`${API_PREFIX}/profile/settings`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const profile = store.read()
			const settings = body.settings && typeof body.settings === 'object' ? body.settings : body
			if (settings.rate !== undefined) profile.settings.rate = clamp(Number(settings.rate) || 0.95, 0.5, 1.5)
			if (typeof settings.sound === 'boolean') profile.settings.sound = settings.sound
			if (typeof settings.voiceName === 'string') profile.settings.voiceName = settings.voiceName.slice(0, 120)
			if (settings.engine === 'cloud' || settings.engine === 'system') profile.settings.engine = settings.engine
			if (CLOUD_VOICES.includes(settings.cloudVoice)) profile.settings.cloudVoice = settings.cloudVoice
			// The learner's own level: the add dialog preselects it and saving a new
			// pick updates it, so the next article is one click away.
			if (isCefr(settings.cefr)) profile.settings.cefr = settings.cefr
			// A manual band change only steers the next selection; history stays.
			if (typeof body.band === 'string' && BANDS.some((entry) => entry.id === body.band)) {
				profile.band = body.band
				profile.theta = thetaOfBand(body.band)
			}
			await store.save()
			json(res, 200, dashboard(profile))
		}),
		'dsh-english-dictation: settings route',
	)

	// ---- run ----------------------------------------------------------------
	// Resetting the profile is a maintenance route rather than a UI: it exists so a
	// learner (or a support session) can start from the self-assessment card again
	// without deleting files by hand. Settings survive it.
	route(
		`${API_PREFIX}/profile/reset`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const profile = store.read()
			const settings = { ...profile.settings }
			const fresh = emptyProfile()
			fresh.settings = settings
			for (const key of Object.keys(profile)) delete profile[key]
			Object.assign(profile, fresh)
			await store.save()
			json(res, 200, dashboard(profile))
		}),
		'dsh-english-dictation: profile reset route',
	)

	route(
		`${API_PREFIX}/run/start`,
		traced(store, 'start', guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const profile = store.read()
			if (profile.activeRun !== null) {
				const run = profile.activeRun
				const resumed = run.current !== null
				let item = resumed ? run.current : await nextItem(ctx, profile, run, store)
				// A stored old sentence without per-word glosses is replaced once; a
				// fresh generation is already glossed, so never wait twice there.
				if (resumed && !hasWordGloss(item)) {
					const fresh = await nextItem(ctx, profile, run, store)
					if (fresh !== null) item = fresh
				}
				if (item === null) {
					fail(res, 503, 'generation-failed')
					return
				}
				run.current = item
				await store.save()
				json(res, 200, {
					ok: true,
					runId: run.id,
					item,
					resumed,
					index: run.results.length,
					score: run.score,
					combo: run.combo,
					bestCombo: run.bestCombo,
					grade: rollingGrade(run.results),
					settings: profile.settings,
				})
				return
			}
			const run = {
				id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				startedAt: new Date().toISOString(),
				index: 0,
				score: 0,
				combo: 0,
				bestCombo: 0,
				replays: 0,
				results: [],
				current: null,
			}
			profile.activeRun = run
			const item = await nextItem(ctx, profile, run, store)
			if (item === null) {
				profile.activeRun = null
				await store.save()
				fail(res, 503, 'generation-failed')
				return
			}
			run.current = item
			await store.save()
			json(res, 200, {
				ok: true,
				runId: run.id,
				item,
				resumed: false,
				index: 0,
				score: 0,
				combo: 0,
				bestCombo: 0,
				grade: rollingGrade([]),
				settings: profile.settings,
			})
		})),
		'dsh-english-dictation: run start route',
	)

	route(
		`${API_PREFIX}/run/next`,
		traced(store, 'next', guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const profile = store.read()
			if (profile.activeRun === null) return fail(res, 409, 'no-run')
			const run = profile.activeRun
			// Nothing was generated ahead of this click: this is the one model call
			// that writes the sentence the learner is waiting for.
			const generated = await nextItem(ctx, profile, run, store)
			// There is no packaged sentence bank: if no usable sentence was produced,
			// say so. The run — its score, combo and history — stays exactly as it
			// was, and the page offers a retry instead of a substitute.
			if (generated === null) {
				appendLog(store, 'generation.log', 'run/next produced no usable sentence')
				fail(res, 503, 'generation-failed')
				return
			}
			run.current = generated
			await store.save()
			json(res, 200, { ok: true, item: generated, index: run.results.length })
		})),
	)

	route(
		`${API_PREFIX}/run/answer`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const profile = store.read()
			const run = profile.activeRun
			if (!run) return fail(res, 409, 'no-active-run')
			if (typeof body.runId === 'string' && body.runId !== run.id) return fail(res, 409, 'stale-run')
			const item = run.current
			if (!item || item.id !== body.itemId) return fail(res, 409, 'stale-item')

			const typed = typeof body.typed === 'string' ? body.typed.slice(0, 2000) : ''
			const elapsedMs = clamp(Number(body.elapsedMs) || 0, 0, 600000)
			const replays = clamp(Math.floor(Number(body.replays) || 0), 0, 99)
			const revealed = body.revealed === true
			const hadError = body.hadError === true
			const usedBackspace = body.usedBackspace === true
			// A word the learner skipped is a missed word (漏词), not a reveal: the
			// sentence still counts as passed so one unknown word does not cost the
			// whole sentence. Indexes are validated against the sentence itself.
			const skippedWords = Array.isArray(body.skippedWords)
				? Array.from(
						new Set(
							body.skippedWords.filter(
								(index) => Number.isInteger(index) && index >= 0 && index < item.words.length,
							),
						),
					).sort((left, right) => left - right)
				: []
			const expectedTyped = item.words
				.map((word, index) => (skippedWords.includes(index) ? '' : normalizeWord(word.text)))
				.filter((word) => word !== '')
				.join(' ')
			const matches = normalizeSentence(typed) === expectedTyped
			// The Host owns the points. Because the page lets a wrong character stay
			// on screen (flagged red), a submitted sentence can be wrong: that is 过关,
			// not 放弃 — only «看答案» is worth zero.
			const result = revealed
				? 'reveal'
				: !matches || hadError || skippedWords.length > 0
					? 'pass'
					: usedBackspace
						? 'great'
						: 'perfect'
			const comboBefore = run.combo
			const points = sentenceScore(result, comboBefore)

			run.combo = result === 'perfect' || result === 'great' ? comboBefore + 1 : 0
			run.bestCombo = Math.max(run.bestCombo, run.combo)
			run.score += points
			run.replays += replays
			profile.stats.replays += replays
			const entry = {
				itemId: item.id,
				en: item.en,
				item: { id: item.id, en: item.en, zh: item.zh, words: item.words, tags: item.tags, difficulty: item.difficulty },
				typed,
				result,
				elapsedMs,
				replays,
				revealed,
				hadError,
				usedBackspace,
				skippedWords,
				points,
				comboBefore,
				comboAfter: run.combo,
				at: new Date().toISOString(),
				report: null,
			}
			run.results.push(entry)
			run.index = run.results.length
			run.current = null

			profile.theta = thetaNext(profile.theta, item.difficulty, result)
			const outcome = outcomeOf(result)
			for (const tag of item.tags) {
				const mastery = Number.isFinite(profile.tags[tag]) ? profile.tags[tag] : 0.5
				profile.tags[tag] = tagMasteryNext(mastery, result)
				const stats = profile.tagStats[tag] || { count: 0, lastOutcome: 1 }
				profile.tagStats[tag] = { ...stats, count: stats.count + 1, lastOutcome: outcome }
			}
			touchToday(profile, elapsedMs)
			await store.save()

			const grade = rollingGrade(run.results)

			// Scoring already saved; the review is the only model call on this path
			// (the next sentence waits for 「继续」), and it is capped so the verdict
			// card never waits more than the documented five seconds.
			const reviewPromise = withBudget(generateReport(ctx, profile, entry), REPORT_BUDGET_MS, null).then(async (report) => {
				if (report !== null) {
					entry.report = report
					try {
						await store.save()
					} catch (error) {
						/* the review is already in the response */
					}
				}
				return report
			})
			// The next sentence is generated only when 「继续」 asks for it
			// (POST /run/next), so this route has no second model call to wait on.
			const report = await withBudget(reviewPromise, ANSWER_BUDGET_MS, null)
			run.current = null
			await store.save()

			json(res, 200, {
				ok: true,
				result,
				combo: run.combo,
				comboBefore,
				score: points,
				totalScore: run.score,
				bestCombo: run.bestCombo,
				grade: grade.grade,
				gradeRate: grade.rate,
				gradeSample: grade.sample,
				gradeLow: grade.low,
				theta: Math.round(profile.theta * 10) / 10,
				report,
				next: null,
				mismatch: !matches,
			})
		}),
		'dsh-english-dictation: run answer route',
	)

	route(
		`${API_PREFIX}/run/finish`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const profile = store.read()
			const run = profile.activeRun
			if (!run) {
				json(res, 200, { ok: true, empty: true, dashboard: dashboard(profile) })
				return
			}
			const summary = summarizeRun(run, profile)
			if (run.results.length > 0) {
				profile.runs = [summary, ...profile.runs].slice(0, 60)
				profile.stats.runs += 1
				profile.stats.minutes += summary.minutes
			}
			profile.activeRun = null
			await store.save()
			json(res, 200, { ok: true, summary, dashboard: dashboard(profile) })
		}),
		'dsh-english-dictation: run finish route',
	)

	route(
		`${API_PREFIX}/report/retry`,
		guard(async (req, res) => {
			if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed')
			const body = await readBody(req)
			const profile = store.read()
			const run = profile.activeRun
			if (!run) return fail(res, 409, 'no-active-run')
			const entry = [...run.results].reverse().find((candidate) => candidate.itemId === body.itemId)
			if (!entry) return fail(res, 404, 'unknown-item')
			if (entry.report) {
				json(res, 200, { ok: true, report: entry.report })
				return
			}
			const report = await withBudget(generateReport(ctx, profile, entry), REPORT_BUDGET_MS, null)
			if (report === null) {
				json(res, 200, { ok: false, code: 'report-failed', report: null })
				return
			}
			entry.report = report
			await store.save()
			json(res, 200, { ok: true, report })
		}),
		'dsh-english-dictation: report retry route',
	)
}

/* ───────────────────────────── Test surface ───────────────────────────── */

export const __test = {
	NEXT_ITEM_BUDGET_MS,
	reasoningEffortOf,
	callModel,
	dashboard,
	summarizeRun,
	resolveRoute,
	weakTagsOf,
	recentSentences,
	emptyProfile,
	normalizeProfile,
	corpusOf,
	TAGS,
}
