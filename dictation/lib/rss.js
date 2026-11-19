/**
 * RSS / Atom reading for the source layer.
 *
 * The plugin ships no article bank: a handful of feeds are the raw material.
 * They do not agree on a dialect — NASA and NOAA publish RSS with
 * `content:encoded`, Our World in Data and PLOS publish Atom with CDATA and a
 * `rel="alternate"` link — so this parser reads both and returns one shape:
 *
 *   { title, link, publishedAt, summary, text, categories }
 *
 * `text` is plain text with the markup removed; the source layer either uses it
 * directly (a feed that carries the whole article) or fetches the linked page
 * when the feed only carries a teaser.
 *
 * The parser is deliberately small and forgiving: a malformed item is skipped,
 * never thrown, because one bad entry must not take a whole feed down.
 */

/** Decode the entities RSS authors actually use, CDATA first. */
function decode(text) {
	return String(text ?? '')
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&#x([0-9a-f]+);/gi, (match, hex) => safeCodePoint(parseInt(hex, 16), match))
		.replace(/&#(\d+);/g, (match, value) => safeCodePoint(Number(value), match))
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&amp;/g, '&')
}

/** One decoded code point, or the original text when it is out of range. */
function safeCodePoint(code, fallback) {
	if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback
	try {
		return String.fromCodePoint(code)
	} catch (error) {
		return fallback
	}
}

/** Markup and script bodies out, whitespace collapsed. */
function plainText(html) {
	return decode(html)
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.replace(/\n{2,}/g, '\n')
		.trim()
}

/**
 * The first matching tag's inner text (or an attribute of it).
 * @param {string} block - one item/entry.
 * @param {string} tag - tag name.
 * @param {string} [attribute] - read this attribute instead of the body.
 * @returns {string} raw match, decoded.
 */
function pick(block, tag, attribute) {
	const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i')
	const match = pattern.exec(block)
	if (match) {
		if (attribute) {
			const found = new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`, 'i').exec(match[1])
			if (found) return decode(found[1]).trim()
		}
		return decode(match[2]).trim()
	}
	if (attribute) {
		// Atom links are self-closing: <link rel="alternate" href="…"/>
		const selfClosing = new RegExp(`<${tag}\\b([^>]*)\\/?>`, 'gi')
		for (const candidate of block.matchAll(selfClosing)) {
			const found = new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`, 'i').exec(candidate[1])
			if (found) return decode(found[1]).trim()
		}
	}
	return ''
}

