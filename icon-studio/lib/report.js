/**
 * One pass over a workspace: where every icon is used, and what cannot be read.
 *
 * `sync.js` answers "where is *this* icon?" by walking the project once per
 * entry — right for an import or a push, wrong for a report over a whole
 * library. This module walks once, signs every drawing it finds, and matches
 * against a signature table instead.
 *
 * It is deliberately read-only. Findings are counted, never repaired: repairing
 * is the panel's job, where the user can see a diff and uncheck a site.
 */
import { walkProject, SCAN_FILE } from './assets.js'
import { LIB_DIR } from './store.js'
import { shapeSignature, isIconCandidate, svgBlocks, jsxSvgBlocks, markupBlocks, pathLiterals, quotedRanges } from './shape.js'
import { dataUriBlocks } from './datauri.js'
import { decodedShapeSignature, isStyleSource } from './sync.js'

/** Kinds a site can take, in the order a report should list them. */
export const SITE_KINDS = ['inline', 'jsx', 'markup', 'path', 'datauri', 'file']

function lineOf(text, at) {
	return text.slice(0, at).split('\n').length
}

/**
 * Every drawing in the workspace, signed and located.
 *
 * `exclude` takes workspace-relative prefixes; `LIB_DIR` is always excluded so
 * the library never counts its own artwork as a use.
 */
export async function scanSites(io, { exclude = [], maxFiles = 4000 } = {}) {
	const files = []
	try {
		await walkProject(io, '', files, { files: 0 }, [...exclude, LIB_DIR], SCAN_FILE)
	} catch (_error) {
		return { files: [], scanned: { total: 0, ui: 0, style: 0 }, sites: [], raster: [] }
	}
	const sites = []
	const raster = []
	let ui = 0
	let style = 0
	for (const file of files) {
		const isStyle = isStyleSource(file)
		if (isStyle) style += 1
		else ui += 1
		let text = null
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null) continue
		const isFile = file.toLowerCase().endsWith('.svg')
		if (isFile) {
			sites.push({ file, kind: 'file', index: 0, line: 1, signature: shapeSignature(text), text, candidate: isIconCandidate(text) })
			continue
		}
		const uris = dataUriBlocks(text)
		for (let index = 0; index < uris.length; index += 1) {
			const uri = uris[index]
			if (uri.raster) {
				raster.push({ file, line: lineOf(text, uri.start), mime: uri.mime, bytes: uri.blob.length })
				continue
			}
			if (!uri.vector) continue
			sites.push({
				file,
				kind: 'datauri',
				index,
				line: lineOf(text, uri.start),
				signature: decodedShapeSignature(uri.text),
				text: uri.text,
				candidate: isIconCandidate(uri.text),
			})
		}
		if (isStyle) continue
		const strings = quotedRanges(text)
		const blocks = svgBlocks(text).filter((block) => !strings.some((range) => block.start >= range.start && block.start < range.end))
		for (let index = 0; index < blocks.length; index += 1) {
			sites.push({
				file,
				kind: 'inline',
				index,
				line: lineOf(text, blocks[index].start),
				signature: shapeSignature(blocks[index].text),
				text: blocks[index].text,
				candidate: isIconCandidate(blocks[index].text),
			})
		}
		const calls = jsxSvgBlocks(text)
		for (let index = 0; index < calls.length; index += 1) {
			sites.push({
				file,
				kind: 'jsx',
				index,
				line: lineOf(text, calls[index].start),
				signature: shapeSignature(calls[index].text),
				text: calls[index].text,
				candidate: isIconCandidate(calls[index].text),
			})
		}
		const marks = markupBlocks(text)
		for (let index = 0; index < marks.length; index += 1) {
			sites.push({
				file,
				kind: 'markup',
				index,
				line: lineOf(text, marks[index].start),
				signature: shapeSignature(marks[index].text),
				text: marks[index].text,
				candidate: isIconCandidate(marks[index].text),
			})
		}
		// A `d="…"` literal outside any drawing is a shared path constant.
		const covered = [...blocks, ...calls, ...marks]
		for (const literal of pathLiterals(text)) {
			if (covered.some((block) => literal.start >= block.start && literal.start < block.end)) continue
			sites.push({
				file,
				kind: 'path',
				index: 0,
				line: lineOf(text, literal.start),
				signature: '',
				text: literal.value,
				candidate: false,
			})
		}
	}
	return { files, scanned: { total: files.length, ui, style }, sites, raster, maxFiles }
}

/**
 * The audit: sites grouped by library entry, plus everything the library cannot
 * account for. `entries` are `{ name, svg }` — the caller owns loading them, so
 * this module never needs to know how the library is stored.
 */
export async function audit(io, entries = [], options = {}) {
	// Two tables: a plain copy is compared as written, an encoded one after the
	// library's normalisation (see `decodedShapeSignature`).
	const bySignature = new Map()
	const byNormalized = new Map()
	const info = []
	for (const entry of entries) {
		const signature = shapeSignature(entry.svg)
		const normalized = decodedShapeSignature(entry.svg)
		if (signature !== '') bySignature.set(signature, entry.name)
		if (normalized !== '') byNormalized.set(normalized, entry.name)
		info.push({ ...entry, signature, normalized })
	}
	const scan = await scanSites(io, options)
	const perIcon = new Map(entries.map((entry) => [entry.name, []]))
	const unregistered = []
	for (const site of scan.sites) {
		const table = site.kind === 'datauri' ? byNormalized : bySignature
		const name = site.signature === '' ? undefined : table.get(site.signature)
		if (name === undefined) {
			if (site.candidate && site.signature !== '') unregistered.push(site)
			continue
		}
		perIcon.get(name).push(site)
	}
	const counts = { inline: 0, jsx: 0, markup: 0, path: 0, datauri: 0, file: 0 }
	for (const sites of perIcon.values()) {
		for (const site of sites) counts[site.kind] = (counts[site.kind] || 0) + 1
	}
	// A recorded pointer that no longer draws the entry is drift the panel would
	// otherwise only discover one icon at a time. Two ways to drift: the site is
	// gone, or the site is still there and draws something else now.
	const found = new Map()
	for (const site of scan.sites) found.set(`${site.kind}:${site.file}:${site.index}`, site)
	const stale = []
	for (const entry of info) {
		const recorded = Array.isArray(entry.pointers) ? entry.pointers : []
		for (const pointer of recorded) {
			const site = found.get(`${pointer.kind}:${pointer.file}:${pointer.index}`)
			if (!site) {
				stale.push({ name: entry.name, ...pointer })
				continue
			}
			// A shared path constant has no drawing to compare (`signature` is '').
			if (pointer.kind === 'path' || site.signature === '') continue
			const expected = pointer.kind === 'datauri' ? entry.normalized : entry.signature
			if (expected !== '' && site.signature !== expected) stale.push({ name: entry.name, ...pointer })
		}
	}
	const icons = [...perIcon.entries()]
		.map(([name, sites]) => ({ name, sites: sites.length, list: sites }))
		.sort((left, right) => right.sites - left.sites || left.name.localeCompare(right.name))
	return {
		scanned: scan.scanned,
		total: entries.length,
		counts,
		icons,
		unregistered,
		stale,
		raster: scan.raster,
	}
}

/** Everything a CI run can fail on, named once so the CLI and the tests agree. */
export function violations(result, { maxSites = 0 } = {}) {
	const over = maxSites > 0 ? result.icons.filter((icon) => icon.sites > maxSites) : []
	return {
		over,
		stale: result.stale,
		clear: over.length === 0 && result.stale.length === 0,
	}
}
