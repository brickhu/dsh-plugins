/**
 * SVG core for dsh-icon-studio.
 *
 * One graphic = one svg file. Everything this module produces is a *clean*
 * document: no transform, no style attribute, no class references, one
 * `<path>` per selectable element and a trimmed viewBox; single-colour imports
 * get `currentColor` so they follow the text colour.
 *
 * Pipeline used by every import path:
 *
 *   parse -> inline <style> -> resolve <use> -> flatten transforms
 *         -> shapes become paths -> split merged paths at every M
 *         -> normalise paint -> trim viewBox -> serialise -> hash
 *
 * The path model is absolute M / L / C / Q / Z only; arcs are converted to
 * cubics so applying an affine matrix can never corrupt them.
 */

import { createHash } from 'node:crypto'

const DEFAULT_FILL = '#000000'
const EPS = 1e-6

/* ───────────────────────────── numbers ───────────────────────────── */

export function round(value, digits = 2) {
	const factor = 10 ** digits
	const rounded = Math.round(value * factor) / factor
	return Object.is(rounded, -0) ? 0 : rounded
}

function fmt(value) {
	if (!Number.isFinite(value)) return '0'
	const rounded = round(value, 2)
	return String(rounded)
}

/* ───────────────────────────── matrices ───────────────────────────── */

export const IDENTITY = [1, 0, 0, 1, 0, 0]

export function multiply(m1, m2) {
	return [
		m1[0] * m2[0] + m1[2] * m2[1],
		m1[1] * m2[0] + m1[3] * m2[1],
		m1[0] * m2[2] + m1[2] * m2[3],
		m1[1] * m2[2] + m1[3] * m2[3],
		m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
		m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
	]
}

