/**
 * Model prompts for dsh-english-dictation.
 *
 * Two calls, both small and single-purpose, and both made only when the learner
 * asks for them — nothing is generated ahead of time:
 *
 *   1. one dictation sentence, written when 「继续」 is pressed (adaptive),
 *   2. one review of the sentence just answered.
 *
 * Nothing else in the plugin talks to a model. Scoring, combos, grades and the
 * theta update are pure rules in `rules.js`; a model never decides a score.
 */

import { MAX_WORDS, MIN_WORDS, TAGS, TAG_LABELS } from './rules.js'
import { cefrProfile, rewriteSpec } from './rewrite.js'

/**
 * Hard output budget for one sentence with its word metadata.
 *
 * Generous on purpose: the budget also covers any hidden reasoning the host
 * model emits, and a truncated reply is a reply the plugin cannot use.
 */
export const ITEM_MAX_TOKENS = 1600
/** A review is two sentences; the budget also covers hidden reasoning. */
export const REPORT_MAX_TOKENS = 700

/** Temperature: the item must be correct, not creative. */
export const ITEM_TEMPERATURE = 0.7
export const REPORT_TEMPERATURE = 0.3

/** Tag list with Chinese labels, for the prompt. */
const TAG_DIRECTORY = TAGS.map((tag) => `${tag}（${TAG_LABELS[tag]}）`).join('、')

/**
 * System prompt for one dictation sentence.
 * @param {number} difficulty - target difficulty.
 * @returns {string} system prompt.
 */
export function itemSystem(difficulty) {
	return [
		'你是一位英语听写题库作者，为「英文听写」练习每次都只写一个句子。',
		`这个句子的难度目标约为 ${difficulty}/12（1 = 入门，6 = 中级，10 = 高级）。`,
		'只输出一个 JSON 对象，不要代码块、不要解释。',
	].join('\n')
}

/**
 * User prompt for the next sentence.
 *
 * With a corpus seed the model's job is not taste but adaptation: keep the
 * meaning and topic of a real, human-written sentence, and rewrite it to the
 * target level with the per-word detail a dictation question needs. Without a
 * seed it writes the sentence from scratch, as before.
 * @param {object} input - generation context.
 * @param {number} input.difficulty - target difficulty.
 * @param {number} input.asked - sentences already answered in this run.
 * @param {string[]} input.weakTags - up to three weakest error tags.
 * @param {string[]} input.recent - recent sentences to avoid.
 * @param {string} input.band - self-assessed band id.
 * @param {{en: string, zh: string}} [input.seed] - corpus sentence to adapt.
 * @returns {string} prompt.
 */
