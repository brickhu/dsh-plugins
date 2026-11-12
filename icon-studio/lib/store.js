/**
 * Storage for the workspace icon library.
 *
 * A library is plain files under `<workspace>/graphics/`:
 *
 *   manifest.json          one entry per graphic, the identity ledger
 *   *.svg                  source of truth for each graphic
 *
 * `name` is the identity (may be Chinese); `file` is assigned once, from the
 * name, and never moves again. Everything here goes through an `io` port so
 * the same code runs against the Host filesystem service and in tests:
 *
 *   io.readText(rel)  -> Promise<string | null>
 *   io.writeText(rel, text) -> Promise<void>
 *   io.stat(rel)      -> Promise<{ type, size } | null>
 *   io.listDir(rel)   -> Promise<Array<{ name, type }>>
 */

import { createHash } from 'node:crypto'
import {
	emptySvg, elementsFromSvg, normalizeElements, normalizeSvg, preserveSvg, scopeSvgIds, svgIds,
} from './svg.js'
import { bodySignature } from './shape.js'

export const LEGACY_DIR = '.icon-studio'
export const LIB_DIR = LEGACY_DIR
/** Single source of truth: a hidden JSON file at the workspace root. */
export const MANIFEST_FILE = '.icons.json'
// Older libraries lived under `.icon-studio/`; the hidden JSON file at the root
// is the current layout. Both stay readable.
export const FORMAT = 'dsh-icon-library'
/** v2: `note` became `rule`, entries carry `history` and `pointers`. */
export const FORMAT_VERSION = 11

/**
 * Cheap change token for the whole library: the world outside this file (the
 * panel's poll, the workspace scan cache) only needs to know *that* something
 * changed, not what. Timestamp plus every name/version/hash is enough, and it
 * costs one pass over an array that is already in memory.
 */
export function revisionOf(manifest) {
	const parts = [manifest.updatedAt ?? '', String(manifest.graphics.length)]
	for (const entry of manifest.graphics) parts.push(`${entry.name}:${entry.version}:${entry.hash ?? ''}`)
	return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16)
}

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/

/**
 * `close.svg` (current layout) or `icons/close.svg` (libraries created before
 * kinds were dropped) both stay readable; nothing outside those shapes does.
 * Legacy blobs are still migrated on read, so the guard stays.
 */
function safeFile(file) {
	if (typeof file !== 'string' || file === '') return false
	const parts = file.split('/')
	if (parts.length < 1 || parts.length > 2) return false
	if (parts.length === 2 && !SAFE_SEGMENT.test(parts[0])) return false
	const name = parts[parts.length - 1]
	if (!name.endsWith('.svg')) return false
	return SAFE_SEGMENT.test(name.slice(0, -4))
}
const MAX_NAME = 64

export function fail(code, message) {
	return Object.assign(new Error(message ?? code), { code })
}

/* ───────────────────────────── names & files ───────────────────────────── */

/**
 * A reference as a person types it in a conversation: `<删除>` means the icon
 * named 删除. The brackets are syntax, never part of the name.
 */
export function refName(raw) {
	const text = String(raw ?? '').trim()
	const wrapped = /^<([\s\S]+)>$/u.exec(text)
	return wrapped ? wrapped[1].trim() : text
}

export function normalizeName(raw) {
	if (typeof raw !== 'string') throw fail('invalid-name', 'name must be a string')
	const name = raw.trim()
	if (name === '') throw fail('invalid-name', 'name is required')
	if (name.length > MAX_NAME) throw fail('invalid-name', `name is longer than ${MAX_NAME} characters`)
	if (/[\u0000-\u001f\u007f]/u.test(name)) throw fail('invalid-name', 'name contains control characters')
	if (name.startsWith('.') || name.includes('/') || name.includes('\\')) {
		throw fail('invalid-name', 'name cannot contain path separators or start with a dot')
	}
	// `<name>` is the conversation reference syntax: the brackets are not part of
	// a name, so they must not appear in one either.
	if (name.includes('<') || name.includes('>')) {
		throw fail('invalid-name', 'name cannot contain < or >')
	}
	return name
}