export function applyMatrix(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function translateMatrix(x, y) {
	return [1, 0, 0, 1, x, y]
}

export function scaleMatrix(x, y = x) {
	return [x, 0, 0, y, 0, 0]
}

export function rotateMatrix(degrees, cx = 0, cy = 0) {
	const r = (degrees * Math.PI) / 180
	const cos = Math.cos(r)
	const sin = Math.sin(r)
	const rotate = [cos, sin, -sin, cos, 0, 0]
	if (cx === 0 && cy === 0) return rotate
	return multiply(multiply(translateMatrix(cx, cy), rotate), translateMatrix(-cx, -cy))
}

export function matrixToString(m) {
	if (isIdentity(m)) return ''
	return `matrix(${fmt(m[0])} ${fmt(m[1])} ${fmt(m[2])} ${fmt(m[3])} ${fmt(m[4])} ${fmt(m[5])})`
}

export function isIdentity(m) {
	return Math.abs(m[0] - 1) < EPS && Math.abs(m[1]) < EPS && Math.abs(m[2]) < EPS
		&& Math.abs(m[3] - 1) < EPS && Math.abs(m[4]) < EPS && Math.abs(m[5]) < EPS
}

/** Parse one SVG transform list into one matrix. */
export function parseTransform(text) {
	let m = IDENTITY
	if (typeof text !== 'string' || text.trim() === '') return m
	const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g
	let match
	while ((match = re.exec(text)) !== null) {
		const name = match[1]
		const args = (match[2].match(/-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)
		let next = null
		if (name === 'translate') next = translateMatrix(args[0] ?? 0, args[1] ?? 0)
		else if (name === 'scale') next = scaleMatrix(args[0] ?? 1, args.length > 1 ? args[1] : undefined)
		else if (name === 'matrix' && args.length >= 6) next = args.slice(0, 6)
		else if (name === 'rotate') next = rotateMatrix(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0)
		else if (name === 'skewX' || name === 'skewY') {
			const r = ((args[0] ?? 0) * Math.PI) / 180
			next = name === 'skewX' ? [1, 0, Math.tan(r), 1, 0, 0] : [1, Math.tan(r), 0, 1, 0, 0]
		}
		if (!next) continue
		m = multiply(m, next)
	}
	return m
}

/* ───────────────────────────── XML ───────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decodeEntities(text) {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X'
				? Number.parseInt(body.slice(2), 16)
				: Number.parseInt(body.slice(1), 10)
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole
		}
		return ENTITIES[body] ?? whole
	})
}

function localName(raw) {
	const colon = raw.indexOf(':')
	return colon === -1 ? raw : raw.slice(colon + 1)
}

/** Parse an attribute string: `a="1" b='2'` -> object. */
export function parseAttributes(text) {
	const attrs = {}
	const re = /([^\s=/<>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
	let match
	while ((match = re.exec(text)) !== null) {
		attrs[localName(match[1])] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? '')
	}
	return attrs
}

/**
 * A tolerant XML reader for SVG documents. Returns the top-level nodes.
 * Text is kept only where it matters (`<style>`, `<script>` is dropped).
 */
export function parseXml(text) {
	const root = { tag: '#root', attrs: {}, children: [], parent: null }
	const stack = [root]
	let i = 0
	const n = text.length
	const pushText = (raw, parent) => {
		const value = decodeEntities(raw)
		if (value.trim() !== '') parent.children.push({ tag: '#text', text: value, attrs: {}, children: [], parent })
	}
	while (i < n) {
		const lt = text.indexOf('<', i)
		if (lt === -1) {
			pushText(text.slice(i), stack[stack.length - 1])
			break
		}
		if (lt > i) pushText(text.slice(i, lt), stack[stack.length - 1])
		if (text.startsWith('<!--', lt)) {
			const end = text.indexOf('-->', lt + 4)
			i = end === -1 ? n : end + 3
			continue
		}
		if (text.startsWith('<![CDATA[', lt)) {
			const end = text.indexOf(']]>', lt + 9)
			const value = text.slice(lt + 9, end === -1 ? n : end)
			if (value.trim() !== '') stack[stack.length - 1].children.push({ tag: '#text', text: value, attrs: {}, children: [], parent: stack[stack.length - 1] })
			i = end === -1 ? n : end + 3
			continue
		}
		if (text.startsWith('<?', lt)) {
			const end = text.indexOf('?>', lt + 2)
			i = end === -1 ? n : end + 2
			continue
		}
		if (text.startsWith('<!', lt)) {
			let depth = 0
			let j = lt
			for (; j < n; j += 1) {
				if (text[j] === '[') depth += 1
				else if (text[j] === ']') depth -= 1
				else if (text[j] === '>' && depth <= 0) break
			}
			i = j + 1
			continue
		}
		if (text[lt + 1] === '/') {
			const end = text.indexOf('>', lt)
			const name = localName((text.slice(lt + 2, end === -1 ? n : end).trim().split(/\s+/)[0]) ?? '')
			i = end === -1 ? n : end + 1
			for (let k = stack.length - 1; k > 0; k -= 1) {
				if (stack[k].tag === name) {
					stack.length = k
					break
				}
			}
			continue
		}
		let j = lt + 1
		let quote = null
		for (; j < n; j += 1) {
			const ch = text[j]
			if (quote) {
				if (ch === quote) quote = null
			} else if (ch === '"' || ch === "'") quote = ch
			else if (ch === '>') break
		}
		const raw = text.slice(lt + 1, j)
		i = j + 1
		const selfClose = raw.endsWith('/')
		const body = selfClose ? raw.slice(0, -1) : raw
		const nameMatch = /^([^\s/>]+)/.exec(body)
		if (!nameMatch) continue
		const tag = localName(nameMatch[1])
		const attrs = parseAttributes(body.slice(nameMatch[0].length))
		const parent = stack[stack.length - 1]
		const node = { tag, attrs, children: [], parent }
		parent.children.push(node)
		if (!selfClose) stack.push(node)
	}
	return root.children
}

function walk(node, visit) {
	if (!node || node.tag === '#text') return
	visit(node)
	for (const child of node.children) walk(child, visit)
}

function byId(nodes) {
	const index = new Map()
	walk({ tag: '#root', children: nodes, attrs: {}, parent: null }, (node) => {
		if (typeof node.attrs.id === 'string' && !index.has(node.attrs.id)) index.set(node.attrs.id, node)
	})
	return index
}

/* ───────────────────────────── CSS ───────────────────────────── */

const SIMPLE_SELECTOR = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/

function styleDeclarations(text) {
	const out = {}
	for (const piece of String(text).split(';')) {
		const colon = piece.indexOf(':')
		if (colon === -1) continue
		const key = piece.slice(0, colon).trim()
		const value = piece.slice(colon + 1).trim().replace(/\s*!important\s*$/i, '')
		if (key === '' || value === '') continue
		out[key] = value
	}
	return out
}

function matchSimple(selector, node) {
	const match = SIMPLE_SELECTOR.exec(selector)
	if (!match) return null
	const [, tag, rest] = match
	let specificity = 0
	if (tag) {
		if (node.tag !== tag) return null
		specificity += 1
	}
	for (const piece of rest.match(/[.#][\w-]+/g) ?? []) {
		const value = piece.slice(1)
		if (piece[0] === '.') {
			if (!(node.attrs.class ?? '').split(/\s+/).includes(value)) return null
			specificity += 10
		} else {
			if (node.attrs.id !== value) return null
			specificity += 100
		}
	}
	if (!tag && !rest) return null
	return specificity
}

/** Parse `<style>` blocks into `{ selector, declarations, specificity }` rules. */
function collectStyleRules(doc) {
	const rules = []
	walk({ tag: '#root', children: doc, attrs: {}, parent: null }, (node) => {
		if (node.tag !== 'style') return
		const css = node.children.filter((child) => child.tag === '#text').map((child) => child.text).join('\n')
		for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const selectors = block[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',')
			const declarations = styleDeclarations(block[2])
			for (const raw of selectors) {
				const selector = raw.trim()
				if (selector === '' || selector.includes(':') || selector.includes('@') || selector.includes('*')) continue
				rules.push({ selector, declarations })
			}
		}
	})
	return rules
}

/* ───────────────────────────── paint ───────────────────────────── */

const PAINT_KEYS = {
	fill: 'fill',
	stroke: 'stroke',
	'stroke-width': 'strokeWidth',
	'stroke-linecap': 'linecap',
	'stroke-linejoin': 'linejoin',
	'stroke-miterlimit': 'miterlimit',
	'stroke-dasharray': 'dasharray',
	'stroke-dashoffset': 'dashoffset',
	'fill-rule': 'fillRule',
	'fill-opacity': 'fillOpacity',
	'stroke-opacity': 'strokeOpacity',
	opacity: 'opacity',
	'paint-order': 'paintOrder',
	display: 'display',
	visibility: 'visibility',
	color: 'color',
}

/**
 * Effective paint for one node. `inherited` carries the parent's paint only
 * (never opacity), so opacity accumulates separately in the walk.
 */
function styleFrom(node, inherited, rules) {
	const style = { ...inherited }
	const apply = (declarations) => {
		for (const [key, value] of Object.entries(declarations)) {
			const canonical = PAINT_KEYS[key]
			if (canonical) style[canonical] = value
		}
	}
	// SVG precedence: presentation attributes < stylesheet rules < inline style.
	for (const [key, value] of Object.entries(node.attrs)) {
		const canonical = PAINT_KEYS[key]
		if (canonical) style[canonical] = value
	}
	const matched = []
	for (const rule of rules) {
		const specificity = matchSimple(rule.selector, node)
		if (specificity !== null) matched.push({ rule, specificity })
	}
	matched.sort((a, b) => a.specificity - b.specificity)
	for (const { rule } of matched) apply(rule.declarations)
	if (typeof node.attrs.style === 'string') apply(styleDeclarations(node.attrs.style))
	return style
}

const NAMED_COLORS = {
	black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
	transparent: 'none', currentcolor: 'currentColor', gray: '#808080', grey: '#808080',
}

function canonicalColor(value) {
	if (typeof value !== 'string') return undefined
	let text = value.trim()
	if (text === '') return undefined
	const lower = text.toLowerCase()
	if (lower === 'currentcolor') return 'currentColor'
	if (lower === 'transparent') return 'none'
	if (NAMED_COLORS[lower]) text = NAMED_COLORS[lower]
	if (/^#[0-9a-fA-F]{3}$/.test(text)) {
		return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase()
	}
	if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase()
	if (/^#[0-9a-fA-F]{8}$/.test(text)) return text.toLowerCase()
	if (/^rgba?\(/i.test(text) || /^hsla?\(/i.test(text)) return lower
	if (/^url\(/i.test(text)) return text
	return lower
}

function isConcreteColor(value) {
	return typeof value === 'string' && value !== '' && value !== 'none' && value !== 'currentColor' && !/^url\(/i.test(value)
}

/* ───────────────────────────── paths ───────────────────────────── */

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

function tokenizePath(text) {
	const tokens = []
	let i = 0
	const n = text.length
	while (i < n) {
		const ch = text[i]
		if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\r' || ch === '\t') {
			i += 1
			continue
		}
		if (/[a-zA-Z]/.test(ch)) {
			tokens.push({ type: 'cmd', value: ch })
			i += 1
			continue
		}
		const start = i
		if (ch === '+' || ch === '-') i += 1
		let digits = false
		while (i < n && /[0-9]/.test(text[i])) {
			i += 1
			digits = true
		}
		if (text[i] === '.') {
			i += 1
			while (i < n && /[0-9]/.test(text[i])) {
				i += 1
				digits = true
			}
		}
		if (!digits) {
			i += 1
			continue
		}
		if (text[i] === 'e' || text[i] === 'E') {
			i += 1
			if (text[i] === '+' || text[i] === '-') i += 1
			while (i < n && /[0-9]/.test(text[i])) i += 1
		}
		const value = Number(text.slice(start, i))
		if (Number.isFinite(value)) tokens.push({ type: 'num', value })
	}
	return tokens
}

/** Endpoint arc -> cubic segments. */
function arcToCubics(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
	if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return []
	let rxAbs = Math.abs(rx)
	let ryAbs = Math.abs(ry)
	if (rxAbs < EPS || ryAbs < EPS) return [[[x1, y1], [x1, y1], [x2, y2]]]
	const phi = (phiDeg * Math.PI) / 180
	const cosPhi = Math.cos(phi)
	const sinPhi = Math.sin(phi)
	const dx = (x1 - x2) / 2
	const dy = (y1 - y2) / 2
	const x1p = cosPhi * dx + sinPhi * dy
	const y1p = -sinPhi * dx + cosPhi * dy
	const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs)
	if (lambda > 1) {
		const scale = Math.sqrt(lambda)
		rxAbs *= scale
		ryAbs *= scale
	}
	const sign = largeArc === sweep ? -1 : 1
	const numerator = rxAbs * rxAbs * ryAbs * ryAbs - rxAbs * rxAbs * y1p * y1p - ryAbs * ryAbs * x1p * x1p
	const denominator = rxAbs * rxAbs * y1p * y1p + ryAbs * ryAbs * x1p * x1p
	const factor = sign * Math.sqrt(Math.max(0, numerator / (denominator || 1)))
	const cxp = (factor * rxAbs * y1p) / ryAbs
	const cyp = (-factor * ryAbs * x1p) / rxAbs
	const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
	const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
	const vector = (ux, uy, vx, vy) => {
		const dot = ux * vx + uy * vy
		const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
		const angle = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))))
		return ux * vy - uy * vx < 0 ? -angle : angle
	}
	const start = [1, 0]
	const u = [(x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs]
	const v = [(-x1p - cxp) / rxAbs, (-y1p - cyp) / ryAbs]
	const theta1 = vector(start[0], start[1], u[0], u[1])
	let delta = vector(u[0], u[1], v[0], v[1])
	if (!sweep && delta > 0) delta -= Math.PI * 2
	if (sweep && delta < 0) delta += Math.PI * 2
	const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
	const step = delta / segments
	const out = []
	const point = (angle) => [
		cx + rxAbs * Math.cos(angle) * cosPhi - ryAbs * Math.sin(angle) * sinPhi,
		cy + rxAbs * Math.cos(angle) * sinPhi + ryAbs * Math.sin(angle) * cosPhi,
	]
	const derivative = (angle) => [
		-rxAbs * Math.sin(angle) * cosPhi - ryAbs * Math.cos(angle) * sinPhi,
		-rxAbs * Math.sin(angle) * sinPhi + ryAbs * Math.cos(angle) * cosPhi,
	]
	for (let index = 0; index < segments; index += 1) {
		const a1 = theta1 + index * step
		const a2 = a1 + step
		const alpha = (4 / 3) * Math.tan((a2 - a1) / 4)
		const p1 = point(a1)
		const p2 = point(a2)
		const d1 = derivative(a1)
		const d2 = derivative(a2)
		out.push([
			[p1[0] + alpha * d1[0], p1[1] + alpha * d1[1]],
			[p2[0] - alpha * d2[0], p2[1] - alpha * d2[1]],
			p2,
		])
	}
	return out
}

/**
 * Parse path data into absolute segments: M, L, C, Q, Z.
 * Every point is `[x, y]`.
 */
export function parsePath(text) {
	const tokens = tokenizePath(String(text ?? ''))
	const segments = []
	let i = 0
	let cx = 0
	let cy = 0
	let sx = 0
	let sy = 0
	let command = null
	let lastCubicControl = null
	let lastQuadControl = null
	let first = true
	while (i < tokens.length) {
		if (tokens[i].type === 'cmd') {
			command = tokens[i].value
			i += 1
		} else if (command === null) {
			i += 1
			continue
		}
		const upper = command.toUpperCase()
		const relative = command !== upper
		if (upper === 'Z') {
			segments.push({ c: 'Z' })
			cx = sx
			cy = sy
			lastCubicControl = null
			lastQuadControl = null
			command = null
			continue
		}
		const arity = ARITY[upper]
		if (arity === undefined) {
			command = null
			continue
		}
		const numbers = []
		for (let k = 0; k < arity; k += 1) {
			const token = tokens[i + k]
			if (!token || token.type !== 'num') break
			numbers.push(token.value)
		}
		if (numbers.length < arity) break
		i += arity
		if (upper === 'M') {
			const x = relative && !first ? cx + numbers[0] : numbers[0]
			const y = relative && !first ? cy + numbers[1] : numbers[1]
			segments.push({ c: 'M', p: [[x, y]] })
			cx = x
			cy = y
			sx = x
			sy = y
			first = false
			lastCubicControl = null
			lastQuadControl = null
			// implicit lineto for the remaining pairs
			command = relative ? 'l' : 'L'
			continue
		}
		first = false
		if (upper === 'L') {
			const x = relative ? cx + numbers[0] : numbers[0]
			const y = relative ? cy + numbers[1] : numbers[1]
			segments.push({ c: 'L', p: [[x, y]] })
			cx = x
			cy = y
			lastCubicControl = null
			lastQuadControl = null
		} else if (upper === 'H') {
			const x = relative ? cx + numbers[0] : numbers[0]
			segments.push({ c: 'L', p: [[x, cy]] })
			cx = x
			lastCubicControl = null
			lastQuadControl = null
		} else if (upper === 'V') {
			const y = relative ? cy + numbers[0] : numbers[0]
			segments.push({ c: 'L', p: [[cx, y]] })
			cy = y
			lastCubicControl = null
			lastQuadControl = null
		} else if (upper === 'C') {
			const x1 = relative ? cx + numbers[0] : numbers[0]
			const y1 = relative ? cy + numbers[1] : numbers[1]
			const x2 = relative ? cx + numbers[2] : numbers[2]
			const y2 = relative ? cy + numbers[3] : numbers[3]
			const x = relative ? cx + numbers[4] : numbers[4]
			const y = relative ? cy + numbers[5] : numbers[5]
			segments.push({ c: 'C', p: [[x1, y1], [x2, y2], [x, y]] })
			lastCubicControl = [x2, y2]
			lastQuadControl = null
			cx = x
			cy = y
		} else if (upper === 'S') {
			const reflected = lastCubicControl ? [2 * cx - lastCubicControl[0], 2 * cy - lastCubicControl[1]] : [cx, cy]
			const x2 = relative ? cx + numbers[0] : numbers[0]
			const y2 = relative ? cy + numbers[1] : numbers[1]
			const x = relative ? cx + numbers[2] : numbers[2]
			const y = relative ? cy + numbers[3] : numbers[3]
			segments.push({ c: 'C', p: [reflected, [x2, y2], [x, y]] })
			lastCubicControl = [x2, y2]
			lastQuadControl = null
			cx = x
			cy = y
		} else if (upper === 'Q') {
			const x1 = relative ? cx + numbers[0] : numbers[0]
			const y1 = relative ? cy + numbers[1] : numbers[1]
			const x = relative ? cx + numbers[2] : numbers[2]
			const y = relative ? cy + numbers[3] : numbers[3]
			segments.push({ c: 'Q', p: [[x1, y1], [x, y]] })
			lastQuadControl = [x1, y1]
			lastCubicControl = null
			cx = x
			cy = y
		} else if (upper === 'T') {
			const reflected = lastQuadControl ? [2 * cx - lastQuadControl[0], 2 * cy - lastQuadControl[1]] : [cx, cy]
			const x = relative ? cx + numbers[0] : numbers[0]
			const y = relative ? cy + numbers[1] : numbers[1]
			segments.push({ c: 'Q', p: [reflected, [x, y]] })
			lastQuadControl = reflected
			lastCubicControl = null
			cx = x
			cy = y
		} else if (upper === 'A') {
			const rx = numbers[0]
			const ry = numbers[1]
			const rotation = numbers[2]
			const largeArc = numbers[3] !== 0
			const sweep = numbers[4] !== 0
			const x = relative ? cx + numbers[5] : numbers[5]
			const y = relative ? cy + numbers[6] : numbers[6]
			for (const cubic of arcToCubics(cx, cy, rx, ry, rotation, largeArc, sweep, x, y)) {
				segments.push({ c: 'C', p: cubic })
			}
			cx = x
			cy = y
			lastCubicControl = null
			lastQuadControl = null
		}
	}
	return segments
}

export function segmentsToString(segments) {
	const out = []
	for (const segment of segments) {
		if (segment.c === 'Z') {
			out.push('Z')
			continue
		}
		const points = segment.p.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' ')
		out.push(`${segment.c}${points}`)
	}
	return out.join('')
}

/** Split absolute segments into subpaths, each starting at its own M. */
export function splitSubpaths(segments) {
	const paths = []
	let current = []
	for (const segment of segments) {
		if (segment.c === 'M') {
			if (current.length > 0) paths.push(current)
			current = [segment]
			continue
		}
		if (current.length === 0) current = [{ c: 'M', p: [[0, 0]] }]
		current.push(segment)
	}
	if (current.length > 0) paths.push(current)
	return paths.filter((path) => path.some((segment) => segment.c !== 'M'))
}

export function transformSegments(segments, matrix) {
	if (isIdentity(matrix)) return segments
	return segments.map((segment) => {
		if (segment.c === 'Z') return segment
		return { c: segment.c, p: segment.p.map(([x, y]) => applyMatrix(matrix, x, y)) }
	})
}

/** Apply a matrix to path data, returning clean path data. */
export function transformPath(d, matrix) {
	return segmentsToString(transformSegments(parsePath(d), matrix))
}

export function translatePath(d, dx, dy) {
	return transformPath(d, translateMatrix(dx, dy))
}

/* ───────────────────────────── bbox ───────────────────────────── */

function cubicExtrema(p0, p1, p2, p3) {
	const a = -p0 + 3 * p1 - 3 * p2 + p3
	const b = 2 * (p0 - 2 * p1 + p2)
	const c = p1 - p0
	const roots = []
	if (Math.abs(a) < EPS) {
		if (Math.abs(b) > EPS) roots.push(-c / b)
	} else {
		const disc = b * b - 4 * a * c
		if (disc >= 0) {
			const sq = Math.sqrt(disc)
			roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a))
		}
	}
	return roots.filter((root) => root > 0 && root < 1)
}

function cubicAt(p0, p1, p2, p3, t) {
	const mt = 1 - t
	return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

function quadAt(p0, p1, p2, t) {
	const mt = 1 - t
	return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2
}

/** Tight bounding box of path data. Returns null for empty paths. */
export function pathBBox(d) {
	const segments = parsePath(d)
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	let cx = 0
	let cy = 0
	let sx = 0
	let sy = 0
	const add = (x, y) => {
		if (x < minX) minX = x
		if (y < minY) minY = y
		if (x > maxX) maxX = x
		if (y > maxY) maxY = y
	}
	for (const segment of segments) {
		if (segment.c === 'Z') {
			cx = sx
			cy = sy
			continue
		}
		if (segment.c === 'M') {
			cx = segment.p[0][0]
			cy = segment.p[0][1]
			sx = cx
			sy = cy
			add(cx, cy)
			continue
		}
		if (segment.c === 'L') {
			cx = segment.p[0][0]
			cy = segment.p[0][1]
			add(cx, cy)
			continue
		}
		if (segment.c === 'C') {
			const [p1, p2, p3] = segment.p
			add(p3[0], p3[1])
			for (const t of cubicExtrema(cx, p1[0], p2[0], p3[0])) add(cubicAt(cx, p1[0], p2[0], p3[0], t), cubicAt(cy, p1[1], p2[1], p3[1], t))
			for (const t of cubicExtrema(cy, p1[1], p2[1], p3[1])) add(cubicAt(cx, p1[0], p2[0], p3[0], t), cubicAt(cy, p1[1], p2[1], p3[1], t))
			cx = p3[0]
			cy = p3[1]
			continue
		}
		if (segment.c === 'Q') {
			const [p1, p3] = segment.p
			add(p3[0], p3[1])
			const dx = p1[0] - cx
			const dy = p1[1] - cy
			const ex = p3[0] - p1[0]
			const ey = p3[1] - p1[1]
			const denomX = dx - ex
			const denomY = dy - ey
			const ts = []
			if (Math.abs(denomX) > EPS) ts.push(dx / denomX)
			if (Math.abs(denomY) > EPS) ts.push(dy / denomY)
			for (const t of ts) {
				if (t > 0 && t < 1) add(quadAt(cx, p1[0], p3[0], t), quadAt(cy, p1[1], p3[1], t))
			}
			cx = p3[0]
			cy = p3[1]
		}
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
	return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) }
}

/* ───────────────── stroke crossings ───────────────── */

const CROSS_EPS = 1e-9

/** Flatten one `d` into polylines, sampling curves; arcs become their chord. */
function pathPolylines(d) {
	const segments = parsePath(d)
	const lines = []
	let current = null
	let cx = 0
	let cy = 0
	let sx = 0
	let sy = 0
	const push = (x, y) => {
		if (!current || !Number.isFinite(x) || !Number.isFinite(y)) return
		current.push([x, y])
	}
	for (const segment of segments) {
		if (segment.c === 'M') {
			cx = segment.p[0][0]
			cy = segment.p[0][1]
			sx = cx
			sy = cy
			current = [[cx, cy]]
			lines.push(current)
			continue
		}
		if (segment.c === 'Z') {
			if (current && current.length > 1) push(sx, sy)
			cx = sx
			cy = sy
			continue
		}
		if (!current) continue
		if (segment.c === 'L') {
			const point = segment.p[0]
			push(point[0], point[1])
			cx = point[0]
			cy = point[1]
			continue
		}
		if (segment.c === 'C') {
			const [p1, p2, p3] = segment.p
			for (let step = 1; step <= 8; step += 1) {
				const t = step / 8
				push(cubicAt(cx, p1[0], p2[0], p3[0], t), cubicAt(cy, p1[1], p2[1], p3[1], t))
			}
			cx = p3[0]
			cy = p3[1]
			continue
		}
		if (segment.c === 'Q') {
			const [p1, p3] = segment.p
			for (let step = 1; step <= 8; step += 1) {
				const t = step / 8
				push(quadAt(cx, p1[0], p3[0], t), quadAt(cy, p1[1], p3[1], t))
			}
			cx = p3[0]
			cy = p3[1]
			continue
		}
		if (segment.c === 'A') {
			const point = segment.p[segment.p.length - 1]
			push(point[0], point[1])
			cx = point[0]
			cy = point[1]
		}
	}
	return lines.filter((line) => line.length > 1)
}

/** Polylines of one SVG element, in canvas units. */
function elementPolylines(tag, attrs) {
	const pick = (name) => {
		const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u').exec(attrs)
		return match ? Number(match[1]) : NaN
	}
	if (tag === 'path') return pathPolylines(/\sd="([^"]*)"/u.exec(attrs)?.[1] ?? '')
	if (tag === 'line') {
		const x1 = pick('x1')
		const y1 = pick('y1')
		const x2 = pick('x2')
		const y2 = pick('y2')
		return [[x1, y1], [x2, y2]].some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)) ? [] : [[[x1, y1], [x2, y2]]]
	}
	if (tag === 'rect') {
		const x = pick('x') || 0
		const y = pick('y') || 0
		const w = pick('width')
		const h = pick('height')
		if (!Number.isFinite(w) || !Number.isFinite(h)) return []
		return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]
	}
	if (tag === 'circle' || tag === 'ellipse') {
		const cx = pick('cx') || 0
		const cy = pick('cy') || 0
		const rx = tag === 'circle' ? pick('r') : pick('rx')
		const ry = tag === 'circle' ? pick('r') : pick('ry')
		if (!Number.isFinite(rx) || !Number.isFinite(ry)) return []
		const points = []
		for (let step = 0; step <= 24; step += 1) {
			const angle = (step / 24) * Math.PI * 2
			points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)])
		}
		return [points]
	}
	if (tag === 'polygon' || tag === 'polyline') {
		const raw = /\spoints="([^"]*)"/u.exec(attrs)?.[1] ?? ''
		const numbers = raw.trim().split(/[\s,]+/u).map(Number).filter((value) => Number.isFinite(value))
		const points = []
		for (let index = 0; index + 1 < numbers.length; index += 2) points.push([numbers[index], numbers[index + 1]])
		if (tag === 'polygon' && points.length > 2) points.push(points[0])
		return points.length > 1 ? [points] : []
	}
	return []
}