/** The Atom link, preferring rel="alternate" over any other relation. */
function atomLink(block) {
	const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((match) => ({
		attributes: match[1],
		href: (/href\s*=\s*["']([^"']*)["']/i.exec(match[1]) || [])[1] || '',
	}))
	const usable = links.filter((link) => link.href !== '')
	const alternate = usable.find((link) => /rel\s*=\s*["']alternate["']/i.test(link.attributes))
	return decode((alternate || usable[0] || { href: '' }).href).trim()
}

/** `<category>` bodies, or Atom `term` attributes. */
function categoriesOf(block) {
	const bodies = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
		.map((match) => plainText(match[1]))
		.filter(Boolean)
	const terms = [...block.matchAll(/<category\b[^>]*\bterm\s*=\s*["']([^"']+)["']/gi)].map((match) => decode(match[1]).trim())
	return [...new Set([...bodies, ...terms])].slice(0, 6)
}

/** One `<item>` (RSS) or `<entry>` (Atom) → the fields the app needs. */
function parseBlock(block, atom) {
	const title = plainText(pick(block, 'title'))
	const link = atom ? atomLink(block) : plainText(pick(block, 'link')) || plainText(pick(block, 'guid'))
	if (title === '' || link === '') return null
	// Prefer the full body when the feed carries it: `content:encoded` / Atom
	// `<content>`, then the summary-ish description.
	const contentHtml = atom ? pick(block, 'content') : pick(block, 'content:encoded')
	const summaryHtml = atom ? pick(block, 'summary') : pick(block, 'description')
	const text = plainText(contentHtml) !== '' ? plainText(contentHtml) : plainText(summaryHtml)
	const summary = plainText(summaryHtml) !== '' ? plainText(summaryHtml) : text
	const publishedAt = atom
		? pick(block, 'published') || pick(block, 'updated') || pick(block, 'created')
		: pick(block, 'pubDate') || pick(block, 'dc:date') || pick(block, 'published')
	return {
		title,
		link,
		publishedAt,
		summary: summary.slice(0, 400),
		text,
		categories: categoriesOf(block),
	}
}

/**
 * Parse an RSS or Atom document into plain article items.
 * @param {string} xml - feed body.
 * @returns {Array<{title: string, link: string, publishedAt: string, summary: string, text: string, categories: string[]}>} items.
 */
export function parseFeed(xml) {
	const source = String(xml ?? '')
	const items = [...source.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => parseBlock(match[0], false))
	if (items.length === 0) {
		// Atom: the feed element itself is not an entry, so a plain scan is safe.
		const entries = [...source.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => parseBlock(match[0], true))
		return entries.filter(Boolean)
	}
	return items.filter(Boolean)
}

/**
 * Paragraph inner-HTML blocks, with the browser's rule for unclosed tags.
 *
 * A naive `/<p>(.*?)<\/p>/` loses on real pages: an unclosed `<p>` followed by
 * a `<header>` swallows the whole navigation into "the first paragraph" (NASA
 * and NIST both do this). Browsers close a paragraph when a block-level element
 * opens, so this walker does the same and returns one inner-HTML string per
 * paragraph.
 * @param {string} html - page body (already scrubbed of scripts/styles).
 * @returns {string[]} paragraph inner HTML.
 */
function paragraphBlocks(html) {
	const blocks = []
	const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g
	let match = null
	let bufferStart = -1
	let inLink = false
	let buffer = ''
	const blockLevel = /^(address|article|aside|blockquote|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|ul)$/i
	while ((match = tag.exec(html)) !== null) {
		const closing = match[1] === '/'
		const name = match[2].toLowerCase()
		if (!closing && name === 'a') inLink = true
		if (closing && name === 'a') inLink = false
		if (!closing && name === 'p' && bufferStart === -1) {
			bufferStart = match.index + match[0].length
			buffer = ''
			continue
		}
		if (bufferStart === -1) continue
		if ((!closing && blockLevel.test(name)) || (closing && name === 'p')) {
			buffer = html.slice(bufferStart, match.index)
			blocks.push(buffer)
			bufferStart = -1
			buffer = ''
			if (!closing) {
				// The block tag itself may open a new paragraph immediately after.
				if (name === 'p') bufferStart = match.index + match[0].length
			}
		}
	}
	if (bufferStart !== -1) blocks.push(html.slice(bufferStart))
	return blocks.filter((block) => block.trim() !== '')
}

/** Share of a paragraph's visible text that sits inside links. */
function linkShare(innerHtml) {
	const text = plainText(innerHtml)
	if (text === '') return 1
	const linked = [...innerHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => plainText(match[1])).join(' ')
	return linked.length / text.length
}

/** A paragraph that is really an author affiliation line, not prose. */
function isAffiliation(text) {
	if (text.split(/\s+/).filter(Boolean).length > 30) return false
	return /\b(university|institute|institut|department|faculty|school of|college|hospital|laboratory|academy of)\b/i.test(text)
}

/**
 * Strip the parts of a fetched page that are not prose.
 *
 * Providers differ: NASA wraps the article in navigation, NIST in a `.gov`
 * banner, WHO ships its body inside the feed. This is the shared cleanup for
 * the page path — it keeps `<p>` blocks that look like sentences and drops the
 * furniture that real pages put around them.
 * @param {string} html - page body.
 * @returns {string} clean prose (paragraphs joined by newlines).
 */
export function extractArticleText(html) {
	const body = decode(String(html ?? ''))
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
		.replace(/<header[\s\S]*?<\/header>/gi, ' ')
		.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
		.replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
		.replace(/<form[\s\S]*?<\/form>/gi, ' ')
	// Prefer a semantic main/article container; fall back to the whole page.
	const scoped = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body)
		|| /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body)
		|| /<div[^>]+class="[^"]*(?:entry-content|article-body|story-body|c-post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(body)
	const region = scoped ? scoped[1] : body
	const paragraphs = paragraphBlocks(region)
		// A link-heavy block is a menu or breadcrumb, not a sentence.
		.filter((block) => linkShare(block) < 0.5)
		.map((block) => plainText(block))
		.filter((paragraph) => paragraph !== '')
		.filter((paragraph) => paragraph.split(/\s+/).length >= 8)
		.filter((paragraph) => !isBoilerplate(paragraph))
		.filter((paragraph) => !isAffiliation(paragraph))
	if (paragraphs.length === 0) {
		// A page with no real paragraphs (a JS shell, a redirect stub) has no
		// prose to rewrite. Returning the whole page would feed navigation text
		// to the model, so the caller gets nothing and can fall back.
		return ''
	}
	return paragraphs
		.join('\n')
		.replace(/\n{2,}/g, '\n')
		.trim()
}

/** Lines that look like page furniture rather than article prose. */
function isBoilerplate(paragraph) {
	const text = paragraph.toLowerCase()
	const patterns = [
		'official websites use .gov',
		'official website of the united states government',
		'a .gov website belongs to',
		'a lock ( lock a locked padlock',
		'secure .gov websites use https',
		'skip to',
		'search suggested searches',
		'sign up for',
		'newsletter',
		'we use cookies',
		'accept all cookies',
		'follow us on',
		'share this',
		'print email',
		'facebook twitter',
		'media contacts',
		'last updated by',
		'last updated on',
		'all rights reserved',
		'terms of use',
		'privacy policy',
		'image credit',
		'photo credit',
		'credit:',
		'read more',
		'related stories',
		'related articles',
		'download image',
		'view all',
		'back to top',
		'cookie',
	]
	return patterns.some((pattern) => text.includes(pattern))
}