export function buildItemPrompt(input) {
	const difficulty = Number(input.difficulty).toFixed(1)
	const asked = Math.max(0, Math.floor(Number(input.asked) || 0))
	const weak = Array.isArray(input.weakTags) && input.weakTags.length > 0 ? input.weakTags : []
	const recent = Array.isArray(input.recent) ? input.recent.slice(-10) : []
	const seed = input.seed && typeof input.seed.en === 'string' ? input.seed : null
	return [
		`难度目标：${difficulty}（1–12，自评档位 ${input.band || 'B1'}）。`,
		`本次已经练了 ${asked} 句。`,
		seed ? `素材句（真人写的，参考它的意思和话题，不要照抄）：
- 英文：${seed.en}
- 中文：${seed.zh}` : '',
		seed
			? '请把素材句**改写成一句适合这个难度目标的听写题**：保留它的话题和大致意思，但换成该难度的常用词与句式；如果它本身已经合适，可以只做小幅调整。不要照抄，也不要引入新的专有名词。'
			: '',
		weak.length > 0
			? `学习者最弱的三类错误是：${weak.map((tag) => `${tag}（${TAG_LABELS[tag] || tag}）`).join('、')}，请让这句话能练到其中之一。`
			: '学习者还没有明显的弱项，出一句覆盖面广的常用句。',
		recent.length > 0 ? `下面这些句子已经练过，不要重复、不要只换一个词：\n${recent.map((line) => `- ${line}`).join('\n')}` : '',
		'硬性要求：',
		`1. 句长 ${MIN_WORDS}–${MAX_WORDS} 个单词，单个单词不超过 15 个字母；只写一句，以 . ! 或 ? 结尾。`,
		'2. 普通书面英语，适合系统 TTS 朗读；不要数字、缩写（Mr. / U.S. / e.g.）、专有名词（人名、地名、星期、月份）、括号、引号、斜杠、货币符号、网址、省略号。',
		'3. 同音词可以出现，但不要出现只能靠听音区分的同音词对（例如同时出现 there 和 their）。',
		'4. words 必须把整句拆成单词，punctuation 挂在最后一个单词的词尾；words 的 text 用空格连起来必须与 en 完全一致。',
		'5b. 变形的词再给两个可选字段：base 是原形（is → be、children → child），form 是时态/语态等简短说明（例如 第三人称单数现在时、过去式、复数），用于「显示答案」卡；没有把握就省略。',
		'5. 每个单词给 pos（pron / verb / noun / adj / adv / prep / conj / det / num / interj / other）、一个简短中文 zh（不超过 8 个字，例如 He → 他；**必须给**，且必须是**这个词在本句里的意思**，只写一个义项：不要用分号/顿号罗列多个解释，不要带英文，不要带括号注释）。',
		'5c. 同时把句子按**句子成分**分组：chunks 是词的下标分组，roles 与 chunks 一一对应，取 主语/谓语/宾语/表语/定语/状语/补语/同位语/插入语。每组 1–5 个词，覆盖全句、顺序不变；短语要整组给（如 the teacher、am not、in his room），不要把名词短语拆成单字，也不要一个词一组地碎拆。',
		'6. tags 只能从这个枚举里选 1–2 个：' + TAG_DIRECTORY + '。',
		'7. zh 是整句的中文翻译，必须给。',
		'8. difficulty 是这句话的难度，必须落在 1–12，且与难度目标相差不超过 1.5。',
		'',
		'输出格式：',
		'{"item":{"en":"…","zh":"…","words":[{"text":"…","pos":"…","zh":"…","base":"…","form":"…"}],"chunks":[[0,1],[2,3]],"roles":["主语","谓语"],"difficulty":5.2,"tags":["spelling"]}}',
	].join('\n')
}

/** System prompt for one review. */
export function reportSystem() {
	return [
		'你是英语听写教练，只评价刚练完的这一句话，输出一个 JSON 对象。',
		'语言简洁、具体、有依据；不要鼓励话、不要段子、不要说教。',
	].join('\n')
}

/**
 * User prompt for the review of one sentence.
 * @param {object} input - answer context.
 * @param {object} input.item - the sentence.
 * @param {string} input.typed - what the learner typed.
 * @param {string} input.result - result kind.
 * @param {number} input.elapsedMs - time spent.
 * @param {number} input.replays - replays used.
 * @param {boolean} input.revealed - whether the answer was revealed.
 * @param {boolean} input.hadError - whether a wrong character was pressed.
 * @param {boolean} input.usedBackspace - whether backspace was used.
 * @param {string[]} [input.skipped] - words the learner skipped.
 * @param {number} input.theta - current level.
 * @returns {string} prompt.
 */
