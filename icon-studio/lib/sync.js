/**
 * Source ↔ code drift.
 *
 * The library is the source of truth; project code carries copies of an icon
 * inside `@asset <name>` blocks. This module compares those copies against the
 * library version, so the panel can show a real diff (and push it in one step).
 */
import { scanUsage, applyAsset, walkProject, scanPathCopies } from './assets.js'
import { LIB_DIR } from './store.js'
import { parsePath, round } from './svg.js'
import { signature, bodySignature, isIconCandidate, svgBlocks, jsxSvgBlocks, markupBlocks, pathLiterals, quotedRanges, splitSvg, canonSubpaths, canonicalD } from './shape.js'

export { signature, bodySignature, svgBlocks, splitSvg } from './shape.js'

/**
 * A copy can be written as JSX (`h('svg', {…}, h('path', { d: '…' }))`) instead of
 * raw markup. That form has no `<svg>` string to slice, so the geometry is lifted
 * out of the attribute objects instead.
 */
/** Files scanned for icon shapes, and the folders that never ship UI. */
const UI_SOURCE = /\.(?:tsx?|jsx?|vue|svelte|astro|html|svg)$/iu
const NON_UI_SEGMENT = /^(?:test|tests|fixtures|mocks|stories|docs)$/iu

export function isUiSource(file) {
	const normalized = String(file || '').replace(/\\/gu, '/')
	if (normalized === '' || !UI_SOURCE.test(normalized)) return false
	const parts = normalized.split('/')
	const base = parts[parts.length - 1] || ''
	if (/\.(?:test|spec|stories)\.[^/]+$/iu.test(base)) return false
	return !parts.slice(0, -1).some((segment) => NON_UI_SEGMENT.test(segment))
}


/**
 * Find every place in the workspace that already draws this exact shape.
 *
 * A paste usually comes *from* the project: the user copied a glyph out of a
 * component or a loose .svg file. Matching by `signature()` (geometry, not
 * bytes) links the library entry to those sites, so later edits can be pushed
 * back without asking the user to tag anything.
 */