/** Do two segments cross strictly between their endpoints? */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
	const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
	const d1 = side(ax, ay, bx, by, cx, cy)
	const d2 = side(ax, ay, bx, by, dx, dy)
	const d3 = side(cx, cy, dx, dy, ax, ay)
	const d4 = side(cx, cy, dx, dy, bx, by)
	return ((d1 > CROSS_EPS && d2 < -CROSS_EPS) || (d1 < -CROSS_EPS && d2 > CROSS_EPS))
		&& ((d3 > CROSS_EPS && d4 < -CROSS_EPS) || (d3 < -CROSS_EPS && d4 > CROSS_EPS))
}

/**
 * How many pairs of separate elements have one stroke passing **through** the
 * other (two or more proper crossings).
 *
 * A single touch is a joint — a calendar's tabs crossing its top edge, a plus
 * made of two lines — and stays quiet. Two crossings means one shape is laid on
 * top of another, which is the classic broken composite: the line that should
 * be hidden keeps going through.
 */
export function strokeCrossings(svg) {
	const text = String(svg || '')
	const elements = []
	for (const match of text.matchAll(/<(path|circle|rect|line|polygon|polyline|ellipse)\b([^>]*)>/gu)) {
		const lines = elementPolylines(match[1].toLowerCase(), match[2])
		if (lines.length > 0) elements.push(lines)
	}
	let pairs = 0
	for (let left = 0; left < elements.length; left += 1) {
		for (let right = left + 1; right < elements.length; right += 1) {
			let crossings = 0
			for (const a of elements[left]) {
				for (let index = 0; index + 1 < a.length && crossings < 2; index += 1) {
					for (const b of elements[right]) {
						for (let step = 0; step + 1 < b.length; step += 1) {
							if (segmentsCross(a[index][0], a[index][1], a[index + 1][0], a[index + 1][1], b[step][0], b[step][1], b[step + 1][0], b[step + 1][1])) {
								crossings += 1
								if (crossings >= 2) break
							}
						}
						if (crossings >= 2) break
					}
					if (crossings >= 2) break
				}
			}
			if (crossings >= 2) pairs += 1
		}
	}
	return pairs
}

