/**
 * The built-in first exercise.
 *
 * A brand-new install has an empty book, and an empty book explains nothing.
 * This short A2 article introduces the plugin in its own voice — who made it,
 * what it is for, and how one practice works — so the first thing a learner can
 * do is practise. It is written as a normal saved unit (the same shape the
 * generator writes), which means every screen, the progress file, TTS and ASK AI
 * already work on it without a special case.
 *
 * Seeding is one-shot: a marker in the profile directory records that this
 * profile has received the first practice, so removing the exercise later never
 * makes it come back.
 *
 * @module dsh-english-dictation/first-practice
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Stable id for the built-in article (the same 12-hex shape as generated ids). */
export const FIRST_PRACTICE_ID = crypto.createHash('sha1').update('builtin|first-practice').digest('hex').slice(0, 12)

/** One seed per profile; the marker is written after the unit. */
const MARKER = '.first-practice-seeded'

/** The article's 15 sentences and their Chinese translations. */
const SENTENCES = [
	['Hello, I am Fei.', '你好，我是 Fei。'],
	['I made this plugin for DeepSeek Harness.', '我为 DeepSeek Harness 做了这个插件。'],
	['It helps you learn English while your agent works.', '它帮你在 agent 工作时学英语。'],
	['Your agent often needs time to think.', '你的 agent 经常需要时间思考。'],
	['Those short waits can become useful practice time.', '这些短暂的等待可以变成有用的练习时间。'],
	['Many English apps cost money or feel boring.', '很多英语应用要花钱，或者很无聊。'],
	['This one uses new articles from open websites.', '这个插件使用来自开放网站的新文章。'],
	['The sites include NASA, WHO and other open sources.', '这些网站包括 NASA、WHO 和其他开放来源。'],
	['Open the panel and look at your exercise book.', '打开面板，看看你的练习簿。'],
	['Tap Add Exercise, then choose your level.', '点「添加练习」，然后选择你的等级。'],
	['The agent writes it again at your level.', 'agent 会按你的等级把文章再写一遍。'],
	['Then listen and type each short sentence.', '然后听并输入每个短句。'],
	['The app checks your words at once.', '应用会立刻检查你写的词。'],
	['You can also ask the AI teacher a question.', '你也可以问 AI 老师一个问题。'],
	['Your progress stays on your computer.', '你的进度保存在自己的电脑上。'],
]

/** Questions the built-in practice offers to ASK AI. */
const QUESTIONS = [
	'while 在这里能换成 when 吗？',
	'agent 在英语里通常指什么？',
	'This one 指的是上一句里的什么？',
	'open websites 和 open sources 有什么区别？',
]

/**
 * The built-in unit, in the same shape as a generated exercise.
 * @param {Date} now - seed time (stamped as generatedAt).
 * @returns {object} saved unit.
 */
export function firstPracticeUnit(now = new Date()) {
	return {
		id: FIRST_PRACTICE_ID,
		title: 'Learn English While Your Agent Works',
		link: '',
		cefr: 'A2',
		publishedAt: now.toISOString(),
		source: {
			provider: 'builtin',
			label: 'Fei',
			url: '',
			license: { id: 'original', label: 'Original' },
			attribution: { label: 'Fei', url: '' },
			title: 'Learn English While Your Agent Works',
		},
		sentences: SENTENCES.map(([en, zh]) => ({ en, zh, given: [] })),
		questions: [...QUESTIONS],
		generatedAt: now.toISOString(),
	}
}

/**
 * Seed the first practice once for this profile.
 *
 * Safe to call on every start: an existing marker, or an existing unit, makes it
 * a no-op. The marker is written only after the unit is on disk, so a failed
 * write leaves the next start a chance to try again.
 * @param {string} dir - profile storage directory.
 * @param {() => Date} [now] - clock, for tests.
 * @returns {boolean} true when this call created the exercise.
 */
export function seedFirstPractice(dir, now = () => new Date()) {
	if (typeof dir !== 'string' || dir === '') return false
	const marker = path.join(dir, MARKER)
	const articles = path.join(dir, 'articles')
	const file = path.join(articles, `${FIRST_PRACTICE_ID}.json`)
	const fresh = firstPracticeUnit(now())
	// Keep an existing built-in unit's suggested questions current. The practice
	// itself (sentences, progress) is untouched; this only refreshes the four
	// learning questions when the product copy changes.
	let existing = null
	try {
		if (fs.existsSync(file)) existing = JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch (error) {
		existing = null
	}
	if (existing && existing.id === FIRST_PRACTICE_ID && Array.isArray(existing.questions)) {
		if (JSON.stringify(existing.questions) !== JSON.stringify(fresh.questions)) {
			try {
				existing.questions = fresh.questions
				fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`)
			} catch (error) {
				/* a read-only profile keeps its old questions */
			}
		}
	}
	if (fs.existsSync(marker)) return false
	try {
		fs.mkdirSync(articles, { recursive: true })
		if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`)
		fs.writeFileSync(marker, `${now().toISOString()}\n`)
		return true
	} catch (error) {
		return false
	}
}