/** Deterministic ASCII file stem: `关闭` -> `graphic-3` when nothing survives. */
export function slugify(name) {
	const ascii = String(name)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return ascii
}

/* ───────────────────────────── manifest ───────────────────────────── */

function emptyManifest() {
	return { format: FORMAT, formatVersion: FORMAT_VERSION, updatedAt: new Date().toISOString(), graphics: [] }
}

// `path` is a shared `d="…"` literal, `datauri` an encoded copy in code or CSS.
// Both used to fall through to `inline`, which made the rewrite target the wrong
// block; the kinds are stored as written so the push can pick its own branch.
const POINTER_KINDS = new Set(['file', 'inline', 'literal', 'jsx', 'markup', 'path', 'datauri'])

/** Where an icon is referenced in the workspace: the sync targets. */
function cleanPointers(raw) {
	if (!Array.isArray(raw)) return []
	const seen = new Set()
	const out = []
	for (const item of raw) {
		if (!item || typeof item.file !== 'string') continue
		const file = item.file.trim()
		if (file === '') continue
		const kind = POINTER_KINDS.has(item.kind) ? item.kind : 'inline'
		const index = Number(item.index) || 0
		const key = `${kind}:${file}:${index}`
		if (seen.has(key)) continue
		seen.add(key)
		out.push({
			file,
			kind,
			index,
			line: Number(item.line) || 0,
			...(typeof item.literal === 'string' && item.literal !== '' ? { literal: item.literal } : {}),
		})
		if (out.length >= 200) break
	}
	return out
}

/** Parse an IconifyIcon-style size back into a viewBox string. */
function iconifyViewBox(raw, defaults = { width: 24, height: 24 }) {
	if (raw && typeof raw.viewBox === 'string' && /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/u.test(raw.viewBox.trim())) {
		return raw.viewBox.trim()
	}
	const width = raw && typeof raw.width === 'number' ? raw.width : defaults.width
	const height = raw && typeof raw.height === 'number' ? raw.height : defaults.height
	const left = raw && typeof raw.left === 'number' ? raw.left : 0
	const top = raw && typeof raw.top === 'number' ? raw.top : 0
	return `${left} ${top} ${width} ${height}`
}

/** Serialize one runtime entry into the IconifyIcon shape used on disk. */
function serializeEntry(entry) {
	const [left, top, width, height] = String(entry.viewBox || '0 0 24 24').split(/[\s,]+/u).map((value) => Number(value))
	// IconifyJSON: omitted size means the collection default (24×24), omitted
	// offsets mean 0 — so only the parts that differ are written.
	const out = { body: entry.body }
	if (Number.isFinite(left) && left !== 0) out.left = left
	if (Number.isFinite(top) && top !== 0) out.top = top
	if (Number.isFinite(width) && width !== 24) out.width = width
	if (Number.isFinite(height) && height !== 24) out.height = height
	return out
}

