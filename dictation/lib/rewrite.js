/**
 * CEFR rewriting: what "B1" actually means, and whether a rewrite earned it.
 *
 * Two audiences read the same profiles:
 *
 *   · the model — `buildExercisePrompt` puts the level's definition, syntax and
 *     vocabulary into the prompt, because a level is a *capability*, not a word
 *     count;
 *   · the validator — `validateRewrite` enforces what can be checked
 *     deterministically: length, sentence count (6–20), sentence length,
 *     clause density, forbidden tenses, long-word share, markup, and copying.
 *
 * The numbers are a writing rubric, not a linguistics paper: they are tuned so
 * a passage that reads clearly at each level passes, while a passage that
 * merely claims its level does not.
 */

import { practiceSentences, splitSentences } from './article.js'

/** The levels the add page offers. */
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/**
 * Level profiles: the shared truth for the dialog and the prompt.
 *
 * `definition` is the can-do statement the learner sees; `syntax` and
 * `vocabulary` are the writing instructions the model gets. Both languages are
 * kept together so the UI copy and the prompt cannot drift apart — and the
 * offline tests pin them to each other.
 */
export const CEFR_PROFILES = {
	A1: {
		level: 'A1',
		name: { zh: '入门', en: 'Beginner' },
		definition: {
			zh: '能理解并使用日常熟悉的表达和最基本的句子；能自我介绍、问路、买东西。',
			en: 'Can understand and use familiar everyday expressions; can introduce yourself and ask simple questions.',
		},
		syntax: {
			zh: '只用简单句（主 + 谓 + 宾/表），不用从句、被动语态和完成时；每句 4–10 个单词。',
			en: 'Simple sentences only; no subordinate clauses, no passive, no perfect tense; 4–10 words per sentence.',
		},
		vocabulary: {
			zh: '最常用的 300–500 个英语单词；具体名词、动作动词和日常形容词；不用习语、短语动词和抽象词。',
			en: 'The 300–500 most frequent words; concrete nouns, action verbs, everyday adjectives; no idioms, phrasal verbs or abstract words.',
		},
		/** Average subordinate-clause markers per usable sentence. */
		clauses: 0.2,
		/** Whether a perfect tense (have/has/had + participle) is acceptable. */
		perfect: false,
	},
	A2: {
		level: 'A2',
		name: { zh: '初级', en: 'Elementary' },
		definition: {
			zh: '能就熟悉的日常话题做简单交流；能读懂短通知、菜单和个人信息。',
			en: 'Can handle simple, routine exchanges on familiar topics; can read short notices, menus and personal messages.',
		},
		syntax: {
			zh: '简单句为主，只用一个 and / but / because / when 连接两个短句；不用完成时和被动语态；每句不超过 12 个单词。',
			en: 'Mostly simple sentences; at most one small connector (and/but/because/when); no perfect tense, no passive; max 12 words per sentence.',
		},
		vocabulary: {
			zh: '约 800–1200 个最常用词；日常话题（家庭、工作、购物、天气、健康）；少量常见短语动词。',
			en: 'About 800–1,200 frequent words; everyday topics (family, work, shopping, weather, health); a few common phrasal verbs.',
		},
		clauses: 0.6,
		perfect: true,
	},
	B1: {
		level: 'B1',
		name: { zh: '中级', en: 'Intermediate' },
		definition: {
			zh: '能应对旅行、学习和工作中的常见场景；能读懂日常短文并抓住主要意思。',
			en: 'Can deal with most situations while travelling, studying or working; can read everyday texts and follow the main points.',
		},
		syntax: {
			zh: '可以用一个 because / if / when / who / which 从句；偶尔用被动语态；每句不超过 15 个单词。',
			en: 'One subordinate clause (because/if/when/who/which) is fine; occasional passive; max 15 words per sentence.',
		},
		vocabulary: {
			zh: '约 1500–2000 个常用词；能谈经历、计划、观点；少量抽象词和常见搭配。',
			en: 'About 1,500–2,000 common words; can discuss experiences, plans and opinions; some abstract words and collocations.',
		},
		clauses: 1.0,
		perfect: true,
	},
	B2: {
		level: 'B2',
		name: { zh: '中高级', en: 'Upper intermediate' },
		definition: {
			zh: '能比较流利地和母语者交流；能读懂较长的文章和清楚的观点论述。',
			en: 'Can interact with reasonable fluency; can read longer articles and follow clear argumentation.',
		},
		syntax: {
			zh: '从句、分词短语、被动语态、完成时都可以用；每句不超过 18 个单词，避免连续复杂句。',
			en: 'Clauses, participial phrases, passive and perfect are all fine; max 18 words per sentence; avoid chained complex sentences.',
		},
		vocabulary: {
			zh: '约 2500–3500 个词；能表达立场、因果、让步；常见学术/工作词汇和搭配。',
			en: 'About 2,500–3,500 words; stance, cause, concession; common academic/work vocabulary and collocations.',
		},
		clauses: 1.5,
		perfect: true,
	},
	C1: {
		level: 'C1',
		name: { zh: '高级', en: 'Advanced' },
		definition: {
			zh: '能流利自然地表达；能读懂复杂的长文，并理解其中的隐含意思。',
			en: 'Can express ideas fluently and spontaneously; can read complex, long texts and understand implicit meaning.',
		},
		syntax: {
			zh: '复杂句、分词结构、倒装、名词化都可以；每句不超过 22 个单词。',
			en: 'Complex sentences, participial structures, inversion and nominalisation are all fine; max 22 words per sentence.',
		},
		vocabulary: {
			zh: '5000 词以上；抽象、学术、修辞性表达；精确的近义词选择。',
			en: '5,000+ words; abstract, academic and rhetorical language; precise near-synonym choices.',
		},
		clauses: 2.5,
		perfect: true,
	},
	C2: {
		level: 'C2',
		name: { zh: '精通', en: 'Mastery' },
		definition: {
			zh: '能轻松理解几乎所有听到或读到的内容；能连贯地概括、复述信息，并在复杂场合精确表达细微含义。',
			en: 'Can understand with ease virtually everything heard or read; can summarise and reconstruct arguments, and express fine shades of meaning in complex situations.',
		},
		syntax: {
			zh: '从句嵌套、省略、倒装、名词化和复杂修饰都能用；句子之间要有清晰的衔接；每句不超过 24 个单词。',
			en: 'Nested clauses, ellipsis, inversion, nominalisation and complex modification are all fine; the sentences must connect clearly; max 24 words per sentence.',
		},
		vocabulary: {
			zh: '8000 词以上；抽象、学术、文学和修辞表达；精确的语域与搭配。',
			en: '8,000+ words; abstract, academic, literary and rhetorical language; precise register and collocation.',
		},
		clauses: 3,
		perfect: true,
	},
}

