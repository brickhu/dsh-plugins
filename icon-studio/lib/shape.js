/**
 * "Same shape" is decided by the SVG's *inner* code only.
 *
 * The canvas (`viewBox` / `width` / `height`) belongs to the place that draws
 * the icon, not to the icon: the same drawing dropped into a 24, 32 or 48 unit
 * frame is still one icon. Everything here ignores the wrapper on purpose.
 */
import { parsePath, round } from './svg.js'

/** Canonical absolute geometry for one path, so `h16` and `L20 4` agree. */
export const canonicalD = (d) => {
	try {
		return parsePath(d).map((segment) => {
			const points = segment.p || []
			return `${segment.c}${points.map((point) => point.map((value) => round(value, 2)).join(',')).join(' ')}`
		}).join(' ')
	} catch (_error) {
		return d
	}
}

/** Subpath-level canonical form: a compound `d` and the same shapes split into
 * separate paths must compare equal. */
export const canonSubpaths = (d) => {
	try {
		return canonicalD(d).split(/ (?=[Mm])/u).filter((part) => part !== '')
	} catch (_error) {
		return [String(d)]
	}
}

/** Canvas proportions: 24×24 and 48×48 are the same frame, 24×48 is not. */
const aspectRatio = (text) => {
	const viewBox = /viewBox="([^"]+)"/u.exec(text)?.[1]
	if (viewBox) {
		const parts = viewBox.trim().split(/[\s,]+/u).map(Number)
		if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return (parts[2] / parts[3]).toFixed(3)
	}
	const width = /<svg\b[^>]*\bwidth="([\d.]+)"/u.exec(text)?.[1]
	const height = /<svg\b[^>]*\bheight="([\d.]+)"/u.exec(text)?.[1]
	if (width && height && Number(width) > 0 && Number(height) > 0) return (Number(width) / Number(height)).toFixed(3)
	return '1'
}

/** Geometry plus paint plus the frame's proportions; absolute size is excluded. */
export const bodySignature = (svg) => {
	const text = String(svg || '')
	if (text.trim() === '') return ''
	// Presentation attributes inherit from the root <svg>: a path without its own
	// fill is not a difference when the root carries it.
	const rootTag = /<svg\b([^>]*)>/u.exec(text)?.[1] ?? ''
	const rootAttr = (name) => new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(rootTag)?.[1] ?? ''
	const rootFill = rootAttr('fill')
	const rootStroke = rootAttr('stroke')
	const parts = [...text.matchAll(/<(path|circle|rect|line|polygon|polyline|ellipse)\b([^>]*)>/gu)].map((match) => {
		const attrs = match[2]
		const pick = (name) => new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(attrs)?.[1] ?? ''
		return [
			match[1],
			canonicalD(pick('d')),
			pick('cx'), pick('cy'), pick('r'), pick('x'), pick('y'), pick('width'), pick('height'),
			pick('points'), pick('fill') || rootFill, pick('stroke') || rootStroke, pick('stroke-width'), pick('fill-rule'),
			pick('opacity'), pick('stroke-linecap'), pick('stroke-linejoin'),
		].join('|')
	})
	return `${aspectRatio(text)}::${parts.join(';')}`
}

/**
 * Narrow scan boundary: only simple, static, single-colour glyph art is
 * offered as an icon candidate. Illustrations, multi-colour marks, masked or
 * raster-backed art are left out — they are not things this library should own.
 */
