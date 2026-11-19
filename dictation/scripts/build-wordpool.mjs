/**
 * Build data/wordpool.json: per-scenario vocab pools (default 500 words each).
 *
 *   DEEPSEEK_API_KEY=sk-... node scripts/build-wordpool.mjs travel work food study
 *
 * Pass a topic list, or no argument for every topic below. Uses an
 * OpenAI-compatible chat endpoint (DEEPSEEK_BASE_URL defaults to DeepSeek).
 * Words may repeat across topics on purpose: a scenario pool is a syllabus, not
 * a partition.
 */
import fs from 'node:fs'
import path from 'node:path'

const TOPICS = [
	'travel', 'work', 'family', 'food', 'weather', 'study', 'health', 'friend',
	'money', 'morning', 'music', 'sport', 'city', 'home', 'weekend', 'holiday',
	'book', 'movie', 'phone', 'train', 'shop', 'garden', 'doctor', 'teacher',
]
const PER_TOPIC = Number(process.env.WORDS_PER_TOPIC || 500)
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const KEY = process.env.DEEPSEEK_API_KEY || ''
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'wordpool.json')

function promptFor(topic) {
	return [
		`List ${PER_TOPIC} high-frequency English words for the everyday scenario "${topic}".`,
		'Return JSON only: {"words":[{"lemma":"...","pos":"noun|verb|adj|adv|prep|det|pron|conj|num|interj","zh":"一个中文义项","level":"A2|B1|B2"}]}',
		'Rules: single words only (no phrases), no proper nouns, no numbers, no duplicates,',
		'A2 first (most common everyday words), then B1, then B2; zh is one short Chinese gloss.',
	].join('\n')
}

async function ask(topic) {
	const response = await fetch(`${BASE_URL}/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
		body: JSON.stringify({
			model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
			messages: [
				{ role: 'system', content: 'You are a vocabulary curator. Reply with the JSON object only.' },
				{ role: 'user', content: promptFor(topic) },
			],
			temperature: 0.4,
			max_tokens: 8000,
		}),
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	const data = await response.json()
	const text = data.choices?.[0]?.message?.content || ''
	const match = text.match(/\{[\s\S]*\}/)
	if (!match) throw new Error('no JSON')
	const parsed = JSON.parse(match[0])
	const words = Array.isArray(parsed.words) ? parsed.words : []
	const seen = new Set()
	const clean = []
	for (const word of words) {
		const lemma = String(word.lemma || '').trim().toLowerCase()
		if (!/^[a-z][a-z'-]{1,24}$/.test(lemma) || seen.has(lemma)) continue
		seen.add(lemma)
		clean.push({
			lemma,
			pos: ['noun', 'verb', 'adj', 'adv', 'prep', 'det', 'pron', 'conj', 'num', 'interj'].includes(word.pos) ? word.pos : 'other',
			zh: String(word.zh || '').replace(/[A-Za-z]/g, '').trim().slice(0, 8),
			level: ['A2', 'B1', 'B2'].includes(word.level) ? word.level : 'B1',
		})
	}
	return clean
}

async function main() {
	if (!KEY) throw new Error('set DEEPSEEK_API_KEY')
	const requested = process.argv.slice(2).filter((topic) => TOPICS.includes(topic))
	const topics = requested.length > 0 ? requested : TOPICS
	const pool = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
	for (const topic of topics) {
		for (let round = 0; round < 6; round += 1) {
			const existing = new Set((pool[topic] || []).map((word) => word.lemma))
			if (existing.size >= PER_TOPIC) break
			try {
				const words = await ask(topic)
				const merged = pool[topic] || []
				for (const word of words) if (!existing.has(word.lemma)) merged.push(word)
				pool[topic] = merged
				console.log(`${topic}: ${merged.length}/${PER_TOPIC}`)
				fs.writeFileSync(OUT, JSON.stringify(pool, null, 2))
			} catch (error) {
				console.error(`${topic}: ${error && error.message}; retrying`)
			}
		}
	}
	console.log(`written ${OUT}`)
}

main().catch((error) => {
	console.error(error && error.message)
	process.exitCode = 1
})