/**
 * Numeric thresholds per level.
 *
 * `words` bounds the passage; `maxSentence`/`avgSentence` bound the syntax;
 * `minSentences`/`maxSentences` bound how many dictation items a passage makes;
 * `longWordShare` is a vocabulary-load proxy (ten letters or more).
 */
export const CEFR_SPECS = {
	A1: { level: 'A1', words: [55, 95], maxSentence: 10, avgSentence: 8, minSentences: 6, maxSentences: 20, longWordShare: 0.05 },
	A2: { level: 'A2', words: [75, 120], maxSentence: 12, avgSentence: 10, minSentences: 6, maxSentences: 20, longWordShare: 0.07 },
	B1: { level: 'B1', words: [100, 160], maxSentence: 15, avgSentence: 12, minSentences: 6, maxSentences: 20, longWordShare: 0.1 },
	B2: { level: 'B2', words: [130, 200], maxSentence: 18, avgSentence: 15, minSentences: 6, maxSentences: 20, longWordShare: 0.14 },
	C1: { level: 'C1', words: [160, 240], maxSentence: 22, avgSentence: 18, minSentences: 6, maxSentences: 20, longWordShare: 0.22 },
	C2: { level: 'C2', words: [190, 280], maxSentence: 24, avgSentence: 20, minSentences: 6, maxSentences: 20, longWordShare: 0.28 },
}

/**
 * Make a model's prose safe for the dictation splitter.
 *
 * Models routinely return typographic quotes, parentheses around a translation,
 * semicolons, em dashes or a URL even when the prompt forbids them. Those are
 * presentation habits, not content: normalise them instead of rejecting an
 * otherwise good rewrite. The validator still enforces everything it can check.
 * @param {string} text - rewritten passage.
 * @returns {string} the same passage with dictation-safe punctuation.
 */
