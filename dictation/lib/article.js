/**
 * Article → practice sentences.
 *
 * The RSS item links to a short graded text; the practice needs the sentences
 * of that text (English + a Chinese translation). Extraction is deliberately
 * simple: strip the feed chrome, split on punctuation, and keep units a learner
 * can actually type in one go.
 */

/** Longest practice unit, in words. */
export const PRACTICE_MAX_WORDS = 24

/** Shortest practice unit, in words. */
export const PRACTICE_MIN_WORDS = 4

/** Remove scripts, styles and tags, then normalise whitespace. */
function textOf(html) {
	return String(html ?? '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
		.replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#039;|&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Strip the parts of a graded-feed body that are not article prose: the
 * leading date stamp, the "Difficult words:" glossary and the WordPress
 * footer ("The post … appeared first on …"). Those are the reason a whole
 * article could shrink to one or two practice sentences.
 * @param {string} text - feed body.
 * @returns {string} article prose.
 */
export function cleanArticleText(text) {
	return String(text ?? '')
		.replace(/^\s*\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2}\s+/, ' ')
		.replace(/\bDifficult words:[\s\S]*$/i, ' ')
		.replace(/\bThe post[\s\S]*?appeared first on[\s\S]*$/i, ' ')
		.replace(/[’‘]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * Number of words in a unit.
 * @param {string} text - one sentence.
 * @returns {number} word count.
 */
export function countWords(text) {
	return String(text ?? '')
		.split(/\s+/)
		.filter(Boolean).length
}

/**
 * Split one sentence that is too long at a clause boundary (`;` or a comma
 * before a conjunction). A clause that keeps the final period keeps it; the
 * earlier ones get one so every unit reads as a sentence.
 * @param {string} sentence - one sentence.
 * @returns {string[]} units.
 */
function clauseSplit(sentence) {
	if (countWords(sentence) <= PRACTICE_MAX_WORDS) return [sentence]
	const parts = sentence.split(/;\s+|,\s+(?=(?:and|but|so|because|which|while|when|who|where|although|though|if|unlike|as)\b)/i)
	if (parts.length < 2) return [sentence]
	const out = []
	let buffer = ''
	for (const part of parts) {
		const candidate = buffer === '' ? part : `${buffer}, ${part}`
		if (countWords(candidate) <= PRACTICE_MAX_WORDS) {
			buffer = candidate
			continue
		}
		if (buffer !== '') out.push(buffer)
		buffer = part
	}
	if (buffer !== '') out.push(buffer)
	return out.map((part) => {
		const trimmed = part.trim()
		if (trimmed === '') return trimmed
		return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
	})
}

/**
 * Sentence split on ., ! and ? followed by a capital or the end.
 * @param {string} text - plain text.
 * @returns {string[]} sentences.
 */
export function splitSentences(text) {
	const source = String(text ?? '').replace(/\s+/g, ' ').trim()
	if (source === '') return []
	return source
		.split(/(?<=[.!?])\s+(?=[A-Z])/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 0)
}

/**
 * Whole sentences worth practising: 4–24 words, no URLs, ends with
 * punctuation, plain letters and apostrophes only. Arabic numerals are kept:
 * the page prints them instead of asking the learner to type them.
 * @param {string} text - plain text.
 * @returns {string[]} usable sentences.
 */
export function practiceSentences(text) {
	const units = []
	for (const sentence of splitSentences(cleanArticleText(text))) {
		for (const part of clauseSplit(sentence)) {
			const unit = part.trim().replace(/^[a-z]/, (character) => character.toUpperCase())
			if (unit === '') continue
			if (/https?:\/\/|www\./.test(unit)) continue
			if (!/[.!?]$/.test(unit)) continue
			if (!/^[A-Z]/.test(unit)) continue
			if (!/^[A-Za-z0-9 .,!?'"-]+$/.test(unit)) continue
			const words = countWords(unit)
			if (words < PRACTICE_MIN_WORDS || words > PRACTICE_MAX_WORDS) continue
			units.push(unit)
		}
	}
	return units
}

/**
 * Pull the article text out of a page and keep the best paragraph block.
 * @param {string} html - page body.
 * @returns {string[]} usable sentences.
 */
export function extractSentences(html) {
	const source = String(html ?? '')
	const blocks = source.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || []
	const text = blocks.length > 0 ? blocks.map(textOf).join(' ') : textOf(source)
	return practiceSentences(text)
}