export function buildReportPrompt(input) {
	const item = input.item || {}
	const words = Array.isArray(item.words) ? item.words : []
	const detailWords = words.map((word) => `${word.text}${word.pos ? `(${word.pos})` : ''}`).join(' ')
	const resultLabel = { perfect: 'Perfect', great: 'Great', pass: '过关', reveal: '看答案（未计分）' }[input.result] || input.result
	return [
		`标准答案：${item.en}`,
		words.length > 0 ? `单词与词性：${detailWords}` : '',
		item.tags && item.tags.length > 0 ? `本题考查的错误类型：${item.tags.join('、')}` : '',
		`学习者输入：${input.typed === '' ? '（空）' : input.typed}`,
		`结果：${resultLabel}；用时 ${(Math.max(0, Number(input.elapsedMs) || 0) / 1000).toFixed(1)} 秒；重播 ${input.replays || 0} 次；` +
			`${input.revealed ? '看了答案；' : ''}${input.hadError ? '至少按错过一个字符；' : '没有按错字符；'}` +
			`${input.usedBackspace ? '用过退格；' : '没有用退格；'}`,
		Array.isArray(input.skipped) && input.skipped.length > 0 ? `学习者跳过了这些词（没打出来）：${input.skipped.join('、')}。` : '',
		`当前水平 θ=${Number(input.theta || 6).toFixed(1)}/12。`,
		'',
		'要求：',
		'1. verdict 是你的判断，一句话，不超过 40 个字，必须有依据（指出具体是哪个音、哪个字母、哪个语法点）。',
		'2. detail 可选，不超过 60 个字，给一条能立刻用的辨音或拼写规则；没有就省略。',
		'3. verdict 与 detail 合计不超过两句。',
		'4. 如果错在拼写或听音，必须明确说「这是听音问题，不是语法问题」，并给出辨音要点。',
		'5. 全对时不要空泛夸奖，要说清他做对了什么具体细节（例如「三个 -s 尾音都写出来了」）。',
		'6. 看答案时只讲一个结构点，不评价人品、不安慰。',
		'7. 引用学习者写过的内容时，必须原样出现在「学习者输入」里；引用标准答案里的单词也可以。不要编造他没写过的拼写。',
		'8. 如果学习者跳过了某个词，先把那个词讲清楚（发音或拼写规则），再说这句话的其余部分；不要说教，也不要说「没关系」。',
		'9. 最多一个 action：{"type":"replay_word","word":"apple","label":"重听这个单词"}，或 {"type":"replay_sentence"}，或 {"type":"none"}。replay_word 的 word 必须来自标准答案。',
		'',
		'输出格式：',
		'{"report":{"verdict":"…","detail":"…","action":{"type":"replay_word","word":"apple","label":"重听这个单词"}}}',
	].join('\n')
}

/**
 * Extract the first JSON object or array from a model reply.
 *
 * Models wrap JSON in prose or fences often enough that a strict `JSON.parse`
 * is not a validator, it is a coin flip.
 * @param {string} text - model output.
 * @returns {unknown} parsed value, or null.
 */
export function extractJson(text) {
	const raw = String(text ?? '').trim()
	if (raw === '') return null
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
	const candidate = fenced ? fenced[1].trim() : raw
	const direct = tryParse(candidate)
	if (direct !== undefined) return direct
	// Scan for the first `{` / `[` and try progressively shorter tails.
	for (const open of ['{', '[']) {
		const start = candidate.indexOf(open)
		if (start === -1) continue
		for (let end = candidate.length; end > start + 1; end -= 1) {
			const character = candidate[end - 1]
			if (character !== '}' && character !== ']') continue
			const parsed = tryParse(candidate.slice(start, end))
			if (parsed !== undefined) return parsed
		}
	}
	return null
}

/**
 * `JSON.parse` that returns `undefined` instead of throwing.
 * @param {string} text - candidate.
 * @returns {unknown} parsed value.
 */
function tryParse(text) {
	try {
		return JSON.parse(text)
	} catch (error) {
		return undefined
	}
}

/**
 * Pull the item object out of a model reply, wrapper accepted.
 * @param {string} text - model output.
 * @returns {unknown} candidate item.
 */
export function parseItemResponse(text) {
	const parsed = extractJson(text)
	if (!parsed || typeof parsed !== 'object') return null
	if (parsed.item && typeof parsed.item === 'object') return parsed.item
	if (typeof parsed.en === 'string') return parsed
	return null
}

/**
 * Pull the review object out of a model reply.
 * @param {string} text - model output.
 * @returns {unknown} candidate review.
 */
export function parseReportResponse(text) {
	const parsed = extractJson(text)
	if (!parsed || typeof parsed !== 'object') return null
	if (parsed.report && typeof parsed.report === 'object') return parsed.report
	if (typeof parsed.verdict === 'string') return parsed
	return null
}

/** A whole exercise (title + sentences + translations + questions) is one reply. */
export const EXERCISE_MAX_TOKENS = 4200
/** One rewrite that also writes the exercise and its questions. */
export const EXERCISE_TEMPERATURE = 0.4

/**
 * System prompt for the single-call exercise generator.
 * @param {string} level - target CEFR level.
 * @returns {string} system prompt.
 */