export function normalizeRewriteText(text) {
	return String(text ?? '')
		.replace(/\r\n?/g, ' ')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[–—]/g, '-')
		.replace(/\u00a0/g, ' ')
		.replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
		.replace(/[;；]/g, '. ')
		.replace(/[:：]/g, ', ')
		.replace(/[()[\]{}<>]/g, ' ')
		.replace(/[\/\\]/g, ' ')
		.replace(/…/g, '.')
		.replace(/[•·]/g, ' ')
		.replace(/[#*_`~]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.!?])/g, '$1')
		.replace(/([,.!?])\1+/g, '$1')
		.trim()
}

/** Whether a string is one of the offered levels. */
export function isCefr(level) {
	return CEFR_LEVELS.includes(String(level))
}

/**
 * The spec for a level, or the B1 default when the caller passes garbage.
 * @param {string} level - CEFR id.
 * @returns {object} spec.
 */
export function rewriteSpec(level) {
	return CEFR_SPECS[String(level)] || CEFR_SPECS.B1
}

/**
 * The profile (definition + syntax + vocabulary guidance) for a level.
 * @param {string} level - CEFR id.
 * @returns {object} profile.
 */
export function cefrProfile(level) {
	return CEFR_PROFILES[String(level)] || CEFR_PROFILES.B1
}

/** Words that open a subordinate clause, used as a syntax proxy. */
const SUBORDINATORS = new Set([
	'because',
	'although',
	'though',
	'while',
	'whereas',
	'which',
	'who',
	'whom',
	'whose',
	'when',
	'whenever',
	'where',
	'if',
	'unless',
	'since',
	'after',
	'before',
	'until',
	'once',
	'whether',
	'whereas',
])

/** Common irregular past participles, for the perfect-tense check. */
const PARTICIPLES = new Set([
	'been', 'done', 'gone', 'seen', 'taken', 'given', 'written', 'eaten', 'made', 'said', 'known',
	'shown', 'found', 'told', 'felt', 'left', 'kept', 'met', 'paid', 'run', 'come', 'become', 'begun',
	'brought', 'bought', 'thought', 'caught', 'taught', 'sent', 'spent', 'built', 'held', 'stood',
	'understood', 'won', 'lost', 'broken', 'chosen', 'spoken', 'stolen', 'woken', 'forgotten', 'hidden',
	'ridden', 'risen', 'shaken', 'thrown', 'worn', 'torn', 'sworn', 'grown', 'blown', 'flown', 'drawn',
	'laid', 'led', 'fled', 'slept', 'swept', 'wept', 'dealt', 'meant', 'learnt', 'heard', 'read',
	'said', 'sold', 'told', 'fed', 'led', 'lit', 'hit', 'cut', 'put', 'set', 'let', 'shut', 'spread',
])

/** Lowercased, punctuation-free word tokens. */
function tokens(text) {
	return String(text ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9'\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
}

/** A set of N-word shingles, for the copy check. */
function shingles(words, size) {
	const set = new Set()
	for (let index = 0; index + size <= words.length; index += 1) {
		set.add(words.slice(index, index + size).join(' '))
	}
	return set
}

/** Jaccard overlap of two shingle sets (0 when either is empty). */
function overlapOf(left, right) {
	if (left.size === 0 || right.size === 0) return 0
	let shared = 0
	for (const item of left) if (right.has(item)) shared += 1
	return shared / (left.size + right.size - shared)
}

/** Words with ten or more letters, as a share of the text. */
function longWordShare(words) {
	if (words.length === 0) return 0
	let long = 0
	for (const word of words) if (word.replace(/[^a-z]/g, '').length >= 10) long += 1
	return long / words.length
}

/** Subordinate-clause markers, per sentence. */
function clauseRate(words, sentences) {
	if (sentences === 0) return 0
	let clauses = 0
	for (const word of words) if (SUBORDINATORS.has(word)) clauses += 1
	return clauses / sentences
}

/** Whether the text uses a perfect tense (have/has/had + participle). */
function usesPerfect(words) {
	for (let index = 0; index < words.length - 1; index += 1) {
		if (words[index] !== 'have' && words[index] !== 'has' && words[index] !== 'had') continue
		// Walk up to two tokens past the auxiliary: "has already finished" counts.
		for (let offset = 1; offset <= 2 && index + offset < words.length; offset += 1) {
			const word = words[index + offset]
			if (PARTICIPLES.has(word)) return true
			if (/(ed|en)$/.test(word) && word.length > 3) return true
		}
	}
	return false
}

/**
 * Validate one rewrite against its level.
 *
 * Order matters: the reasons are handed back to the model, so the most
 * actionable problem is reported first (length → sentence shape → usable
 * sentences → vocabulary → syntax → copying).
 * @param {string} text - rewritten passage.
 * @param {string} level - CEFR id.
 * @param {string} [sourceText] - the original article, for the copy check.
 * @returns {{ok: boolean, reason: string, stats: object}} verdict.
 */
export function validateRewrite(text, level, sourceText = '', options = {}) {
	const spec = rewriteSpec(level)
	const profile = cefrProfile(level)
	const checkLength = options.length !== false
	const stats = {
		words: 0,
		sentences: 0,
		keptSentences: 0,
		avgSentence: 0,
		maxSentence: 0,
		longShare: 0,
		clauses: 0,
		perfect: false,
		overlap: 0,
	}
	const fail = (reason) => ({ ok: false, reason, stats })
	const body = String(text ?? '').trim()
	if (body === '') return fail('短文是空的')
	if (/https?:\/\/|www\./i.test(body)) return fail('短文里出现了网址')
	if (/<[a-z][^>]*>/i.test(body) || /```/.test(body)) return fail('短文里有 HTML 或代码块标记')
	if (/^#{1,6}\s/m.test(body)) return fail('短文用了 Markdown 标题')
	if (/^\s*[-*•]\s+/m.test(body)) return fail('短文用了项目符号列表')
	if (/\t/.test(body)) return fail('短文里有制表符')
	// The dictation splitter only accepts , . ! ? ' " and -; anything else would
	// silently drop the sentence it appears in.
	if (/[;:()\[\]{}<>—–/]/.test(body)) return fail('标点超出听写范围（只用 , . ! ? \' " -）')

	const words = tokens(body)
	stats.words = words.length
	if (checkLength && (words.length < spec.words[0] || words.length > spec.words[1])) {
		return fail(`字数是 ${words.length} 词，要求 ${spec.words[0]}–${spec.words[1]} 词`)
	}
	const sentences = splitSentences(body)
		.map((sentence) => tokens(sentence).length)
		.filter((count) => count > 0)
	stats.sentences = sentences.length
	if (checkLength && sentences.length < spec.minSentences) {
		return fail(`只有 ${sentences.length} 句，至少要 ${spec.minSentences} 句`)
	}
	stats.maxSentence = Math.max(...sentences)
	stats.avgSentence = Math.round((words.length / sentences.length) * 10) / 10
	if (stats.maxSentence > spec.maxSentence + 3) {
		return fail(`最长的一句有 ${stats.maxSentence} 词，要求不超过 ${spec.maxSentence} 词`)
	}
	if (stats.avgSentence > spec.avgSentence + 1) {
		return fail(`平均句长 ${stats.avgSentence} 词，要求不超过 ${spec.avgSentence} 词`)
	}
	// The number that actually matters is how many sentences survive the
	// dictation splitter (4–24 words, allowed characters).
	const usable = practiceSentences(body)
	stats.keptSentences = usable.length
	if (checkLength && usable.length < spec.minSentences) {
		return fail(`能出题的句子只有 ${usable.length} 句（至少 ${spec.minSentences} 句）`)
	}
	if (checkLength && usable.length > spec.maxSentences) {
		return fail(`句子太多：${usable.length} 句，最多 ${spec.maxSentences} 句`)
	}
	stats.longShare = Math.round(longWordShare(words) * 1000) / 1000
	if (stats.longShare > spec.longWordShare) {
		return fail(`十个字母以上的词占 ${Math.round(stats.longShare * 100)}%，要求不超过 ${Math.round(spec.longWordShare * 100)}%`)
	}
	stats.clauses = Math.round(clauseRate(words, sentences.length) * 100) / 100
	if (stats.clauses > profile.clauses + 0.05) {
		return fail(`从句密度过高：每句平均 ${stats.clauses} 个从句引导词，${level} 要求不超过 ${profile.clauses}`)
	}
	stats.perfect = usesPerfect(words)
	if (profile.perfect === false && stats.perfect) {
		return fail(`${level} 不用完成时（have/has/had + 过去分词）`)
	}
	const sourceWords = tokens(sourceText)
	if (sourceWords.length >= 40) {
		const size = words.length >= 5 ? 5 : 3
		stats.overlap = Math.round(overlapOf(shingles(words, size), shingles(sourceWords, size)) * 100) / 100
		if (stats.overlap >= 0.8) return fail('和原文几乎一样，没有真正改写')
	}
	return { ok: true, reason: '', stats }
}

/**
 * A retry hint for the model: the failure, phrased as an instruction.
 * @param {object} verdict - validateRewrite result.
 * @param {string} [level] - target level, for the reminder.
 * @returns {string} instruction line ('' when the verdict passed).
 */
export function feedbackFor(verdict, level = '') {
	if (!verdict || verdict.ok) return ''
	const profile = level === '' ? null : cefrProfile(level)
	const reminder = profile === null
		? ''
		: `这个等级的句法是「${profile.syntax.zh}」，词汇是「${profile.vocabulary.zh}」。`
	return `上一版不合格：${verdict.reason}。${reminder}请按上面的句法和词汇要求重写。`
}