/**
 * One path -> the pieces it should become. Disjoint subpaths are separate
 * shapes worth selecting on their own; nested ones are a compound path whose
 * winding punches holes, so they stay together.
 */
function splitPieces(segments) {
	const parts = splitSubpaths(segments).map((sub) => segmentsToString(sub))
	if (parts.length <= 1) return parts
	const boxes = parts.map((part) => pathBBox(part))
	const nested = boxes.some((box, index) => boxes.some((other, otherIndex) => otherIndex > index && boxesOverlap(box, other)))
	return nested ? [segmentsToString(segments)] : parts
}

function boxesOverlap(a, b) {
	if (!a || !b) return true
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/* ───────────────────────────── mask expansion ───────────────────────────── */

function refIdFromUrl(value) {
	if (typeof value !== 'string') return ''
	const match = /^url\(\s*#([^)\s]+)\s*\)$/.exec(value.trim())
	return match ? match[1] : ''
}

/** Perceived brightness, 0..1, for a mask paint (white reveals, black hides). */
function luminance(value) {
	const color = canonicalColor(value)
	if (!color || color === 'none') return 0
	if (color === 'currentColor') return 1
	const hex = /^#([0-9a-f]{6})$/.exec(color)
	if (!hex) return 1
	const number = Number.parseInt(hex[1], 16)
	const channels = [(number >> 16) & 255, (number >> 8) & 255, number & 255]
	return round((0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255, 3)
}

/**
 * Turn one masked element into ordinary editable elements.
 *
 * The visible colour comes from the element's own paint; the mask only decides
 * *where* it shows, so each mask shape becomes a shape in that paint with the
 * mask's brightness as its opacity.
 */
export function expandMask(input) {
	const defs = Array.isArray(input?.defs) ? input.defs : []
	const id = refIdFromUrl(input?.mask)
	if (id === '') throw Object.assign(new Error('no mask'), { code: 'no-mask' })
	const markup = defs.find((entry) => new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(String(entry)))
	if (!markup) throw Object.assign(new Error('mask definition not found'), { code: 'no-definition' })
	const node = findFirst(parseXml(markup), (candidate) => candidate.tag === 'mask' || candidate.tag === 'clipPath')
	if (!node) throw Object.assign(new Error('not a mask'), { code: 'no-definition' })

	const paint = {
		fill: typeof input.fill === 'string' && input.fill !== '' ? input.fill : 'currentColor',
		stroke: typeof input.stroke === 'string' ? input.stroke : 'none',
		opacity: typeof input.opacity === 'number' ? input.opacity : 1,
	}
	const out = []
	const visit = (current, matrix, inherited, inheritedOpacity) => {
		if (!current || current.tag === '#text') return
		const style = styleFrom(current, inherited, [])
		if (style.display === 'none' || style.visibility === 'hidden') return
		const nextMatrix = multiply(matrix, parseTransform(current.attrs.transform))
		const ownOpacity = Number.parseFloat(style.opacity ?? '1')
		const nextOpacity = inheritedOpacity * (Number.isFinite(ownOpacity) ? ownOpacity : 1)
		if (SHAPES.has(current.tag)) {
			const raw = shapePath(current)
			if (raw.trim() === '') return
			const segments = transformSegments(parsePath(raw), nextMatrix)
			const fillLevel = luminance(style.fill)
			const strokeLevel = luminance(style.stroke)
			const strokeWidth = Number.parseFloat(style.strokeWidth ?? '1')
			for (const d of splitPieces(segments)) {
				if (fillLevel > 0.002) {
					const element = { d }
					element.fill = paint.fill
					const alpha = round(paint.opacity * nextOpacity * fillLevel, 3)
					if (alpha < 0.999) element.opacity = alpha
					out.push(element)
				}
				if (strokeLevel > 0.002) {
					const element = {
						d,
						stroke: paint.fill,
						strokeWidth: Number.isFinite(strokeWidth) && strokeWidth > 0 ? round(strokeWidth, 2) : 1,
					}
					if (style.linecap && style.linecap !== 'butt') element.linecap = style.linecap
					if (style.linejoin && style.linejoin !== 'miter') element.linejoin = style.linejoin
					const alpha = round(paint.opacity * nextOpacity * strokeLevel, 3)
					if (alpha < 0.999) element.opacity = alpha
					out.push(element)
				}
			}
			return
		}
		if (CONTAINERS.has(current.tag)) {
			const faded = { ...style }
			for (const child of current.children) visit(child, nextMatrix, faded, nextOpacity)
		}
	}
	const base = { fill: '#000', stroke: 'none', strokeWidth: '1', fillRule: 'nonzero', fillOpacity: '1', strokeOpacity: '1' }
	for (const child of node.children) visit(child, IDENTITY, base, 1)
	if (out.length === 0) throw Object.assign(new Error('mask reveals nothing'), { code: 'empty-mask' })
	return out
}

/* ───────────────────────────── shapes ───────────────────────────── */

function num(value, fallback = 0) {
	const parsed = Number.parseFloat(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

export function rectPath(attrs) {
	const x = num(attrs.x)
	const y = num(attrs.y)
	const width = num(attrs.width)
	const height = num(attrs.height)
	if (width <= 0 || height <= 0) return ''
	let rx = Math.abs(num(attrs.rx, -1))
	let ry = Math.abs(num(attrs.ry, -1))
	if (attrs.rx === undefined && attrs.ry !== undefined) rx = Math.abs(num(attrs.ry))
	if (attrs.ry === undefined && attrs.rx !== undefined) ry = Math.abs(num(attrs.rx))
	if (attrs.rx === undefined && attrs.ry === undefined) {
		rx = 0
		ry = 0
	}
	rx = Math.min(rx, width / 2)
	ry = Math.min(ry, height / 2)
	if (rx < EPS || ry < EPS) {
		return `M${fmt(x)} ${fmt(y)}L${fmt(x + width)} ${fmt(y)}L${fmt(x + width)} ${fmt(y + height)}L${fmt(x)} ${fmt(y + height)}Z`
	}
	const k = 0.5522847498
	const c = (dx, dy) => `${fmt(dx * k)} ${fmt(dy * k)}`
	return [
		`M${fmt(x + rx)} ${fmt(y)}`,
		`L${fmt(x + width - rx)} ${fmt(y)}`,
		`C${c(rx, 0)} ${fmt(x + width)} ${fmt(y + ry - ry * k)} ${fmt(x + width)} ${fmt(y + ry)}`,
		`L${fmt(x + width)} ${fmt(y + height - ry)}`,
		`C${fmt(x + width)} ${fmt(y + height - ry + ry * k)} ${fmt(x + width - rx + rx * k)} ${fmt(y + height)} ${fmt(x + width - rx)} ${fmt(y + height)}`,
		`L${fmt(x + rx)} ${fmt(y + height)}`,
		`C${fmt(x + rx - rx * k)} ${fmt(y + height)} ${fmt(x)} ${fmt(y + height - ry + ry * k)} ${fmt(x)} ${fmt(y + height - ry)}`,
		`L${fmt(x)} ${fmt(y + ry)}`,
		`C${fmt(x)} ${fmt(y + ry - ry * k)} ${fmt(x + rx - rx * k)} ${fmt(y)} ${fmt(x + rx)} ${fmt(y)}`,
		'Z',
	].join('')
}

export function ellipsePath(attrs, forced = 'ellipse') {
	const cx = num(attrs.cx)
	const cy = num(attrs.cy)
	const rx = forced === 'circle' ? num(attrs.r) : num(attrs.rx)
	const ry = forced === 'circle' ? num(attrs.r) : num(attrs.ry)
	if (rx <= 0 || ry <= 0) return ''
	const k = 0.5522847498
	const ox = rx * k
	const oy = ry * k
	return [
		`M${fmt(cx - rx)} ${fmt(cy)}`,
		`C${fmt(cx - rx)} ${fmt(cy - oy)} ${fmt(cx - ox)} ${fmt(cy - ry)} ${fmt(cx)} ${fmt(cy - ry)}`,
		`C${fmt(cx + ox)} ${fmt(cy - ry)} ${fmt(cx + rx)} ${fmt(cy - oy)} ${fmt(cx + rx)} ${fmt(cy)}`,
		`C${fmt(cx + rx)} ${fmt(cy + oy)} ${fmt(cx + ox)} ${fmt(cy + ry)} ${fmt(cx)} ${fmt(cy + ry)}`,
		`C${fmt(cx - ox)} ${fmt(cy + ry)} ${fmt(cx - rx)} ${fmt(cy + oy)} ${fmt(cx - rx)} ${fmt(cy)}`,
		'Z',
	].join('')
}

export function pointsPath(raw, close) {
	const numbers = String(raw ?? '').match(/-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? []
	if (numbers.length < 4) return ''
	const parts = []
	for (let index = 0; index + 1 < numbers.length; index += 2) {
		parts.push(`${index === 0 ? 'M' : 'L'}${fmt(numbers[index])} ${fmt(numbers[index + 1])}`)
	}
	if (close) parts.push('Z')
	return parts.join('')
}

function shapePath(node) {
	const attrs = node.attrs
	switch (node.tag) {
		case 'path': return String(attrs.d ?? '')
		case 'rect': return rectPath(attrs)
		case 'circle': return ellipsePath(attrs, 'circle')
		case 'ellipse': return ellipsePath(attrs, 'ellipse')
		case 'line': return `M${fmt(num(attrs.x1))} ${fmt(num(attrs.y1))}L${fmt(num(attrs.x2))} ${fmt(num(attrs.y2))}`
		case 'polyline': return pointsPath(attrs.points, false)
		case 'polygon': return pointsPath(attrs.points, true)
		default: return ''
	}
}

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const CONTAINERS = new Set(['svg', 'g', 'symbol', 'a', 'switch'])
const GRADIENT_TAGS = new Set(['linearGradient', 'radialGradient', 'pattern'])

/* ───────────────────────────── normalise ───────────────────────────── */

export const GRAPHIC_ATTRS = [
	'fill', 'stroke', 'strokeWidth', 'linecap', 'linejoin', 'miterlimit', 'dasharray',
	'dashoffset', 'fillRule', 'fillOpacity', 'strokeOpacity', 'opacity', 'paintOrder',
]

/**
 * Normalise an SVG document into one graphic.
 *
 * @param {string} text raw SVG
 * @param {{ viewBox?: string, tint?: boolean, preserveViewBox?: boolean, name?: string }} options
 *   `viewBox` pins a canvas (editor saves); `preserveViewBox` keeps the
 *   document's declared canvas (clipboard paste); without either the art is
 *   trimmed to its content and single-colour paint becomes `currentColor`.
 * @returns {{ svg: string, elements: object[], viewBox: string, width: number, height: number, palette: string[], hash: string, warnings: string[] }}
 */
export function parseViewBox(value) {
	if (typeof value !== 'string') return null
	const parts = value.trim().split(/\s+/).map(Number)
	if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
	if (parts[2] <= 0 || parts[3] <= 0) return null
	return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
}

/**
 * Normalise an SVG document into one graphic.
 *
 * `options.viewBox` pins the canvas: an editor save supplies the canvas the
 * user is working on, so the geometry is kept exactly where it was drawn. Only
 * an import without a viewBox is trimmed to its content.
 */
export function normalizeSvg(text, options = {}) {
	if (typeof text !== 'string' || text.trim() === '') {
		throw Object.assign(new Error('empty svg'), { code: 'empty-svg' })
	}
	const doc = parseXml(text)
	const svgRoot = findFirst(doc, (node) => node.tag === 'svg')
	if (!svgRoot) throw Object.assign(new Error('no <svg> root'), { code: 'not-svg' })

	const warnings = []
	const rules = collectStyleRules(doc)
	const ids = byId(doc)
	const elements = []
	const palette = new Set()
	const defs = new Map()

	/** Resolve a mask/clip reference into its definition markup. */
	const referenceOf = (value) => {
		if (typeof value !== 'string') return { id: '', markup: '' }
		const match = /^url\(\s*#([^)\s]+)\s*\)$/.exec(value.trim())
		if (!match) return { id: '', markup: '' }
		const id = match[1]
		const node = ids.get(id)
		if (!node) return { id: '', markup: '' }
		return { id, markup: serializeNode(node) }
	}

	const inheritedBase = {
		fill: DEFAULT_FILL,
		stroke: 'none',
		strokeWidth: '1',
		linecap: 'butt',
		linejoin: 'miter',
		miterlimit: '4',
		fillRule: 'nonzero',
		fillOpacity: '1',
		strokeOpacity: '1',
	}

	const visit = (node, matrix, inherited, opacity) => {
		if (node.tag === '#text') return
		if (node.tag === 'defs' || GRADIENT_TAGS.has(node.tag) || node.tag === 'style' || node.tag === 'title' || node.tag === 'desc' || node.tag === 'metadata') return
		if (node.tag === 'script') return
		const style = styleFrom(node, inherited, rules)
		if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return
		const local = parseTransform(node.attrs.transform)
		const nextMatrix = multiply(matrix, local)
		const ownOpacity = Number.parseFloat(style.opacity ?? '1')
		const nextOpacity = opacity * clamp(Number.isFinite(ownOpacity) ? ownOpacity : 1, 0, 1)
		const childInherited = { ...style }
		delete childInherited.opacity
		delete childInherited.display
		delete childInherited.visibility
		const tag = node.tag
		if (tag === 'use') {
			const href = node.attrs.href || node.attrs['xlink:href']
			const id = typeof href === 'string' && href.startsWith('#') ? href.slice(1) : ''
			const target = id !== '' ? ids.get(id) : undefined
			if (!target) {
				warnings.push(`<use> 指向不存在的 #${id || '?'}，已跳过`)
				return
			}
			const offset = multiply(nextMatrix, translateMatrix(num(node.attrs.x), num(node.attrs.y)))
			visit(cloneNode(target), offset, childInherited, nextOpacity)
			return
		}
		if (SHAPES.has(tag)) {
			const raw = shapePath(node)
			if (raw.trim() === '') return
			let segments = parsePath(raw)
			if (segments.length === 0) return
			segments = transformSegments(segments, nextMatrix)
			const pieces = splitPieces(segments)
			const maskRef = referenceOf(node.attrs.mask)
			const clipRef = referenceOf(node.attrs['clip-path'])
			// Gradient/pattern paint: the referenced definition has to travel with
			// the path, otherwise `fill="url(#…)"` renders as nothing.
			const paintRefs = []
			for (const value of [style.fill, style.stroke]) {
				const ref = referenceOf(value)
				if (ref.id !== '' && GRADIENT_TAGS.has((ids.get(ref.id) || {}).tag)) paintRefs.push(ref)
			}
			for (const d of pieces) {
				if (d.replace(/[MLCQZ0-9.\-\s]/g, '') !== '') continue
				const element = paintOf(style, palette)
				if (!element) continue
				element.d = d
				if (maskRef.id) {
					element.mask = `url(#${maskRef.id})`
					defs.set(maskRef.id, maskRef.markup)
				}
				if (clipRef.id) {
					element.clipPath = `url(#${clipRef.id})`
					defs.set(clipRef.id, clipRef.markup)
				}
				for (const ref of paintRefs) {
					defs.set(ref.id, ref.markup)
					// gradients may inherit stops from another definition
					for (const nested of [...ref.markup.matchAll(/url\(\s*#([^)\s]+)\s*\)|href="#([^"]+)"/g)]) {
						const nestedId = nested[1] || nested[2]
						const nestedNode = nestedId ? ids.get(nestedId) : null
						if (nestedNode) defs.set(nestedId, serializeNode(nestedNode))
					}
					const list = Array.isArray(element.defs) ? element.defs.slice() : []
					if (!list.includes(ref.markup)) list.push(ref.markup)
					element.defs = list
				}
				if (nextOpacity < 0.999) element.opacity = round(nextOpacity, 4)
				elements.push(element)
			}
			return
		}
		if (CONTAINERS.has(tag)) {
			if (node.tag === 'svg' && node !== svgRoot) {
				// nested svg: honour its viewport offset
				const at = multiply(nextMatrix, translateMatrix(num(node.attrs.x), num(node.attrs.y)))
				for (const child of node.children) visit(child, at, childInherited, nextOpacity)
				return
			}
			for (const child of node.children) visit(child, nextMatrix, childInherited, nextOpacity)
			return
		}
		if (tag === 'text' || tag === 'tspan' || tag === 'textPath') {
			if (!warnings.includes('文本已跳过（SVG 文本无法作为可编辑路径）')) warnings.push('文本已跳过（SVG 文本无法作为可编辑路径）')
			return
		}
		if (tag === 'image') {
			if (!warnings.includes('位图已跳过（图标库只存矢量）')) warnings.push('位图已跳过（图标库只存矢量）')
			return
		}
		if (tag === 'clipPath' || tag === 'mask' || tag === 'filter') {
			warnings.push(`<${tag}> 已忽略，裁切/滤镜不会写进源文件`)
			return
		}
	}

	// A root `fill="none"` (our own serialiser, or Figma exports) is inherited by
	// every child, so read it instead of assuming the SVG default of black.
	const rootStyle = styleFrom(svgRoot, inheritedBase, rules)
	const rootInherited = { ...rootStyle }
	delete rootInherited.opacity
	delete rootInherited.display
	delete rootInherited.visibility
	const rootOpacity = Number.parseFloat(rootStyle.opacity ?? '1')
	for (const child of svgRoot.children) {
		visit(child, IDENTITY, rootInherited, Number.isFinite(rootOpacity) ? clamp(rootOpacity, 0, 1) : 1)
	}

	if (elements.length === 0) {
		throw Object.assign(new Error('no drawable elements'), { code: 'empty-graphic' })
	}

	// An icon must follow the text colour, but a multi-colour mark must not be
	// flattened into one tint, so only single-colour art becomes currentColor.
	// A single-colour mark should follow the text colour; a multi-colour one
	// must keep its paint. Editor saves pin a canvas and keep explicit colours.
	const tint = options.tint === undefined ? options.viewBox === undefined : options.tint === true
	const alreadyTinted = elements.some((element) => element.fill === 'currentColor' || element.stroke === 'currentColor')
	if (tint && palette.size <= 1 && !alreadyTinted) {
		for (const element of elements) {
			if (isConcreteColor(element.fill)) element.fill = 'currentColor'
			if (isConcreteColor(element.stroke)) element.stroke = 'currentColor'
		}
	}

	// trim to content
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const element of elements) {
		const box = pathBBox(element.d)
		if (!box) continue
		minX = Math.min(minX, box.x)
		minY = Math.min(minY, box.y)
		maxX = Math.max(maxX, box.x + box.width)
		maxY = Math.max(maxY, box.y + box.height)
	}
	if (!Number.isFinite(minX)) throw Object.assign(new Error('no drawable elements'), { code: 'empty-graphic' })

	let pinned = parseViewBox(options.viewBox)
	if (!pinned && options.preserveViewBox === true) {
		// Pasting authored art should keep the canvas it was drawn on: honour the
		// declared viewBox, else width/height, instead of re-trimming to content.
		pinned = parseViewBox(svgRoot.attrs.viewBox)
		if (!pinned) {
			const declaredWidth = Number.parseFloat(svgRoot.attrs.width)
			const declaredHeight = Number.parseFloat(svgRoot.attrs.height)
			if (Number.isFinite(declaredWidth) && declaredWidth > 0 && Number.isFinite(declaredHeight) && declaredHeight > 0) {
				pinned = { x: 0, y: 0, width: declaredWidth, height: declaredHeight }
			}
		}
	}
	let width
	let height
	let viewBox
	if (pinned) {
		// Canvas is part of the artwork: keep the coordinates the user drew.
		width = pinned.width
		height = pinned.height
		viewBox = `${fmt(pinned.x)} ${fmt(pinned.y)} ${fmt(width)} ${fmt(height)}`
	} else {
		// A bbox measured on centre lines would clip half of every stroke, so pad
		// by the widest half-stroke before trimming.
		let strokePad = 0
		for (const element of elements) {
			if (!element.stroke) continue
			strokePad = Math.max(strokePad, (element.strokeWidth ?? 1) / 2)
		}
		if (strokePad > 0) {
			minX -= strokePad
			minY -= strokePad
			maxX += strokePad
			maxY += strokePad
		}

		let boxWidth = maxX - minX
		let boxHeight = maxY - minY
		// Icon canvases are square: pad the shorter side so the art keeps its
		// optical size on the 24 grid instead of stretching to fill.
		const side = Math.max(boxWidth, boxHeight)
		let offsetX = -minX + (side - boxWidth) / 2
		let offsetY = -minY + (side - boxHeight) / 2
		boxWidth = side
		boxHeight = side
		offsetX = round(offsetX, 4)
		offsetY = round(offsetY, 4)
		const matrix = translateMatrix(offsetX, offsetY)
		for (const element of elements) {
			element.d = transformPath(element.d, matrix)
		}
		const ceil2 = (value) => Math.ceil(value * 100) / 100
		width = Math.max(1, ceil2(boxWidth))
		height = Math.max(1, ceil2(boxHeight))
		viewBox = `0 0 ${fmt(width)} ${fmt(height)}`
	}

	const cleaned = elements
		.map((element) => ({ ...element, d: segmentsToString(parsePath(element.d)) }))
		.filter((element) => element.d.trim() !== '' && /\d/.test(element.d))

	const graphic = {
		elements: cleaned,
		defs: [...defs.values()],
		viewBox,
		width,
		height,
		palette: [...palette].sort(),
		warnings,
	}
	graphic.svg = serializeGraphic(graphic)
	graphic.hash = hashGraphic(cleaned, [...palette], [...defs.values()], viewBox)
	return graphic
}

function clamp(value, min, max) {
	if (!Number.isFinite(value)) return max
	return Math.min(max, Math.max(min, value))
}

function paintOf(style, palette) {
	const fillRaw = canonicalColor(style.fill ?? DEFAULT_FILL)
	const strokeRaw = canonicalColor(style.stroke ?? 'none')
	const fill = fillRaw ?? 'none'
	const stroke = strokeRaw ?? 'none'
	if ((fill === 'none' || fill === 'transparent') && (stroke === 'none' || stroke === 'transparent')) return null
	// Paint stays as authored here; icons are tinted after the walk, and only
	// when the asset turns out to be single-colour (a multi-colour mark keeps
	// its colours and records a palette).
	if (isConcreteColor(fill)) palette.add(fill)
	if (isConcreteColor(stroke)) palette.add(stroke)
	const element = {}
	if (fill !== 'none') element.fill = fill
	if (stroke !== 'none') {
		element.stroke = stroke
		const width = Number.parseFloat(style.strokeWidth ?? '1')
		if (Number.isFinite(width) && Math.abs(width - 1) > EPS) element.strokeWidth = round(width, 3)
		const cap = style.linecap
		if (cap && cap !== 'butt') element.linecap = cap
		const join = style.linejoin
		if (join && join !== 'miter') element.linejoin = join
		const dash = style.dasharray
		if (dash && dash !== 'none') element.dasharray = dash
	}
	const fillRule = style.fillRule
	if (element.fill && fillRule === 'evenodd') element.fillRule = 'evenodd'
	const fillOpacity = Number.parseFloat(style.fillOpacity ?? '1')
	if (element.fill && Number.isFinite(fillOpacity) && fillOpacity < 1) element.fillOpacity = round(fillOpacity, 3)
	const strokeOpacity = Number.parseFloat(style.strokeOpacity ?? '1')
	if (element.stroke && Number.isFinite(strokeOpacity) && strokeOpacity < 1) element.strokeOpacity = round(strokeOpacity, 3)
	return element
}

function cloneNode(node, parent = null) {
	const copy = { tag: node.tag, attrs: { ...node.attrs }, children: [], parent }
	copy.children = node.children.map((child) => {
		if (child.tag === '#text') return { tag: '#text', text: child.text, attrs: {}, children: [], parent: copy }
		return cloneNode(child, copy)
	})
	return copy
}

function findFirst(nodes, predicate) {
	for (const node of nodes) {
		if (node.tag === '#text') continue
		if (predicate(node)) return node
		const found = findFirst(node.children, predicate)
		if (found) return found
	}
	return null
}

/* ───────────────────────────── serialise ───────────────────────────── */

function serializeNode(node) {
	if (!node || node.tag === '#text') return ''
	const attrs = Object.entries(node.attrs || {})
		.filter(([key]) => key !== 'style' && key !== 'class' && key !== 'transform')
		.map(([key, value]) => `${key}="${esc(value)}"`)
	const inner = (node.children || []).map((child) => serializeNode(child)).join('')
	const open = `<${node.tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}`
	if (inner === '') return `${open}/>`
	return `${open}>${inner}</${node.tag}>`
}

function esc(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Every `id="…"` declared in a piece of SVG markup. */
export function svgIds(text) {
	const ids = new Set()
	for (const match of String(text ?? '').matchAll(/\sid="([^"]+)"/g)) ids.add(match[1])
	return ids
}

/**
 * Prefix every id in a document with a stable slug so two graphics can never
 * share a gradient name when they are inlined into the same page.
 */
export function scopeSvgIds(text, slug) {
	const safe = String(slug ?? '').replace(/[^a-zA-Z0-9_-]/g, '-')
	if (safe === '') return String(text ?? '')
	let out = String(text ?? '')
	for (const id of svgIds(out)) {
		if (id.startsWith(`${safe}-`)) continue
		const next = `${safe}-${id}`
		out = out.split(`id="${id}"`).join(`id="${next}"`)
			.split(`url(#${id})`).join(`url(#${next})`)
			.split(`href="#${id}"`).join(`href="#${next}"`)
	}
	return out
}

export function elementToString(element, indent = '  ') {
	const attrs = [`d="${esc(element.d)}"`]
	if (element.fill) attrs.push(`fill="${esc(element.fill)}"`)
	if (element.stroke) {
		attrs.push(`stroke="${esc(element.stroke)}"`)
		attrs.push(`stroke-width="${fmt(element.strokeWidth ?? 1)}"`)
		if (element.linecap) attrs.push(`stroke-linecap="${esc(element.linecap)}"`)
		if (element.linejoin) attrs.push(`stroke-linejoin="${esc(element.linejoin)}"`)
		if (element.dasharray) attrs.push(`stroke-dasharray="${esc(element.dasharray)}"`)
		if (element.strokeOpacity !== undefined) attrs.push(`stroke-opacity="${fmt(element.strokeOpacity)}"`)
	}
	if (element.fillRule === 'evenodd') attrs.push('fill-rule="evenodd"')
	if (element.fillOpacity !== undefined) attrs.push(`fill-opacity="${fmt(element.fillOpacity)}"`)
	if (element.opacity !== undefined) attrs.push(`opacity="${fmt(element.opacity)}"`)
	if (element.mask) attrs.push(`mask="${esc(element.mask)}"`)
	if (element.clipPath) attrs.push(`clip-path="${esc(element.clipPath)}"`)
	return `${indent}<path ${attrs.join(' ')}/>`
}

export function serializeGraphic(graphic) {
	const { viewBox, elements } = graphic
	const [, , rawWidth, rawHeight] = String(viewBox).split(/\s+/).map(Number)
	const width = Number.isFinite(rawWidth) ? rawWidth : graphic.width
	const height = Number.isFinite(rawHeight) ? rawHeight : graphic.height
	const defs = Array.isArray(graphic.defs) ? graphic.defs.filter((entry) => typeof entry === 'string' && entry !== '') : []
	const lines = [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${fmt(width)}" height="${fmt(height)}" fill="none">`,
		...(defs.length > 0 ? [`  <defs>${defs.join('')}</defs>`] : []),
		...elements.map((element) => elementToString(element)),
		'</svg>',
	]
	return `${lines.join('\n')}\n`
}

function defsSignature(defs) {
	if (!Array.isArray(defs) || defs.length === 0) return ''
	return [...new Set(defs.map((markup) => String(markup).replace(/id="[^"]*"/g, '').replace(/url\(#[^)]*\)/g, 'url(#)')))]
		.sort()
		.join('')
}

export function hashGraphic(elements, palette = [], defs = [], viewBox = '') {
	const canonical = elements
		.map((element) => {
			const paint = [
				element.fill ?? '',
				element.stroke ?? '',
				element.strokeWidth ?? '',
				element.fillRule ?? '',
				element.opacity ?? '',
			].join('|')
			return `${element.d}@${paint}`
		})
		.join('\n')
	// The authored palette survives tinting, so a black and a grey single-colour
	// graphic stay distinct even though both serialise as currentColor.
	// The blob contains the frame too, so the content address must cover it:
	// two identical drawings in different canvases are different files.
	const signature = `${canonical}|palette:${[...palette].sort().join(',')}|defs:${defsSignature(defs)}|vb:${viewBox}`
	return `sha256:${createHash('sha256').update(signature).digest('hex')}`
}

/**
 * IconifyIcon stores flips/rotation instead of redrawing: bake them into a
 * wrapper group so the saved body is the final picture.
 */
export function bakeIconifyTransform(body, width, height, options = {}) {
	const left = Number(options.left) || 0
	const top = Number(options.top) || 0
	const parts = []
	if (options.hFlip) parts.push(`translate(${2 * left + width} 0)`)
	if (options.vFlip) parts.push(`translate(0 ${2 * top + height})`)
	if (options.hFlip || options.vFlip) parts.push(`scale(${options.hFlip ? -1 : 1} ${options.vFlip ? -1 : 1})`)
	const rotate = Number(options.rotate)
	if (rotate) parts.push(`rotate(${rotate} ${left + width / 2} ${top + height / 2})`)
	if (parts.length === 0) return body
	return `<g transform="${parts.join(' ')}">${body}</g>`
}

/** Serialise a node exactly as authored (attributes and transforms kept). */
function serializeRaw(node) {
	if (!node) return ''
	if (node.tag === '#text') return String(node.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	if (node.tag === '#comment') return ''
	const attrs = Object.entries(node.attrs || {}).map(([key, value]) => `${key}="${esc(value)}"`)
	const inner = (node.children || []).map((child) => serializeRaw(child)).join('')
	const open = `<${node.tag}${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}`
	if (inner === '') return `${open}/>`
	return `${open}>${inner}</${node.tag}>`
}

/**
 * IconifyIcon-style storage: keep the authored markup verbatim and only pin the
 * canvas. Nothing is flattened, so `<defs>`, gradients, `<mask>`, `<clipPath>`,
 * filters and `<g>` transforms survive exactly as written.
 */
export function preserveSvg(text, options = {}) {
	const source = String(text ?? '')
	const root = findFirst(parseXml(source), (node) => node.tag === 'svg')
	if (!root) throw Object.assign(new Error('no svg root'), { code: 'invalid-svg' })
	let viewBox = typeof root.attrs.viewBox === 'string' ? root.attrs.viewBox.trim() : ''
	const fallback = viewBox === '' ? normalizeSvg(source, { viewBox: options.viewBox }) : null
	if (viewBox === '') viewBox = fallback ? fallback.viewBox : (options.viewBox || '0 0 24 24')
	const parts = viewBox.split(/[\s,]+/u).map((value) => Number(value))
	const width = Number.isFinite(parts[2]) ? parts[2] : 0
	const height = Number.isFinite(parts[3]) ? parts[3] : 0
	const paint = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'opacity']
		.filter((key, index, list) => list.indexOf(key) === index && typeof root.attrs[key] === 'string' && root.attrs[key] !== '')
	let body = (root.children || []).map((child) => serializeRaw(child)).join('')
	if (paint.length > 0) {
		const attrs = paint.map((key) => `${key}="${esc(root.attrs[key])}"`).join(' ')
		body = `<g ${attrs}>${body}</g>`
	}
	const outer = paint.map((key) => ` ${key}="${esc(root.attrs[key])}"`).join('')
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${outer}>${body}</svg>`
	const canonical = body.replace(/>\s+</gu, '><').replace(/\s+/gu, ' ').trim()
	const hash = `sha256:${createHash('sha256').update(`markup:${canonical}|vb:${viewBox}`).digest('hex')}`
	return { svg, body, viewBox, width, height, hash, warnings: [] }
}

/** Turn an element list (as the editor sends it) into a clean graphic. */
export function normalizeElements(elements, options = {}) {
	if (!Array.isArray(elements) || elements.length === 0) {
		throw Object.assign(new Error('no elements'), { code: 'empty-graphic' })
	}
	const flat = []
	const elementDefs = []
	for (const element of elements) {
		if (Array.isArray(element.defs)) elementDefs.push(...element.defs)
		const d = typeof element.d === 'string' ? element.d : ''
		if (d.trim() === '') continue
		// One element per edited shape: compound paths are split later, and only
		// when their subpaths are disjoint (see normalizeSvg).
		const segments = transformSegments(parsePath(d), Array.isArray(element.m) && element.m.length === 6 ? element.m : IDENTITY)
		const copy = { ...element, d: segmentsToString(segments) }
		delete copy.m
		delete copy.id
		delete copy.name
		flat.push(copy)
	}
	if (flat.length === 0) throw Object.assign(new Error('no elements'), { code: 'empty-graphic' })
	return normalizeSvg(
		serializeGraphic({ viewBox: options.viewBox ?? '0 0 100 100', width: 100, height: 100, elements: flat, defs: [...new Set(elementDefs)] }),
		{ name: options.name, viewBox: options.viewBox, tint: options.tint },
	)
}

export function emptySvg(width, height) {
	const w = Math.max(1, Math.round(Number(width) || 24))
	const h = Math.max(1, Math.round(Number(height) || 24))
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none">\n</svg>\n`
}

/** Parse clean svg text back into editor elements (identity matrices). */
export function elementsFromSvg(text) {
	const doc = parseXml(text)
	const svgRoot = findFirst(doc, (node) => node.tag === 'svg')
	if (!svgRoot) return { elements: [], viewBox: '0 0 24 24' }
	const elements = []
	const defs = new Map()
	const defsRoot = findFirst(doc, (node) => node.tag === 'defs')
	if (defsRoot) {
		for (const child of defsRoot.children) {
			if (child.tag !== 'mask' && child.tag !== 'clipPath' && !GRADIENT_TAGS.has(child.tag) && child.tag !== 'pattern') continue
			const id = typeof child.attrs.id === 'string' ? child.attrs.id : ''
			if (id !== '') defs.set(id, serializeNode(child))
		}
	}
	const refId = (value) => {
		if (typeof value !== 'string') return ''
		const match = /^url\(\s*#([^)\s]+)\s*\)$/.exec(value.trim())
		return match ? match[1] : ''
	}
	const visit = (node, matrix, inherited) => {
		if (node.tag === '#text') return
		if (node.tag === 'style' || node.tag === 'defs' || node.tag === 'title' || node.tag === 'desc') return
		const style = styleFrom(node, inherited, [])
		const local = parseTransform(node.attrs.transform)
		const nextMatrix = multiply(matrix, local)
		if (SHAPES.has(node.tag)) {
			const raw = shapePath(node)
			if (!raw.trim()) return
			const segments = transformSegments(parsePath(raw), nextMatrix)
			const maskId = refId(node.attrs.mask)
			const clipId = refId(node.attrs['clip-path'])
			for (const piece of splitPieces(segments)) {
				const element = paintOf(style, new Set())
				if (!element) continue
				element.d = piece
				const carried = []
				if (maskId !== '' && defs.has(maskId)) {
					element.mask = `url(#${maskId})`
					carried.push(defs.get(maskId))
				}
				if (clipId !== '' && defs.has(clipId)) {
					element.clipPath = `url(#${clipId})`
					carried.push(defs.get(clipId))
				}
				// paint references: a gradient stays with the path that fills with it
				for (const value of [element.fill, element.stroke]) {
					const id = refId(value)
					if (id === '' || !defs.has(id)) continue
					const markup = defs.get(id)
					if (!carried.includes(markup)) carried.push(markup)
					for (const nested of [...markup.matchAll(/url\(\s*#([^)\s]+)\s*\)|href="#([^"]+)"/g)]) {
						const nestedId = nested[1] || nested[2]
						if (nestedId && defs.has(nestedId) && !carried.includes(defs.get(nestedId))) carried.push(defs.get(nestedId))
					}
				}
				if (carried.length > 0) element.defs = carried
				elements.push(element)
			}
			return
		}
		if (CONTAINERS.has(node.tag)) {
			for (const child of node.children) visit(child, nextMatrix, style)
		}
	}
	const base = {
		fill: DEFAULT_FILL, stroke: 'none', strokeWidth: '1', linecap: 'butt', linejoin: 'miter',
		fillRule: 'nonzero', fillOpacity: '1', strokeOpacity: '1',
	}
	const rootStyle = styleFrom(svgRoot, base, [])
	delete rootStyle.opacity
	delete rootStyle.display
	delete rootStyle.visibility
	for (const child of svgRoot.children) visit(child, IDENTITY, rootStyle)
	const viewBox = typeof svgRoot.attrs.viewBox === 'string' ? svgRoot.attrs.viewBox : '0 0 24 24'
	return { elements, viewBox }
}