export function exerciseSystem(level) {
	const profile = cefrProfile(level)
	return [
		`你是一位英语分级读物作者，为「英文听写」把一篇真实文章规范化并重写成 CEFR ${level}（${profile.name.zh}）水平的练习题。`,
		`${level} 的定义：${profile.definition.zh}`,
		`${level} 的句法：${profile.syntax.zh}`,
		`${level} 的词汇：${profile.vocabulary.zh}`,
		'原文只提供话题和文章大纲；不要逐句翻译，用这个等级的语言重新组织。',
		'等级由句法结构和词汇等级决定；句子数量只决定练习长度，不是等级标准。',
		'保留原文的事实，不添加原文没有的内容，不评论、不站队。',
		'只输出一个 JSON 对象，不要代码块、不要解释。',
	].join('\n')
}

/**
 * User prompt for the one exercise call.
 * @param {object} input - generation context.
 * @param {string} input.level - target CEFR level.
 * @param {string} input.title - source headline.
 * @param {string} input.text - source prose.
 * @returns {string} prompt.
 */
export function buildExercisePrompt(input) {
	const profile = cefrProfile(input.level)
	const spec = rewriteSpec(input.level)
	// The sentence-length ceiling is part of the level's syntax; keep the format
	// line consistent with it instead of promising 24 words at A1.
	const maxWords = Math.min(24, Number(spec.maxSentence) || 24)
	return [
		`目标等级：CEFR ${input.level}（${profile.name.zh}）。`,
		`等级定义：${profile.definition.zh}`,
		`句法要求：${profile.syntax.zh}`,
		`词汇要求：${profile.vocabulary.zh}`,
		'原文只提供话题和结构；围绕这个主题写一篇适合该等级的听写练习，不要照抄原文句子。',
		'等级由句法结构和词汇等级决定；句子数量只决定练习长度，不是等级标准。',
		`练习长度：6–20 句（这是篇幅，不是等级）；每句 4–${maxWords} 个单词，以 . ! ? 结尾，不要写很短的残句。`,
		'写作要求：',
		'1. 语言自然连贯，有开头、过程和结尾；不要分点、小标题、Markdown、网址、括号注释。',
		'2. 标点只用逗号、句号、问号、感叹号、单双引号和连字符；不要分号、冒号、破折号、斜杠和括号。',
		'3. 每句配一句自然的中文翻译 zh。',
		'4. 每句列出 given：人名、机构名、地名、品牌等不该让学习者输入的专有名词，原样写、不带标点；没有就给空数组 []。',
		'5. 专有名词保留原写法，数字可以保留。',
		'6. 再给 3–4 个中文问题 questions，必须是英语学习问题：语法、词汇、搭配、句型、发音或翻译，要引用你写的具体词/句，每条不超过 40 字。',
		'7. 禁止元问题：不要问作者、来源、插件、练习方法或文章主题背景（例如“这个插件是谁做的？”“为什么来自 NASA？”“第一次怎么开始？”）。',
		'   好例子：“while 在这里能换成 when 吗？”“This one 指的是什么？”“agent 和 worker 有什么区别？”',
		'',
		`原文标题：${input.title || ''}`,
		'原文正文：',
		String(input.text || '').slice(0, 9000),
		'',
		'输出格式：',
		'{"title":"改写后的英文标题（不超过 9 个单词）","sentences":[{"en":"…","zh":"…","given":["…"]}],"questions":["…","…","…"]}',
	].join('\n')
}

/**
 * Parse the single-call exercise reply.
 * @param {string} text - model output.
 * @returns {{title: string, sentences: object[], questions: string[]}|null} exercise.
 */
export function parseExerciseResponse(text) {
	const parsed = extractJson(text)
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const rows = Array.isArray(parsed.sentences) ? parsed.sentences : []
	const sentences = []
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue
		const en = typeof row.en === 'string' ? row.en.trim() : ''
		const zh = typeof row.zh === 'string' ? row.zh.trim() : ''
		if (en === '') continue
		const given = Array.isArray(row.given)
			? row.given.filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()).slice(0, 8)
			: []
		sentences.push({ en, zh, given })
	}
	if (sentences.length === 0) return null
	const title = typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
	const questions = Array.isArray(parsed.questions)
		? parsed.questions
			.filter((question) => typeof question === 'string' && question.trim() !== '')
			.map((question) => question.trim().slice(0, 80))
			.slice(0, 5)
		: []
	return { title, sentences, questions }
}