export function isIconCandidate(svg) {
	const text = String(svg || '')
	if (text.trim() === '') return false
	if (/<(?:image|foreignObject|text|linearGradient|radialGradient|filter|mask|pattern|clipPath)\b/iu.test(text)) return false
	if (/url\(\s*[#'"][^)]*\)/u.test(text)) return false
	const elements = [...text.matchAll(/<(path|circle|rect|line|polygon|polyline|ellipse)\b/gu)].length
	if (elements === 0 || elements > 10) return false
	const paths = [...text.matchAll(/\bd="([^"]*)"/gu)].map((match) => match[1])
	if (paths.reduce((total, d) => total + d.length, 0) > 2000) return false
	const paints = new Set([...text.matchAll(/\b(?:fill|stroke)="(?!none")[^"]*"/gu)].map((match) => match[0]))
	if (paints.size > 2) return false
	return true
}

/** Signature including the canvas — only used where the canvas matters. */
export const signature = (svg) => {
	const text = String(svg || '')
	if (text.trim() === '') return ''
	const viewBox = /viewBox="([^"]+)"/u.exec(text)?.[1] ?? ''
	return `${viewBox}::${bodySignature(text)}`
}

/** Top-level `<svg>` blocks of a text file, with their offsets. */
export function svgBlocks(text) {
	const blocks = []
	let index = 0
	while (index < text.length) {
		const start = text.indexOf('<svg', index)
		if (start === -1) break
		let depth = 0
		let cursor = start
		let end = -1
		while (cursor < text.length) {
			const open = text.indexOf('<svg', cursor)
			const close = text.indexOf('</svg>', cursor)
			if (close === -1) break
			if (open !== -1 && open < close) {
				depth += 1
				cursor = open + 4
				continue
			}
			depth -= 1
			cursor = close + 6
			if (depth === 0) {
				end = cursor
				break
			}
		}
		if (end === -1) break
		blocks.push({ start, end, text: text.slice(start, end) })
		index = end
	}
	return blocks
}

/** Split one document into wrapper / inner / wrapper so a site can keep its own canvas. */
export function splitSvg(svg) {
	const text = String(svg || '')
	const openStart = text.indexOf('<svg')
	if (openStart === -1) return null
	const openEnd = text.indexOf('>', openStart)
	if (openEnd === -1) return null
	const closeStart = text.lastIndexOf('</svg>')
	if (closeStart === -1 || closeStart < openEnd) return null
	return {
		open: text.slice(0, openEnd + 1),
		inner: text.slice(openEnd + 1, closeStart),
		close: text.slice(closeStart),
	}
}

/* ───────────────── JSX / React SVG calls ───────────────── */

/** Index just past the bracket that closes the one at `open`. */
function closingIndex(text, open) {
	let depth = 0
	let quote = ''
	let index = open
	while (index < text.length) {
		const ch = text[index]
		if (quote !== '') {
			if (ch === '\\') { index += 2; continue }
			if (ch === quote) quote = ''
			index += 1
			continue
		}
		if (ch === "'" || ch === '"' || ch === '`') { quote = ch; index += 1; continue }
		if (ch === '(' || ch === '{' || ch === '[') depth += 1
		else if (ch === ')' || ch === '}' || ch === ']') {
			depth -= 1
			if (depth === 0) return index + 1
		}
		index += 1
	}
	return -1
}

const REACT_ATTR = {
	strokeWidth: 'stroke-width',
	strokeLinecap: 'stroke-linecap',
	strokeLinejoin: 'stroke-linejoin',
	fillRule: 'fill-rule',
}

function attrValue(attrs, name) {
	const match = new RegExp(`\\b${name}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|(-?[\\d.]+))`, 'u').exec(attrs)
	if (!match) return ''
	return match[1] ?? match[2] ?? match[3] ?? ''
}

/**
 * `h('svg', {…}, h('path', {…}), …)` blocks. Many codebases (including this
 * one) never write raw `<svg>` markup, so the scanner must read React calls.
 */

/** String constants in a file (`const D = '…'`), so JSX can reference them. */
function collectStringVars(source) {
	const vars = new Map()
	const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/gu
	let match
	while ((match = re.exec(source)) !== null) {
		const value = match[2] ?? match[3] ?? match[4] ?? ''
		const start = match.index + match[0].length - value.length - 1
		vars.set(match[1], { value, start, end: start + value.length })
	}
	return vars
}

/** One attribute of a React props object, resolving identifiers to string constants. */
/** Object constants (`const stroke = { fill: 'none', … }`) used through spreads. */
function collectObjectVars(source) {
	const vars = new Map()
	const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([^{}]*)\}/gu
	let match
	while ((match = re.exec(source)) !== null) vars.set(match[1], match[2])
	return vars
}

function attrValueFrom(attrs, name, vars) {
	const match = new RegExp(`\\b${name}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`|(-?[\\d.]+)|([A-Za-z_$][\\w$]*))`, 'u').exec(attrs)
	if (!match) return ''
	if (match[1] !== undefined) return match[1]
	if (match[2] !== undefined) return match[2]
	if (match[3] !== undefined) return match[3].includes('${') ? '' : match[3]
	if (match[4] !== undefined) return match[4]
	const ident = match[5]
	return ident !== undefined && vars.has(ident) ? vars.get(ident).value : ''
}

/** Like attrValueFrom, but reports which identifier (if any) supplied the value. */
function attrResolve(attrs, name, vars) {
	const match = new RegExp(`\\b${name}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|\`([^\`]*)\`|(-?[\\d.]+)|([A-Za-z_$][\\w$]*))`, 'u').exec(attrs)
	if (!match) return { value: '', from: null }
	if (match[1] !== undefined) return { value: match[1], from: null }
	if (match[2] !== undefined) return { value: match[2], from: null }
	if (match[3] !== undefined) return { value: match[3].includes('${') ? '' : match[3], from: null }
	if (match[4] !== undefined) return { value: match[4], from: null }
	const ident = match[5]
	if (ident !== undefined && vars.has(ident)) return { value: vars.get(ident).value, from: ident }
	return { value: '', from: null }
}

