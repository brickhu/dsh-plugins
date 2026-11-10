/**
 * Consumption index: where this workspace references a graphic.
 *
 * Two reference forms are tracked:
 *
 *   // @asset dismiss        -> the `<svg>` on the next lines is a copy
 *
 * `apply` rewrites the copied `<svg>` block after an `@asset` marker so code
 * that inline-copied an icon can pick up the library's current version.
 */

const SKIP_DIRS = new Set([
	'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
	'.svelte-kit', '.turbo', '.cache', 'coverage', 'vendor', '.dsh',
])

// Only compiled code carries inline copies worth rewriting; docs, JSON and
// assets are left alone so a rename cannot rewrite prose or fixtures.
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?|svg)$/i

const MAX_FILES = 4000
const MAX_BYTES = 512 * 1024

// `// @asset <name> <hash>` — the hash is a cache hint, not the identity: the
// content signature stays authoritative, so a reformatted copy is still in sync.
const ASSET_MARKER = /@asset\s+([^\s*/<>"']+)(?:\s+([0-9a-f]{8,64}))?/g

export async function walkProject(io, directory, out, budget, exclude) {
	if (out.length >= MAX_FILES || budget.files >= MAX_FILES) return
	let entries
	try {
		entries = await io.listDir(directory === '' ? '.' : directory)
	} catch (_error) {
		return
	}
	for (const entry of entries) {
		if (budget.files >= MAX_FILES) return
		const path = directory === '' ? entry.name : `${directory}/${entry.name}`
		if (entry.type === 'directory') {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
			if (exclude && exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue
			await walkProject(io, path, out, budget, exclude)
			continue
		}
		if (entry.type !== 'file') continue
		if (!TEXT_FILE.test(entry.name)) continue
		if (typeof entry.size === 'number' && entry.size > MAX_BYTES) continue
		out.push(path)
		budget.files += 1
	}
}

/** Index every reference to a library graphic in the workspace. */
export async function scanUsage(io, names, options = {}) {
	const wanted = new Set(names)
	const files = []
	await walkProject(io, '', files, { files: 0 }, options.exclude || [])
	const usages = []
	for (const file of files) {
		let text
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null || text === '') continue
		if (!text.includes('@asset')) continue
		const lines = text.split('\n')
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index]
			for (const match of line.matchAll(ASSET_MARKER)) {
				const name = match[1]
				if (wanted.size > 0 && !wanted.has(name)) continue
				usages.push({ file, line: index + 1, name, form: 'asset', hash: match[2] || '' })
			}
		}
	}
	return usages
}

function findSvgBlock(text, fromIndex) {
	const start = text.indexOf('<svg', fromIndex)
	if (start === -1) return null
	let depth = 0
	let index = start
	while (index < text.length) {
		const nextOpen = text.indexOf('<svg', index)
		const nextClose = text.indexOf('</svg>', index)
		if (nextClose === -1) return null
		if (nextOpen !== -1 && nextOpen < nextClose) {
			depth += 1
			index = nextOpen + 4
			continue
		}
		depth -= 1
		index = nextClose + 6
		if (depth === 0) return { start, end: index }
	}
	return null
}

/**
 * Replace every `<svg>` that follows an `@asset <name>` marker.
 * Returns the number of rewritten blocks.
 */
export async function applyAsset(io, name, svg, warnings = [], options = {}) {
	const files = []
	await walkProject(io, '', files, { files: 0 }, options.exclude || [])
	let replaced = 0
	const touched = []
	for (const file of files) {
		let text
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null || !text.includes('@asset')) continue
		let next = text
		let changed = false
		// Reverse order keeps the offsets of earlier matches valid while rewriting.
		const matches = [...text.matchAll(ASSET_MARKER)].filter((match) => match[1] === name).reverse()
		for (const match of matches) {
			const markerStart = match.index + match[0].indexOf('@asset')
			const markerEnd = match.index + match[0].length
			const block = findSvgBlock(next, markerEnd)
			if (!block) {
				warnings.push(`${file}: @asset ${name} 后面没有找到 <svg>`)
				continue
			}
			const header = `@asset ${name}${options.hash ? ` ${options.hash}` : ''}`
			next = `${next.slice(0, markerStart)}${header}${next.slice(markerEnd, block.start)}${svg.trim()}${next.slice(block.end)}`
			changed = true
			replaced += 1
		}
		if (changed) {
			await io.writeText(file, next)
			touched.push(file)
		}
	}
	return { replaced, files: touched }
}

/** Rename references after a graphic's `name` changes (identity is the name). */
export async function cascadeRename(io, from, to, options = {}) {
	const files = []
	await walkProject(io, '', files, { files: 0 }, options.exclude || [])
	let count = 0
	const touched = []
	for (const file of files) {
		let text
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null || !text.includes('@asset')) continue
		const next = text
			.replaceAll(`@asset ${from}`, `@asset ${to}`)
		if (next !== text) {
			await io.writeText(file, next)
			touched.push(file)
			count += 1
		}
	}
	return { count, files: touched }
}

/**
 * Path data embedded in code as plain strings (no `<svg>` wrapper, no marker).
 *
 * Business code often keeps a copy of an icon as a `const PATH = 'M…'` literal.
 * We match by canonical geometry, so re-formatting or attribute style does not
 * hide a copy.
 */
export async function scanPathCopies(io, icons, { exclude = [] } = {}) {
	const files = []
	await walkProject(io, '', files, { files: 0 }, exclude)
	const canonical = await import('./svg.js')
	const canon = (d) => {
		try {
			return canonical.parsePath(d).map((segment) => (
				`${segment.c}${(segment.p || []).map((point) => point.map((value) => canonical.round(value, 2)).join(',')).join(' ')}`
			)).join(' ')
		} catch (_error) {
			return String(d || '').trim()
		}
	}
	const index = new Map()
	for (const icon of icons) {
		for (const d of icon.paths) {
			const key = canon(d)
			if (key === '') continue
			if (!index.has(key)) index.set(key, { name: icon.name, source: d })
		}
	}
	const copies = []
	for (const file of files) {
		if (!/\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?)$/i.test(file)) continue
		let text
		try {
			text = await io.readText(file)
		} catch (_error) {
			continue
		}
		if (text === null) continue
		const lines = text.split('\n')
		for (let index_ = 0; index_ < lines.length; index_ += 1) {
			const line = lines[index_]
			if (!/[Mm]/.test(line) || line.length < 16) continue
			for (const match of line.matchAll(/['"`]([^'"`]{16,})['"`]/g)) {
				const literal = match[1]
				if (!/^[Mm]/.test(literal.trim()) || !/[Zz]/.test(literal)) continue
				const key = canon(literal)
				const hit = index.get(key)
				if (!hit) continue
				copies.push({ file, line: index_ + 1, name: hit.name, code: literal, source: hit.source })
			}
		}
	}
	return copies
}