export async function findShapePointers(io, svg, { exclude = [], stats = null } = {}) {
	const wanted = bodySignature(svg)
	if (wanted === '') return []
	const files = []
	try {
		await walkProject(io, '', files, { files: 0 }, [...exclude, LIB_DIR])
	} catch (_error) {
		return []
	}
	if (stats) stats.files = files.length
	const pointers = []
	for (const file of files) {
		if (!isUiSource(file)) continue
		let text = null
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null) continue
		if (!text.includes('<svg') && !/h\(\s*['"]svg['"]/u.test(text) && !/\bmarkup\s*:/u.test(text) && !/['"`][Mm][^'"`\n]{12,}Z['"`]/u.test(text)) continue
		if (file.toLowerCase().endsWith('.svg')) {
			if (bodySignature(text) === wanted) pointers.push({ file, kind: 'file', index: 0, line: 1 })
			continue
		}
		const strings = quotedRanges(text)
		const blocks = svgBlocks(text).filter((block) => !strings.some((range) => block.start >= range.start && block.start < range.end))
		for (let index = 0; index < blocks.length; index += 1) {
			if (bodySignature(blocks[index].text) !== wanted) continue
			const line = text.slice(0, blocks[index].start).split('\n').length
			pointers.push({ file, kind: 'inline', index, line })
		}
		// React code writes h('svg', …), not raw markup. Same icon, other syntax.
		const jsxCalls = jsxSvgBlocks(text)
		for (let index = 0; index < jsxCalls.length; index += 1) {
			if (bodySignature(jsxCalls[index].text) !== wanted) continue
			// A shape whose path is a shared constant is rewritten once at the
			// constant (kind 'path' below), not once per component using it.
			if (jsxCalls[index].dSites.length > 0 && jsxCalls[index].dSites.every((site) => site.shared)) continue
			const line = text.slice(0, jsxCalls[index].start).split('\n').length
			pointers.push({ file, kind: 'jsx', index, line })
		}
		// `{ viewBox, markup }` constants (this plugin's own marks).
		const marks = markupBlocks(text)
		for (let index = 0; index < marks.length; index += 1) {
			if (bodySignature(marks[index].text) !== wanted) continue
			const line = text.slice(0, marks[index].start).split('\n').length
			pointers.push({ file, kind: 'markup', index, line })
		}
		// Shared path constants: `const P = 'M…Z'` used by one or many components.
		const iconPaths = [...String(svg).matchAll(/\bd="([^"]+)"/gu)].map((item) => canonicalD(item[1]))
		if (iconPaths.length > 0) {
			// A path string inside an <svg> block, a JSX call or a markup constant is
			// already counted by that block; do not count the same site twice.
			const covered = [...blocks, ...jsxCalls, ...marks]
			// A quoted string that contains a whole `<svg>` document is a second
			// storage form of a mark, not another place the icon is used.
			const documents = strings.filter((range) => /<svg[\s>]/u.test(text.slice(range.start, range.end)))
			for (const literal of pathLiterals(text)) {
				if (covered.some((block) => literal.start >= block.start && literal.start < block.end)) continue
				if (documents.some((range) => literal.start >= range.start && literal.start < range.end)) continue
				const index = iconPaths.indexOf(canonicalD(literal.value))
				if (index === -1) continue
				const line = text.slice(0, literal.start).split('\n').length
				pointers.push({ file, kind: 'path', index, line, literal: literal.literal })
			}
		}
	}
	return pointers
}

/** Rewrite every recorded pointer with the icon's current artwork. */
export async function pushShapePointers(io, svg, pointers = []) {
	const byFile = new Map()
	for (const pointer of pointers) {
		if (!pointer || typeof pointer.file !== 'string') continue
		if (!byFile.has(pointer.file)) byFile.set(pointer.file, [])
		byFile.get(pointer.file).push(pointer)
	}
	let rewritten = 0
	const files = []
	for (const [file, list] of byFile) {
		if (!isUiSource(file) && !file.toLowerCase().endsWith('.svg')) continue
		let text = null
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null) continue
		const source = splitSvg(svg)
		const inner = source ? source.inner : svg
		// Only the inner code is ours; `viewBox`/`width`/`height` stay as the site
		// wrote them, so replacing a drawing never resizes anybody's canvas.
		const rewrite = (target) => {
			const parts = splitSvg(target)
			return parts ? `${parts.open}${inner}${parts.close}` : target
		}
		if (list.some((pointer) => pointer.kind === 'file')) {
			const target = splitSvg(text)
			if (target && source && target.inner.trim() === inner.trim()) continue
			const nextText = rewrite(text)
			if (nextText === text) continue
			await io.writeText(file, nextText)
			rewritten += 1
			files.push(file)
			continue
		}
		const jsxTargets = list.filter((pointer) => pointer.kind === 'jsx')
		if (jsxTargets.length > 0) {
			const calls = jsxSvgBlocks(text)
			const sourceDs = [...String(svg).matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1].replace(/\s*[\r\n]+\s*/gu, ' '))
			let next = text
			// Right to left, so every earlier offset stays valid while rewriting.
			for (const pointer of [...jsxTargets].sort((left, right) => (calls[right.index]?.start ?? -1) - (calls[left.index]?.start ?? -1))) {
				const block = calls[pointer.index]
				if (!block) continue
				const edits = block.dSites
					.map((site, index) => ({ site, index }))
					.filter(({ site }) => !site.shared)
					.sort((left, right) => right.site.start - left.site.start)
				for (const { site, index } of edits) {
					const replacement = sourceDs[index]
					if (typeof replacement !== 'string') continue
					next = `${next.slice(0, site.start)}${replacement}${next.slice(site.end)}`
					rewritten += 1
				}
			}
			// Shared path constants live outside the JSX call: one literal, one edit.
			for (const pointer of list.filter((item) => item.kind === 'path')) {
				const replacement = sourceDs[pointer.index]
				if (typeof replacement !== 'string' || replacement === '') continue
				if (typeof pointer.literal !== 'string' || !next.includes(pointer.literal)) continue
				next = next.split(pointer.literal).join(replacement)
				rewritten += 1
			}
			if (next !== text) {
				await io.writeText(file, next)
				files.push(file)
			}
			continue
		}
		const pathTargets = list.filter((pointer) => pointer.kind === 'path')
		if (pathTargets.length > 0) {
			const sourceDs = [...String(svg).matchAll(/\bd="([^"]+)"/gu)].map((match) => match[1].replace(/\s*[\r\n]+\s*/gu, ' '))
			let next = text
			for (const pointer of pathTargets) {
				const replacement = sourceDs[pointer.index]
				if (typeof replacement !== 'string' || replacement === '') continue
				if (typeof pointer.literal !== 'string' || !next.includes(pointer.literal)) continue
				next = next.split(pointer.literal).join(replacement)
				rewritten += 1
			}
			if (next !== text) {
				await io.writeText(file, next)
				files.push(file)
			}
			continue
		}
		const markupTargets = list.filter((pointer) => pointer.kind === 'markup')
		if (markupTargets.length > 0) {
			const marks = markupBlocks(text)
			const parts = splitSvg(svg)
			// A JS string literal cannot contain a raw newline: collapse the blob's
			// pretty-printed inner markup to one line before escaping it.
			let inner = (parts ? parts.inner : svg).trim().replace(/\s*[\r\n]+\s*/gu, ' ')
			// A `{ viewBox, markup }` constant has no root <svg>, so paint that lived
			// on the root (usually fill="none" for stroke-only icons) must travel
			// with the elements, or the written copy stops matching the icon.
			const rootFill = /<svg\b[^>]*\bfill="([^"]*)"/u.exec(String(svg))?.[1] ?? ''
			if (rootFill === 'none') {
				inner = inner.replace(/<(path|circle|rect|line|polygon|polyline|ellipse)\b(?![^>]*\bfill=)/gu, `<$1 fill="none"`)
			}
			let next = text
			for (const pointer of [...markupTargets].sort((left, right) => (marks[right.index]?.innerStart ?? -1) - (marks[left.index]?.innerStart ?? -1))) {
				const block = marks[pointer.index]
				if (!block) continue
				const escaped = inner.replace(/\\/gu, '\\\\').replace(new RegExp(block.quote, 'gu'), `\\${block.quote}`)
				next = `${next.slice(0, block.innerStart)}${escaped}${next.slice(block.innerEnd)}`
				rewritten += 1
			}
			if (next !== text) {
				await io.writeText(file, next)
				files.push(file)
			}
			continue
		}
		const blocks = svgBlocks(text)
		let next = text
		// Descending order keeps the offsets of untouched blocks valid.
		for (const pointer of [...list].sort((left, right) => right.index - left.index)) {
			const block = blocks[pointer.index]
			if (!block) continue
			next = `${next.slice(0, block.start)}${rewrite(block.text)}${next.slice(block.end)}`
			rewritten += 1
		}
		if (next !== text) {
			await io.writeText(file, next)
			files.push(file)
		}
	}
	return { rewritten, files }
}