export function jsxSvgBlocks(text) {
	const blocks = []
	const source = String(text || '')
	const vars = collectStringVars(source)
	const objects = collectObjectVars(source)
	const expand = (attrs) => attrs.replace(/\.\.\.([A-Za-z_$][\w$]*)/gu, (whole, name) => (objects.has(name) ? ` ${objects.get(name)} ` : whole))
	const re = /h\(\s*['"](svg)['"]/gu
	let match
	while ((match = re.exec(source)) !== null) {
		const open = source.indexOf('(', match.index + 1)
		if (open === -1) continue
		const end = closingIndex(source, open)
		if (end === -1) continue
		const call = source.slice(match.index, end)
		const propsOpen = call.indexOf('{')
		const propsEnd = propsOpen === -1 ? -1 : closingIndex(call, propsOpen)
		const props = expand(propsEnd === -1 ? '' : call.slice(propsOpen + 1, propsEnd))
		const viewBox = attrValueFrom(call, 'viewBox', vars) || '0 0 24 24'
		const rootFill = attrValueFrom(props, 'fill', vars)
		const elements = []
		const sites = []
		let geometry = 0
		// Paint on an enclosing h('g') is inherited by its children; flattening the
		// group without carrying it would make stroke-only icons invisible.
		const frames = []
		const gRe = /h\(\s*['"]g['"]\s*,\s*\{/gu
		let group
		while ((group = gRe.exec(call)) !== null) {
			const open = call.indexOf('(', group.index + 1)
			const end = open === -1 ? -1 : closingIndex(call, open)
			const brace = call.indexOf('{', group.index + 1)
			const close = brace === -1 ? -1 : closingIndex(call, brace)
			if (end === -1 || close === -1) continue
			frames.push({ start: group.index, end, attrs: expand(call.slice(brace + 1, close - 1)) })
		}
		const elRe = /h\(\s*['"](path|circle|rect|line|polygon|polyline|ellipse)['"]\s*,\s*\{/gu
		let element
		while ((element = elRe.exec(call)) !== null) {
			const brace = call.indexOf('{', element.index + 1)
			const close = closingIndex(call, brace)
			if (close === -1) continue
			const attrs = expand(call.slice(brace + 1, close - 1))
			const tag = element[1]
			const enclosing = frames.filter((frame) => element.index > frame.start && element.index < frame.end)
			const inherited = (name) => {
				for (let index = enclosing.length - 1; index >= 0; index -= 1) {
					const value = attrValueFrom(enclosing[index].attrs, name, vars)
					if (value !== '') return value
				}
				return ''
			}
			const paint = (name) => attrValueFrom(attrs, name, vars) || inherited(name)
			const resolvedD = attrResolve(attrs, 'd', vars)
			const d = resolvedD.value
			const DYNAMIC = { line: ['x1', 'y1', 'x2', 'y2'], polygon: ['points'], polyline: ['points'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['width', 'height'] }
			const required = tag === 'path' ? ['d'] : (DYNAMIC[tag] || [])
			const values = {}
			for (const name of [...new Set([...required, 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points'])]) {
				values[name] = attrValueFrom(attrs, name, vars)
			}
			// Runtime geometry (template strings, expressions) has no static
			// artwork to import; listing it would only produce blank rows.
			if (required.length === 0 || required.some((name) => values[name] === '')) continue
			geometry += 1
			const attrsOut = []
			for (const [key, name] of Object.entries(REACT_ATTR)) {
				const value = paint(key)
				if (value !== '') attrsOut.push(`${name}="${value}"`)
			}
			for (const name of ['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points']) {
				if (values[name] !== '') attrsOut.push(`${name}="${values[name]}"`)
			}
			const fill = paint('fill') || rootFill
			if (fill !== '') attrsOut.push(`fill="${fill}"`)
			const stroke = paint('stroke')
			if (stroke !== '') attrsOut.push(`stroke="${stroke}"`)
			if (tag === 'path') {
				if (d !== '') {
					if (resolvedD.from !== null) {
						// Shared constant: one rewrite site, no matter how many SVGs use it.
						const constant = vars.get(resolvedD.from)
						sites.push({ start: constant.start, end: constant.end, literal: d, shared: true })
					} else {
						const at = call.indexOf(d, brace)
						if (at !== -1) {
							const dStart = match.index + at
							sites.push({ start: dStart, end: dStart + d.length, literal: d, shared: false })
						}
					}
					elements.push(`<path d="${d}" ${attrsOut.join(' ')}/>`)
				}
			} else {
				elements.push(`<${tag} ${attrsOut.join(' ')}/>`)
			}
		}
		if (elements.length === 0 || geometry === 0) continue
		// Root paint attributes must survive: stroke icons carry fill="none" plus a
		// root stroke, and dropping it makes every scanned shape invisible.
		const rootAttrs = []
		if (rootFill !== '') rootAttrs.push(`fill="${rootFill}"`)
		for (const [key, name] of [['stroke', 'stroke'], ...Object.entries(REACT_ATTR)]) {
			const value = attrValueFrom(props, key, vars)
			if (value !== '') rootAttrs.push(`${name}="${value}"`)
		}
		blocks.push({
			start: match.index,
			end,
			text: `<svg viewBox="${viewBox}"${rootAttrs.length > 0 ? ` ${rootAttrs.join(' ')}` : ''}>${elements.join('')}</svg>`,
			dSites: sites,
		})
	}
	return blocks
}

/* ───────────────── \{ viewBox, markup \} constants ───────────────── */

function readQuoted(text, quoteIndex) {
	const quote = text[quoteIndex]
	if (quote !== "'" && quote !== '"') return null
	let index = quoteIndex + 1
	let raw = ''
	while (index < text.length) {
		const ch = text[index]
		if (ch === '\\') {
			raw += ch + (text[index + 1] ?? '')
			index += 2
			continue
		}
		if (ch === quote) return { raw, start: quoteIndex + 1, end: index, quote }
		raw += ch
		index += 1
	}
	return null
}

const unescapeJs = (raw) => raw.replace(/\\(['"\\])/gu, '$1').replace(/\\n/gu, '\n')

/**
 * Icons that live as `{ viewBox: '…', markup: '<path …/>' }` constants — how
 * this plugin stores its own marks. They are not SVG documents, so the block
 * scanners above cannot see them; this reader can, and it remembers where the
 * markup string sits so it can be rewritten in place.
 */
export function markupBlocks(text) {
	const source = String(text || '')
	const blocks = []
	const re = /\bmarkup\s*:\s*/gu
	let match
	while ((match = re.exec(source)) !== null) {
		const quoted = readQuoted(source, match.index + match[0].length)
		if (!quoted) continue
		const before = source.slice(Math.max(0, match.index - 600), match.index)
		const viewBoxMatch = /viewBox\s*:\s*(['"])([^'"]+)\1(?![\s\S]*viewBox)/u.exec(before)
		const viewBox = viewBoxMatch ? viewBoxMatch[2] : '0 0 24 24'
		const markup = unescapeJs(quoted.raw)
		if (markup.trim() === '') continue
		blocks.push({
			start: match.index,
			end: quoted.end + 1,
			text: `<svg viewBox="${viewBox}">${markup}</svg>`,
			markup,
			quote: quoted.quote,
			/** Content range of the JS string, inside the quotes. */
			innerStart: quoted.start,
			innerEnd: quoted.end,
		})
	}
	return blocks
}

/* ───────────────── shared path-data constants ───────────────── */

const PATH_ONLY = /^\s*[Mm][\d\s.,+\-LlHhVvCcSsQqTtAaZzMm]*$/u

/**
 * Long SVG path strings assigned to constants (`const P = 'M…Z'`). Icons are
 * often shared that way: one constant, many components. The literal is a real
 * reference even though no `<svg>` or `h('svg')` surrounds it.
 */
export function pathLiterals(text) {
	const source = String(text || '')
	const out = []
	const re = /(['"`])([Mm][^'"`\n]{12,}Z)\1/gu
	let match
	while ((match = re.exec(source)) !== null) {
		const value = match[2]
		if (!PATH_ONLY.test(value)) continue
		const startIndex = match.index + 1
		out.push({ start: startIndex, end: startIndex + value.length, literal: value, value })
	}
	return out
}

/** Ranges of quoted JS strings, so markup inside a string is not read twice. */
export function quotedRanges(text) {
	const source = String(text || '')
	const out = []
	let index = 0
	while (index < source.length) {
		const quote = source[index]
		if (quote !== "'" && quote !== '"' && quote !== '`') { index += 1; continue }
		const parsed = readQuoted(source, index)
		if (!parsed) { index += 1; continue }
		out.push({ start: index, end: parsed.end + 1 })
		index = parsed.end + 1
	}
	return out
}