function cleanEntry(raw, defaults = { width: 24, height: 24 }) {
	if (!raw || typeof raw !== 'object') return null
	const name = typeof raw.name === 'string' ? raw.name.trim() : ''
	if (name === '') return null
	const body = typeof raw.body === 'string' ? raw.body : ''
	const file = typeof raw.file === 'string' ? raw.file.trim() : ''
	if (body === '' && !safeFile(file)) return null
	const viewBox = iconifyViewBox(raw, defaults)
	// v2 renamed `note` to `rule` (应用规则). Older manifests still carry `note`
	// and stay readable: the value migrates on the next write.
	const rule = typeof raw.rule === 'string'
		? raw.rule
		: (typeof raw.note === 'string' ? raw.note : '')
	return {
		name,
		body,
		// Legacy entries still point at an old blob until the migration folds it in.
		file: body === '' ? file : '',
		viewBox,
		rule,
		pointers: cleanPointers(raw.pointers),
		hash: typeof raw.hash === 'string' ? raw.hash : '',
		source: typeof raw.source === 'string' ? raw.source : '',
		// The upstream ref this entry was imported from, e.g. `iconmcp-generic:trash`.
		// The local name is the user's to choose, so provenance needs its own field.
		origin: typeof raw.origin === 'string' ? raw.origin : '',
		license: typeof raw.license === 'string' ? raw.license : 'unknown',
		palette: Array.isArray(raw.palette) ? raw.palette.filter((value) => typeof value === 'string').slice(0, 24) : [],
		createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
		updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
		// The drawing's identity *after* normalisation (single colour -> currentColor,
		// groups flattened). The scan compares against this, so a copy of the same
		// icon is recognised no matter which form the code wrote it in.
		signature: typeof raw.signature === 'string' ? raw.signature : '',
		// When the workspace was last indexed for this drawing. An empty value
		// means "never scanned", which is how the panel knows it may scan once —
		// and how it knows not to scan again after finding nothing.
		scannedAt: typeof raw.scannedAt === 'string' ? raw.scannedAt : '',
		// `version` bumps on every source edit; `pushed` remembers the version that
		// was last copied into code. They differ only while a push is pending.
		version: typeof raw.version === 'number' && raw.version > 0 ? raw.version : 1,
		pushed: typeof raw.pushed === 'number' && raw.pushed > 0 ? raw.pushed : (typeof raw.version === 'number' && raw.version > 0 ? raw.version : 1),
	}
}

/** The full SVG document for an entry whose body is stored inline. */
export function entrySvg(entry) {
	if (!entry || typeof entry.body !== 'string' || entry.body === '') return ''
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.viewBox}">${entry.body}</svg>`
}

/** Read an entry's artwork, falling back to a legacy blob when needed. */
export async function readEntrySvg(io, entry) {
	if (entry && typeof entry.body === 'string' && entry.body !== '') return entrySvg(entry)
	if (entry && typeof entry.file === 'string' && entry.file !== '') {
		return io.readText(`${LIB_DIR}/${entry.file}`)
	}
	return null
}

/**
 * The drawing's identity, independent of the authored markup: normalise without
 * pinning the canvas (which crops to content) and hash the result. Falls back to
 * the pinned form for element-model input, which carries no SVG text.
 */
function identityOf(input, normalized) {
	const text = typeof input?.svg === 'string' ? input.svg : ''
	if (text.trim() !== '') {
		try {
			return bodySignature(normalizeSvg(text).svg)
		} catch (_error) { /* fall through to the pinned form */ }
	}
	try {
		return bodySignature(normalized.svg)
	} catch (_error) {
		return ''
	}
}