/**
 * Inventory of every distinct shape already drawn in shipped UI code.
 *
 * Import is the other half of the library: a project usually has its icons
 * inline before the library exists. One group = one distinct shape; the sites
 * are where it appears, so importing a group immediately links its copies.
 */
export async function scanCodeShapes(io, { exclude = [] } = {}) {
	const files = []
	try {
		await walkProject(io, '', files, { files: 0 }, [...exclude, LIB_DIR])
	} catch (_error) {
		return []
	}
	const groups = new Map()
	for (const file of files) {
		if (!isUiSource(file)) continue
		let text = null
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null) continue
		if (!text.includes('<svg') && !/h\(\s*['"]svg['"]/u.test(text) && !/\bmarkup\s*:/u.test(text) && !/['"`][Mm][^'"`\n]{12,}Z['"`]/u.test(text)) continue
		const isFile = file.toLowerCase().endsWith('.svg')
		const blocks = isFile ? [{ start: 0, end: text.length, text, kind: 'file' }] : [
			...svgBlocks(text).map((block) => ({ ...block, kind: 'inline' })),
			...jsxSvgBlocks(text).map((block) => ({ ...block, kind: 'jsx' })),
			...markupBlocks(text).map((block) => ({ ...block, kind: 'markup' })),
		]
		for (let index = 0; index < blocks.length; index += 1) {
			const block = blocks[index]
			if (!isIconCandidate(block.text)) continue
			const sig = bodySignature(block.text)
			if (sig === '') continue
			let group = groups.get(sig)
			if (!group) {
				group = {
					signature: sig,
					svg: block.text,
					viewBox: /viewBox="([^"]+)"/u.exec(block.text)?.[1] ?? '0 0 24 24',
					sites: [],
				}
				groups.set(sig, group)
			}
			group.sites.push({
				file,
				kind: blocks[index].kind || (isFile ? 'file' : 'inline'),
				index,
				line: text.slice(0, block.start).split('\n').length,
			})
		}
	}
	return [...groups.values()].sort((left, right) => right.sites.length - left.sites.length)
}