export function createStore(io) {
	async function readManifestFile() {
		let text = await io.readText(MANIFEST_FILE)
		let fromLegacy = false
		if (text === null) {
			// Older libraries lived under `.icon-studio/manifest.json`.
			text = await io.readText(`${LEGACY_DIR}/manifest.json`)
			fromLegacy = text !== null
		}
		if (text === null) return { exists: false, manifest: emptyManifest() }
		let parsed
		try {
			parsed = JSON.parse(text)
		} catch (_error) {
			throw fail('bad-manifest', `${MANIFEST_FILE} is not valid JSON`)
		}
		const map = parsed && typeof parsed === 'object' && parsed.icons && typeof parsed.icons === 'object' && !Array.isArray(parsed.icons)
			? parsed.icons
			: null
		if (!parsed || typeof parsed !== 'object' || (!map && !Array.isArray(parsed.graphics))) {
			throw fail('bad-manifest', `${MANIFEST_FILE} has no icons object`)
		}
		// IconifyJSON shape: `icons` is a name → IconifyIcon map. The legacy v2
		// `graphics` array is still read once and rewritten as a map.
		const defaults = {
			width: Number.isFinite(Number(parsed.width)) ? Number(parsed.width) : 24,
			height: Number.isFinite(Number(parsed.height)) ? Number(parsed.height) : 24,
		}
		// Icon metadata lives beside the icon data: `rules`, `pointers`, `meta` and
		// the `order` array. Older files still carry those fields on the icon.
		const rules = parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : {}
		const pointerMap = parsed.pointers && typeof parsed.pointers === 'object' ? parsed.pointers : {}
		const metaMap = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {}
		const metadata = parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}
		const merge = (name, icon) => {
			const extra = {
				...(metaMap[name] && typeof metaMap[name] === 'object' ? metaMap[name] : {}),
				...(metadata[name] && typeof metadata[name] === 'object' ? metadata[name] : {}),
			}
			return {
				...icon,
				...extra,
				name,
				rule: typeof extra.rule === 'string'
					? extra.rule
					: (typeof rules[name] === 'string' ? rules[name] : (typeof icon.rule === 'string' ? icon.rule : '')),
				pointers: Array.isArray(extra.pointers) ? extra.pointers : (Array.isArray(pointerMap[name]) ? pointerMap[name] : icon.pointers),
			}
		}
		const graphics = (map
			? Object.entries(map).map(([name, icon]) => cleanEntry(merge(name, icon), defaults))
			: parsed.graphics.map((entry) => cleanEntry(entry, defaults))
		).filter(Boolean)
		const seen = new Set()
		const unique = []
		for (const entry of graphics) {
			if (seen.has(entry.name)) continue
			seen.add(entry.name)
			unique.push(entry)
		}
		let migrated = false
		for (const entry of unique) {
			if (entry.body !== '' || entry.file === '') continue
			const text = await io.readText(`${LIB_DIR}/${entry.file}`)
			if (text === null) continue
			try {
				const preserved = preserveSvg(text)
				entry.body = preserved.body
				if (preserved.viewBox) entry.viewBox = preserved.viewBox
				entry.file = ''
				migrated = true
			} catch (_error) { /* keep the legacy pointer */ }
		}
		const aliases = parsed.aliases && typeof parsed.aliases === 'object' && !Array.isArray(parsed.aliases) ? parsed.aliases : {}
		const manifest = {
			format: FORMAT,
			formatVersion: FORMAT_VERSION,
			aliases,
			// A library written before `updatedAt` existed still needs a stable
			// revision: fall back to Iconify's second-resolution `lastModified`
			// instead of "now", which would make every poll look like a change.
			updatedAt: typeof parsed.updatedAt === 'string'
				? parsed.updatedAt
				: (Number.isFinite(Number(parsed.lastModified)) ? new Date(Number(parsed.lastModified) * 1000).toISOString() : new Date().toISOString()),
			graphics: unique,
		}
		// Never rewrite a file written by a newer plugin: an older process must not
		// clobber fields it does not understand.
		const newer = typeof parsed.formatVersion === 'number' && parsed.formatVersion > FORMAT_VERSION
		const legacyShape = Array.isArray(parsed.graphics) || parsed.copies !== undefined || parsed.formatVersion !== FORMAT_VERSION
		if (!newer && (migrated || fromLegacy || legacyShape)) await writeManifestFile(manifest)
		return { exists: true, manifest }
	}

	async function writeManifestFile(manifest) {
		manifest.updatedAt = new Date().toISOString()
		const icons = {}
		const metadata = {}
		for (const entry of manifest.graphics) {
			if (!entry || icons[entry.name]) continue
			icons[entry.name] = serializeEntry(entry)
			const extra = {}
			if (entry.rule) extra.rule = entry.rule
			if (Array.isArray(entry.pointers) && entry.pointers.length > 0) extra.pointers = entry.pointers
			if (entry.signature) extra.signature = entry.signature
			if (entry.scannedAt) extra.scannedAt = entry.scannedAt
			if (entry.hash) extra.hash = entry.hash
			if (entry.source) extra.source = entry.source
			if (entry.origin) extra.origin = entry.origin
			if (entry.license) extra.license = entry.license
			if (Array.isArray(entry.palette) && entry.palette.length > 0) extra.palette = entry.palette
			if (entry.createdAt) extra.createdAt = entry.createdAt
			if (entry.updatedAt) extra.updatedAt = entry.updatedAt
			if (typeof entry.version === 'number') extra.version = entry.version
			if (typeof entry.pushed === 'number') extra.pushed = entry.pushed
			if (Object.keys(extra).length > 0) metadata[entry.name] = extra
		}
		// IconifyJSON native shape; `formatVersion` and `metadata` are the only
		// additions (metadata is Iconify's own per-icon slot, extended per icon).
		const payload = {
			width: 24,
			height: 24,
			icons,
			...(manifest.aliases && typeof manifest.aliases === 'object' && Object.keys(manifest.aliases).length > 0 ? { aliases: manifest.aliases } : {}),
			lastModified: Math.floor(Date.now() / 1000),
			// Kept in the file: the panel polls with it, and a reload must answer
			// "unchanged" instead of re-sending every drawing.
			updatedAt: manifest.updatedAt,
			...(Object.keys(metadata).length > 0 ? { metadata } : {}),
			formatVersion: FORMAT_VERSION,
		}
		await io.writeText(MANIFEST_FILE, `${JSON.stringify(payload, null, 2)}\n`)
	}

	function find(manifest, name) {
		return manifest.graphics.find((entry) => entry.name === name)
	}

	/** Iconify aliases are read-only alternate names for a canonical icon. */
	function resolveName(manifest, name) {
		let current = name
		const seen = new Set()
		while (!find(manifest, current)) {
			const alias = manifest.aliases && manifest.aliases[current]
			const parent = alias && typeof alias.parent === 'string' ? normalizeName(alias.parent) : ''
			if (parent === '' || seen.has(parent)) return current
			seen.add(parent)
			current = parent
		}
		return current
	}


	return {
		async manifest() {
			return readManifestFile()
		},

		/**
		 * Entries in manifest order, which is creation order: a new icon lands at
		 * the end of the list instead of jumping into an alphabetical slot.
		 */
		async list() {
			const { exists, manifest } = await readManifestFile()
			return { exists, entries: manifest.graphics.slice(), revision: revisionOf(manifest), updatedAt: manifest.updatedAt }
		},

		/**
		 * Persist a manual order. The icons map's key order is the list order, so
		 * this rewrites the map in the requested sequence; icons the caller did
		 * not mention keep their place at the end.
		 */
		async reorder(names) {
			if (!Array.isArray(names)) throw fail('invalid-order', 'names must be an array')
			const { manifest } = await readManifestFile()
			const wanted = names.map((name) => normalizeName(name))
			if (new Set(wanted).size !== wanted.length) throw fail('invalid-order', 'names repeat')
			for (const name of wanted) {
				if (!find(manifest, name)) throw fail('not-found', `no graphic named ${name}`)
			}
			const rest = manifest.graphics.filter((entry) => !wanted.includes(entry.name))
			const sequence = [...wanted.map((name) => find(manifest, name)), ...rest]
			manifest.graphics = sequence
			await writeManifestFile(manifest)
			return { entries: sequence }
		},

		/** Alternate names (Iconify aliases) that resolve to this icon. */
		async markPushed(name) {
			const { manifest } = await readManifestFile()
			const entry = find(manifest, normalizeName(name))
			if (!entry) return false
			if (entry.pushed === entry.version) return false
			entry.pushed = entry.version
			await writeManifestFile(manifest)
			return true
		},


		/** Full payload for one graphic: entry + clean svg + editor elements. */
		/** Layer 1 file for an entry, or null when the icon has none yet. */
		async get(name) {
			const { manifest } = await readManifestFile()
			const entry = find(manifest, resolveName(manifest, normalizeName(name)))
			if (!entry) throw fail('not-found', `no graphic named ${name}`)
			const svg = await readEntrySvg(io, entry)
			if (svg === null) throw fail('missing-file', `no artwork for ${entry.name}`)
			const parsed = elementsFromSvg(svg)
			return {
				entry,
				svg,
				elements: parsed.elements,
				draft: null,
			}
		},

		async save(input) {
			const previous = typeof input?.previousName === 'string' && input.previousName.trim() !== ''
				? normalizeName(input.previousName)
				: ''
			let name = typeof input?.name === 'string' && input.name.trim() !== ''
				? normalizeName(input.name)
				: previous
			const { manifest: current } = await readManifestFile()
			// Naming is mandatory: an unnamed icon is unreachable for the agent and
			// the panel. There is no `icon-<n>` fallback any more.
			if (name === '') throw fail('name-required', 'an icon needs a name before it can be saved')
			const previousName = previous !== '' ? previous : name
			// 应用规则 is optional metadata: a missing one only makes the icon harder
			// for an agent to pick, it does not invalidate the artwork.
			// `undefined` means "leave it alone" (replacing artwork must not wipe a
			// rule a human wrote); an explicit '' clears it on purpose.
			const rule = typeof input?.rule === 'string'
				? input.rule.trim()
				: (typeof input?.note === 'string' ? input.note.trim() : undefined)

			// A save from the editor pins the canvas it was drawn on; an import that
			// brings no viewBox is trimmed to its content.
			const pinned = typeof input?.viewBox === 'string' ? input.viewBox : undefined
			const normalized = Array.isArray(input?.elements)
				? normalizeElements(input.elements, { name, viewBox: pinned })
				: normalizeSvg(input?.svg, { name, viewBox: pinned })
			// Storage keeps the authored markup (IconifyIcon body + canvas); the
			// flattened normalisation above is only used to compare shapes.
			const authored = !Array.isArray(input?.elements)
				&& (typeof pinned === 'string' || /viewBox\s*=/iu.test(String(input?.svg ?? '')))
			const stored = authored
				? preserveSvg(input?.svg, { viewBox: pinned || normalized.viewBox })
				: normalized

			const manifest = current
			const existing = find(manifest, previousName)
			if (!existing && previousName !== name && find(manifest, name)) {
				throw fail('name-taken', `a graphic named ${name} already exists`)
			}
			if (existing && existing.name !== name && find(manifest, name)) {
				throw fail('name-taken', `a graphic named ${name} already exists`)
			}
			const now = new Date().toISOString()
			const target = existing ?? {
				name,
				createdAt: now,
			}
			const others = manifest.graphics.filter((entry) => entry !== existing)
			let duplicate = others.find((entry) => entry.hash !== '' && entry.hash === stored.hash)
			if (!duplicate) {
				// The canvas is not part of the identity: the same inner code in a
				// different viewBox is still this icon.
				const wanted = bodySignature(normalized.svg)
				if (wanted !== '') {
					for (const entry of others) {
						let text = null
						try {
							text = await readEntrySvg(io, entry)
						} catch (_error) {
							continue
						}
						if (text === null) continue
						let sig = bodySignature(text)
						if (sig !== wanted) {
							try { sig = bodySignature(normalizeSvg(text).svg) } catch (_error) { sig = '' }
						}
						if (sig === wanted) {
							duplicate = entry
							break
						}
					}
				}
			}
			if (duplicate && input?.allowDuplicate !== true) {
				return {
					status: 'duplicate',
					of: duplicate.name,
					rule: duplicate.rule,
					name,
					hash: stored.hash,
					manifest,
					warnings: stored.warnings,
				}
			}
			const changed = target.hash !== stored.hash
			let storedBody = typeof stored.body === 'string' ? stored.body : ''
			if (storedBody === '') {
				try { storedBody = preserveSvg(stored.svg).body } catch (_error) { storedBody = '' }
			}
			const entry = {
				...target,
				name,
				// IconifyIcon semantics: the authored body lives in the manifest.
				body: storedBody,
				file: '',
				viewBox: stored.viewBox,
				rule: rule === undefined ? (target.rule ?? '') : rule,
				pointers: cleanPointers(target.pointers),
				hash: stored.hash,
				source: typeof input?.source === 'string' && input.source !== '' ? input.source : (target.source ?? ''),
				origin: typeof input?.origin === 'string' && input.origin !== '' ? input.origin : (target.origin ?? ''),
				license: typeof input?.license === 'string' && input.license !== '' ? input.license : (target.license ?? 'unknown'),
				palette: normalized.palette,
				updatedAt: now,
				// The same artwork in another authored form normalises to the same
				// signature, which is what the workspace scan matches on. It is
				// computed on the *cropped* form (no pinned canvas): the scan never
				// knows the canvas a copy was drawn on, only the drawing.
				signature: identityOf(input, normalized),
				// New artwork moves: the pointer list must be discovered again.
				scannedAt: '',
			}
			if (existing) {
				const index = manifest.graphics.indexOf(existing)
				manifest.graphics[index] = entry
			} else {
				manifest.graphics.push(entry)
			}
			// Two bodies inlined into one page must not share gradient ids: scope
			// this body when it collides with another icon's ids.
			const mine = svgIds(entry.body)
			if (mine.size > 0) {
				const others = new Set()
				for (const other of manifest.graphics) {
					if (other === entry) continue
					for (const id of svgIds(other.body || '')) others.add(id)
				}
				if ([...mine].some((id) => others.has(id))) {
					entry.body = scopeSvgIds(entry.body, slugify(entry.name))
				}
			}
			const exported = entrySvg(entry)
			if (existing && changed) {
				entry.version = Math.round((existing.version + 0.1) * 10) / 10
			}
			// A rename is a real modification: every name-keyed record must follow it,
			// not just the artwork. `@asset` markers are rewritten by the caller.
			if (existing && previousName !== name) {
			}
			await writeManifestFile(manifest)
			let cascaded = 0
			if (existing && previousName !== name) {
				// name is identity: the generated layer and @asset markers follow it
				cascaded = -1
			}
			return {
				status: previousName !== name ? 'renamed' : changed ? 'saved' : 'unchanged',
				created: !existing,
				changed,
				from: previousName !== name ? previousName : undefined,
				entry,
				svg: entrySvg(entry),
				elements: normalized.elements,
				draft: null,
				warnings: stored.warnings,
				hash: stored.hash,
				renamedNeedsCascade: cascaded === -1,
			}
		},

		/** Create an empty library file; then the workspace can import icons. */
		async init() {
			const { exists } = await readManifestFile()
			if (exists) return { created: false, exists: true }
			const manifest = emptyManifest()
			await writeManifestFile(manifest)
			return { created: true, exists: true }
		},

		async annotate(input) {
			const name = normalizeName(input?.name)
			const rule = typeof input?.rule === 'string'
				? input.rule.trim()
				: (typeof input?.note === 'string' ? input.note.trim() : '')
			const { manifest } = await readManifestFile()
			const entry = find(manifest, name)
			if (!entry) throw fail('not-found', `no graphic named ${name}`)
			entry.rule = rule
			entry.updatedAt = new Date().toISOString()
			await writeManifestFile(manifest)
			return { status: 'annotated', entry, manifest }
		},

		/** Create an icon. Naming is mandatory (see `save`). */
		async create(input) {
			const width = Math.max(1, Math.min(4096, Math.round(Number(input?.width) || 24)))
			const height = Math.max(1, Math.min(4096, Math.round(Number(input?.height) || width)))
			const { manifest } = await readManifestFile()
			if (typeof input?.name !== 'string' || input.name.trim() === '') {
				throw fail('name-required', 'an icon needs a name before it can be created')
			}
			const name = normalizeName(input.name)
			if (find(manifest, name)) throw fail('name-taken', `a graphic named ${name} already exists`)
			const svg = emptySvg(width, height)
			const stored = preserveSvg(svg)
			const now = new Date().toISOString()
			const emptyHash = stored.hash
			const entry = {
				name,
				body: stored.body,
				file: '',
				viewBox: `0 0 ${width} ${height}`,
				rule: '',
				pointers: [],
				hash: emptyHash,
				source: typeof input?.source === 'string' ? input.source : '',
				license: typeof input?.license === 'string' ? input.license : 'unknown',
				palette: [],
				createdAt: now,
				updatedAt: now,
			}
			manifest.graphics.push(entry)
			await writeManifestFile(manifest)
			return { entry, svg, elements: [] }
		},

		/**
		 * Remove an icon from the library manifest. The caller owns the file on
		 * disk (the Host has a subprocess, the store only speaks read/write).
		 */
		async remove(input) {
			const name = normalizeName(input?.name)
			const { manifest } = await readManifestFile()
			const index = manifest.graphics.findIndex((entry) => entry.name === name)
			if (index === -1) throw fail('not-found', `no icon named ${name}`)
			const [entry] = manifest.graphics.splice(index, 1)
			await writeManifestFile(manifest)
			return { entry, manifest }
		},

		/** Dry-run normalisation used by the paste-SVG import dialog. */
		async inspect(input) {
			const normalized = normalizeSvg(input?.svg, { preserveViewBox: input?.preserveViewBox === true })
			const authored = typeof input?.viewBox === 'string' || /viewBox\s*=/iu.test(String(input?.svg ?? ''))
			const stored = authored
				? preserveSvg(input?.svg, { viewBox: input?.viewBox || normalized.viewBox })
				: normalized
			const { manifest } = await readManifestFile()
			let duplicate = manifest.graphics.find((entry) => entry.hash === stored.hash)
			if (!duplicate) {
				const wanted = bodySignature(normalized.svg)
				if (wanted !== '') {
					for (const entry of manifest.graphics) {
						let text = null
						try {
							text = await readEntrySvg(io, entry)
						} catch (_error) {
							continue
						}
						if (text === null) continue
						let sig = bodySignature(text)
						if (sig !== wanted) {
							try { sig = bodySignature(normalizeSvg(text).svg) } catch (_error) { sig = '' }
						}
						if (sig === wanted) {
							duplicate = entry
							break
						}
					}
				}
			}
			return {
				status: 'ok',
				svg: stored.svg,
				body: stored.body,
				elements: normalized.elements,
				viewBox: stored.viewBox,
				width: stored.width,
				height: stored.height,
				palette: normalized.palette,
				warnings: stored.warnings,
				hash: stored.hash,
				duplicate: duplicate ? duplicate.name : null,
				// Point 5 of the simplification: an identical paste shows what the
				// existing artwork already means, instead of asking for a new name.
				duplicateRule: duplicate ? duplicate.rule : '',
				duplicateViewBox: duplicate ? duplicate.viewBox : '',
			}
		},

		/** Sync targets recorded for one icon. */
		async pointers(name) {
			const { manifest } = await readManifestFile()
			const entry = find(manifest, normalizeName(name))
			return entry ? cleanPointers(entry.pointers) : []
		},

		/** Replace the recorded sync targets of one icon. */
		async setPointers(name, list) {
			const { manifest } = await readManifestFile()
			const entry = find(manifest, normalizeName(name))
			if (!entry) throw fail('not-found', `no graphic named ${name}`)
			entry.pointers = cleanPointers(list)
			entry.scannedAt = new Date().toISOString()
			entry.updatedAt = entry.scannedAt
			await writeManifestFile(manifest)
			return entry
		},

	}
}
