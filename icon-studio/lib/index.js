/**
 * Host half of dsh-icon-studio.
 *
 *   .icons.json                 the library this plugin owns (see store.js)
 *   .icons.json                   single library file at the workspace root
 *   icon_list / icon_get / icon_save / icon_annotate   agent tools
 *   /api/dsh-icon-studio/* HTTP routes used by the sidebar panel
 *
 * The host owns every filesystem touch so the client only ever talks to these
 * routes; the client never needs a writable remote.
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cascadeRename, applyAsset } from './assets.js'
import { findShapePointers, pushShapePointers, readDerivations, bodySignature, scanCodeShapes } from './sync.js'
import { normalizeSvg, pathBBox, bakeIconifyTransform, strokeCrossings } from './svg.js'
import { parseSupplyRef, seedRule, svgCanvasSize, createIconmcpClient } from './supply.js'
import { isNewer, latestPublished } from './update.js'
import { generatedIconIssues } from './shape.js'
import { readFileSync as readJsonFile } from 'node:fs'

/** The 16-hex blob name, used as the marker's cache hint. */
function shortHash(hash) {
	return String(hash ?? '').replace(/^sha256:/u, '').slice(0, 16)
}

/** Read once at load so a hot reload picks up a new version. */
const PACKAGE = (() => {
	try {
		return JSON.parse(readJsonFile(new URL('../package.json', import.meta.url), 'utf8'))
	} catch (_error) {
		return {}
	}
})()
/** Shown in the panel footer and compared with the registry's `latest`. */
const PLUGIN_VERSION = typeof PACKAGE.version === 'string' ? PACKAGE.version : ''
const PLUGIN_NAME = typeof PACKAGE.name === 'string' && PACKAGE.name !== '' ? PACKAGE.name : 'dsh-icon-library'

import { createStore, readEntrySvg, LIB_DIR, MANIFEST_FILE, normalizeName, refName } from './store.js'

const API = '/api/dsh-icon-studio'

/**
 * Opaque change token for one workspace's library: the revision from the file,
 * bound to its root so two identical libraries can never answer each other's
 * "unchanged" poll.
 */
function revisionToken(root, revision) {
	return createHash('sha1').update(`${root}\u0000${revision}`).digest('hex').slice(0, 16)
}

/** This package's own directory, so scans never rewrite its docs or fixtures. */
const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const RULE = [
	'This workspace has its own icon library in `.icons.json` at the project root: names, 应用规则 (when to use / when not to) and inline SVG bodies. Prefer it over any generic icon library.',
	'For any icon or glyph need — close, chevron, search, trash, empty state — call `icon_list` first, then `icon_get` for the SVG. Pick by meaning from the rule, not by name.',
	// The two failure modes worth spelling out: inventing a glyph, and copying
	// markup out of a chat message instead of the library.
	'If nothing matches, say so and list the closest candidates; the user can widen the pool from the Icons panel, so ask for that instead of inventing paths. SVG pasted into the chat is text: do not import it unless asked.',
	'A name is written `<名字>` in conversation (brackets are syntax, not part of the name). Inline the returned SVG so it inherits currentColor; never `<img src="*.svg">`, and do not add markers to code — the library rewrites every use when the icon changes.',
	'After using an icon, call `icon_annotate` if you learned something durable about when to use it.',
].join(' ')

/* ───────────────────────────── HTTP helpers ───────────────────────────── */

function json(res, status, value) {
	res.statusCode = status
	res.setHeader('content-type', 'application/json; charset=utf-8')
	res.setHeader('cache-control', 'no-store')
	res.end(JSON.stringify(value))
}

function ok(res, value) {
	json(res, 200, { status: 'ok', ...value })
}

function guessStatus(code) {
	if (code === 'unknown-workspace' || code === 'not-found') return 404
	if (code === 'name-taken' || code === 'duplicate') return 409
	return 400
}

function error(res, err) {
	const code = err && typeof err.code === 'string' ? err.code : 'internal'
	const message = err instanceof Error ? err.message : String(err)
	if (code === 'internal') {
		json(res, 500, { status: 'error', error: { code, message } })
		return
	}
	json(res, guessStatus(code), { status: 'error', error: { code, message } })
}

async function readBody(req) {
	const parts = []
	let size = 0
	for await (const chunk of req) {
		size += chunk.length
		if (size > 8 * 1024 * 1024) throw Object.assign(new Error('body too large'), { code: 'body-too-large' })
		parts.push(chunk)
	}
	if (parts.length === 0) return {}
	const value = JSON.parse(Buffer.concat(parts).toString('utf8'))
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw Object.assign(new Error('body must be a JSON object'), { code: 'invalid-body' })
	}
	return value
}

function query(req) {
	try {
		return new URL(req.url ?? '', 'http://localhost').searchParams
	} catch (_error) {
		return new URLSearchParams()
	}
}

/* ───────────────────────────── plugin ───────────────────────────── */

export function apply(ctx, config = {}) {
	const targetOverride = typeof config?.target === 'string' ? config.target : 'auto'

	/** Explicit session route, else the harness default model. */
	function resolveModelRoute(scope, sessionId) {
		const routeOf = (candidate) => {
			if (!candidate || typeof candidate !== 'object') return undefined
			const provider = typeof candidate.provider === 'string' ? candidate.provider : ''
			const model = typeof candidate.model === 'string' ? candidate.model : ''
			return provider !== '' && model !== '' ? { provider, model } : undefined
		}
		try {
			const sessions = scope.get('sessions')
			const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
			if (session) {
				const header = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
				const route = routeOf(header && header.config)
				if (route) return route
			}
		} catch (_error) { /* fall through */ }
		try {
			const service = scope.get('agentDefaultModel')
			if (service && typeof service.currentSelection === 'function') {
				const route = routeOf(service.currentSelection())
				if (route) return route
			}
		} catch (_error) { /* fall through */ }
		try {
			const settings = scope.get('settings')
			const entry = settings && typeof settings.get === 'function' ? settings.get('agent-default-model') : undefined
			const route = routeOf(entry)
			if (route) return route
		} catch (_error) { /* fall through */ }
		return undefined
	}

	/** A model-proposed name: Chinese or English, never the reference brackets. */
	function cleanName(value) {
		const raw = String(value || '').trim().replace(/^<+/u, '').replace(/>+$/u, '').trim()
		if (raw === '') return ''
		try {
			return normalizeName(raw)
		} catch (_error) {
			return ''
		}
	}

	/** kebab-case the first useful token of a hint. */
	function toKebab(value) {
		if (typeof value !== 'string') return ''
		return value
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.split('-')
			.filter(Boolean)
			.slice(0, 3)
			.join('-')
	}

	/** `<title>`, `data-name`, root id… often carry the icon's intended name. */
	function nameHintFromMarkup(text) {
		const source = String(text || '')
		const patterns = [
			/<title[^>]*>([^<]{1,64})<\/title>/i,
			/<desc[^>]*>([^<]{1,64})<\/desc>/i,
			/data-name\s*=\s*["']([^"']{1,64})["']/i,
			/aria-label\s*=\s*["']([^"']{1,64})["']/i,
			/<svg[^>]*\sid\s*=\s*["']([^"']{1,64})["']/i,
		]
		for (const pattern of patterns) {
			const match = pattern.exec(source)
			if (!match) continue
			const name = toKebab(match[1])
			if (name.length >= 2) return name
		}
		return ''
	}

	/** One model round-trip for the paste dialog: a name and an application rule. */
	async function streamSuggestion(scope, route, sessionId, svg, maxTokens) {
		const llm = scope.get('llm')
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 15000)
		let text = ''
		try {
			const stream = llm.stream({
				provider: route.provider,
				model: route.model,
				system: 'You name icons and describe when to use them. Reply with JSON only: {"name":"short kebab-case English name","rule":"one sentence in English: what it is, when to use it, when NOT to, and the words a user might call it"}. No code fences, no explanation.',
				messages: [{
					role: 'user',
					content: [{ type: 'text', text: `This is an SVG icon:\n\n${String(svg).slice(0, 6000)}\n\nName it and write its application rule. Reply with the JSON only.` }],
				}],
				maxTokens,
				signal: controller.signal,
				...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
			})
			for await (const chunk of stream) {
				if (!chunk) continue
				if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
				if (chunk.type === 'block-end' && text === '' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') text = chunk.block.text
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') return '!error'
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'max-tokens' && text === '') return '!max-tokens'
			}
		} catch (_error) {
			return ''
		} finally {
			clearTimeout(timer)
		}
		return text
	}

	/**
	 * The look of the library, in the terms a drawing model needs: canvas, stroke
	 * width, filled or outlined, which primitives, and a few real examples.
	 */
	async function styleProfile(io, store, limit = 60) {
		const { entries } = await store.list()
		const canvas = new Map()
		const stroke = new Map()
		const tags = new Map()
		let filled = 0
		let stroked = 0
		const examples = []
		for (const entry of entries.slice(0, limit)) {
			let svg = ''
			try {
				svg = (await readEntrySvg(io, entry)) ?? ''
			} catch (_error) {
				svg = ''
			}
			if (svg === '') continue
			const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1] ?? ''
			const parts = viewBox.trim().split(/[\s,]+/u).map(Number)
			const box = parts.length === 4 && parts[2] > 0 ? `${parts[2]}x${parts[3]}` : entry.viewBox
			canvas.set(box, (canvas.get(box) ?? 0) + 1)
			for (const match of svg.matchAll(/\bstroke-width="([^"]+)"/gu)) stroke.set(match[1], (stroke.get(match[1]) ?? 0) + 1)
			if (/fill="currentColor"/u.test(svg)) filled += 1
			if (/stroke="currentColor"/u.test(svg)) stroked += 1
			for (const match of svg.matchAll(/<(path|circle|rect|line|polygon|polyline|ellipse)\b/gu)) {
				tags.set(match[1], (tags.get(match[1]) ?? 0) + 1)
			}
			if (examples.length < 3) examples.push({ name: entry.name, svg: svg.slice(0, 700) })
		}
		const top = (map, fallback) => [...map.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? fallback
		return {
			total: entries.length,
			canvas: top(canvas, '24x24'),
			strokeWidth: top(stroke, '1.5'),
			painted: filled > stroked ? 'fill' : 'stroke',
			elements: [...tags.entries()].sort((left, right) => right[1] - left[1]).map(([tag]) => tag),
			examples,
		}
	}

	/** One model round-trip that draws a new icon in the library's own style. */
	async function streamIcon(scope, route, sessionId, prompt, profile, retry = null, references = [], budget = 8000) {
		const llm = scope.get('llm')
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 60000)
		const [width, height] = profile.canvas.split('x')
		const system = [
			'You draw icons as SVG for an existing icon library and must match its style.',
			`Rules: one square canvas viewBox="0 0 ${width} ${height}"; a single colour only (paint with stroke="currentColor", and fill="none" unless the house style is filled); no <style>, ids, <text>, <image>, gradients, filters or masks; only path, line, circle, rect, polygon, polyline and ellipse; at most 12 elements; coordinates on whole or half units, with about one unit of padding; stroke-linecap="round" stroke-linejoin="round".`,
			'Composition: draw ONE subject. When the subject is two things together (a calendar with a lock, a folder with a star), draw their union as one outline and put the detail inside — never draw two complete objects and lay them on top of each other.',
			'Strokes must never cross: where a form is hidden behind another, break the hidden line and leave at least 1 unit of clearance. Keep at least 1.5 units of empty space between strokes that are not meant to touch. Fewer, larger shapes beat many small ones.',
			`House style: stroke width ${profile.strokeWidth}; mostly ${profile.painted === 'fill' ? 'filled shapes' : 'outlined strokes'}; usual elements: ${profile.elements.slice(0, 6).join(', ') || 'path'}.`,
			profile.examples.length > 0
				? `Examples from this library:\n${profile.examples.map((item) => `- ${item.name}: ${item.svg}`).join('\n')}`
				: '',
			references.length > 0
				? `Icons for the same subject from other libraries. Study how they arrange it, then draw it yourself in our house style — do not copy their path data:\n${references.map((item) => `- ${item.label} (${item.source}): ${item.svg}`).join('\n')}`
				: '',
			'Do not think out loud and do not explain: answer immediately with the three lines below and nothing else.',
			'Answer with exactly three lines and nothing else:',
			'name: <short kebab-case English name>',
			'rule: <one sentence: what it is, when to use it, when NOT to, and what a user might call it>',
			'svg: <the complete <svg>…</svg> on one line>',
		].filter(Boolean).join('\n')
		let text = ''
		try {
			const stream = llm.stream({
				provider: route.provider,
				model: route.model,
				system,
				messages: [{
					role: 'user',
					content: [{
						type: 'text',
						text: retry && retry.previous
							? `Draw this icon: ${prompt}\n\nThe previous attempt was wrong: ${retry.problem || 'it does not read as one clean shape'}. Here it is:\n${retry.previous}\n\nDraw a better version that fixes exactly that problem.`
							: `Draw this icon: ${prompt}`,
					}],
				}],
				maxTokens: budget,
				signal: controller.signal,
				...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
			})
			for await (const chunk of stream) {
				if (!chunk) continue
				if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
				if (chunk.type === 'block-end' && text === '' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') text = chunk.block.text
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') return '!error'
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'max-tokens' && text === '') return '!max-tokens'
			}
		} catch (_error) {
			return ''
		} finally {
			clearTimeout(timer)
		}
		return text
	}

	/**
	 * Draw one icon from a prompt. The answer is checked against the same rules
	 * every library icon already meets; a drawing that breaks them is refused
	 * here rather than saved and discovered later.
	 */
	async function sketchIcon(scope, sessionId, prompt, profile, retry = null, references = []) {
		const llm = scope.get('llm')
		if (!llm || typeof llm.stream !== 'function') return { error: 'no-llm' }
		const route = resolveModelRoute(scope, sessionId)
		if (!route) return { error: 'no-model' }
		// Reasoning models spend completion budget before the answer starts: retry
		// once with more room instead of failing the whole draft on the first cap.
		let answer = ''
		for (const budget of [8000, 12000]) {
			answer = await streamIcon(scope, route, sessionId, prompt, profile, retry, references, budget)
			if (answer !== '!max-tokens' && answer !== '') break
		}
		if (answer === '!error') return { error: 'model-error' }
		if (answer === '!max-tokens') return { error: 'max-tokens' }
		if (answer === '') return { error: 'empty-answer' }
		const raw = /<svg\b[\s\S]*?<\/svg>/iu.exec(answer)?.[0] ?? ''
		if (raw === '') return /<svg\b/iu.test(answer) ? { error: 'truncated' } : { error: 'unreadable' }
		const issues = generatedIconIssues(raw)
		if (issues.length > 0) return { error: 'rejected', issues }
		let normalized
		try {
			const viewBox = /viewBox="([^"]+)"/u.exec(raw)?.[1]
			normalized = normalizeSvg(raw, viewBox ? { viewBox } : undefined)
		} catch (_error) {
			return { error: 'bad-svg' }
		}
		const name = cleanName(/^\s*name\s*:\s*(.+)$/mi.exec(answer)?.[1] ?? '')
		const rule = (/^\s*rule\s*:\s*(.+)$/mi.exec(answer)?.[1] ?? '').trim().slice(0, 280)
		return {
			svg: normalized.svg,
			viewBox: normalized.viewBox,
			name: name === '' ? 'icon' : name,
			rule,
			elements: normalized.elements ? normalized.elements.length : 0,
			// Pairs of shapes laid through each other: the usual reason a generated
			// composite looks broken. A warning, not a refusal — some designs join.
			crossings: strokeCrossings(normalized.svg),
		}
	}

/** Best-effort auto naming + rule. The user can always edit both. */
	async function inferSuggestion(scope, sessionId, svg) {
		const llm = scope.get('llm')
		if (!llm || typeof llm.stream !== 'function') return { error: 'no-llm' }
		const route = resolveModelRoute(scope, sessionId)
		if (!route) return { error: 'no-model' }
		for (const budget of [2000, 6000]) {
			const answer = await streamSuggestion(scope, route, sessionId, svg, budget)
			if (answer === '!max-tokens') continue
			if (answer === '!error') return { error: 'model-error' }
			if (answer === '') return { error: 'empty-answer' }
			const parsed = /\{[\s\S]*\}/u.exec(answer)
			if (parsed) {
				try {
					const value = JSON.parse(parsed[0])
					const name = cleanName(String(value.name || ''))
					const rule = typeof value.rule === 'string' ? value.rule.trim().slice(0, 280) : ''
					if (name !== '') return { name, rule }
				} catch (_error) { /* fall through to the loose extraction */ }
			}
			// The model sometimes wraps the JSON in prose or mangles it: pull the
			// two fields out by hand before giving up.
			const name = cleanName(/["']name["']\s*:\s*["']([^"']+)/u.exec(answer)?.[1] ?? '')
			const rule = /["']rule["']\s*:\s*["']([\s\S]*?)["']\s*[,}]/u.exec(answer)?.[1] ?? ''
			if (name !== '') return { name, rule: rule.trim().slice(0, 280) }
			const loose = cleanName(String(answer).trim().split(/\s+/u)[0] || '')
			if (loose !== '') return { name: loose, rule: '' }
			return { error: 'unreadable' }
		}
		return { error: 'max-tokens' }
	}

	/** Build the root-bound filesystem port the store and generator share. */
	function makeIo(scope, root) {
		const fs = scope.get('fs')
		const sandboxPolicy = scope.get('sandboxPolicy')
		let mode = 'workspace-write'
		try {
			const current = sandboxPolicy && typeof sandboxPolicy.resolve === 'function' ? sandboxPolicy.resolve() : null
			if (current && typeof current.mode === 'string') mode = current.mode
		} catch (_error) {
			/* keep the deployment default */
		}
		const policy = { mode, workspaceRoot: root }
		return {
			root,
			async readText(rel) {
				const target = await fs.resolve(rel, { cwd: root })
				const info = await fs.stat(target)
				if (!info || info.type !== 'file') return null
				return fs.readText(target)
			},
			async writeText(rel, text) {
				const target = await fs.resolve(rel, { cwd: root })
				await fs.writeText(target, text, undefined, undefined, policy)
			},
			async stat(rel) {
				try {
					const target = await fs.resolve(rel, { cwd: root })
					const info = await fs.stat(target)
					return info ? { type: info.type, size: info.size } : null
				} catch (_error) {
					return null
				}
			},
			async listDir(rel) {
				const target = await fs.resolve(rel, { cwd: root })
				const entries = await fs.listDir(target)
				return entries.map((entry) => ({ name: entry.name, type: entry.type, size: entry.size }))
			},
		}
	}

	/** Candidate workspace roots, from explicit request to deployment default. */
	async function candidates(scope) {
		const sessions = scope.get('sessions')
		const registry = scope.get('workspaceRegistry')
		const sandboxPolicy = scope.get('sandboxPolicy')
		const workingDirectory = scope.get('workingDirectory')
		const list = []
		const push = (value) => {
			if (typeof value !== 'string' || value === '') return
			if (!path.isAbsolute(value)) return
			if (!list.includes(value)) list.push(value)
		}
		try {
			const workspaces = registry && typeof registry.list === 'function' ? registry.list() : []
			const sorted = [...workspaces].sort((left, right) => {
				const a = left && typeof left.updatedAt === 'string' ? left.updatedAt : ''
				const b = right && typeof right.updatedAt === 'string' ? right.updatedAt : ''
				return b.localeCompare(a)
			})
			for (const workspace of sorted) push(workspace && workspace.path)
		} catch (_error) {
			/* no registry in this profile */
		}
		try {
			const live = sessions && typeof sessions.list === 'function' ? sessions.list() : []
			for (const session of [...live].reverse()) {
				const cwd = session && session.header ? session.header.cwd : undefined
				push(cwd)
			}
		} catch (_error) {
			/* ignore */
		}
		try {
			if (sandboxPolicy && typeof sandboxPolicy.resolve === 'function') {
				const current = sandboxPolicy.resolve()
				push(current && current.workspaceRoot)
			}
		} catch (_error) {
			/* ignore */
		}
		try {
			if (workingDirectory && typeof workingDirectory.defaultDirectory === 'string') push(workingDirectory.defaultDirectory)
		} catch (_error) {
			/* ignore */
		}
		return list
	}

	/**
	 * Walk up from `start` to the project that owns .icons.json (or .git/).
	 *
	 * The io port is root-bound, so every step needs its own port: the previous
	 * version asked the *same* relative path 40 times, which found nothing above
	 * the start directory and made a session cwd below its project root miss the
	 * library. Results are memoised briefly because this runs on every request.
	 */
	const projectRootMemo = new Map()
	async function projectRoot(scope, start) {
		if (typeof start !== 'string' || start === '') return ''
		const memo = projectRootMemo.get(start)
		if (memo && Date.now() - memo.at < 5000) return memo.root
		let current = start
		for (let depth = 0; depth < 12; depth += 1) {
			const io = makeIo(scope, current)
			try {
				if (await io.stat(`${MANIFEST_FILE}`)) { projectRootMemo.set(start, { at: Date.now(), root: current }); return current }
				if (await io.stat(`${LIB_DIR}/manifest.json`)) { projectRootMemo.set(start, { at: Date.now(), root: current }); return current }
				if (await io.stat('.git')) { projectRootMemo.set(start, { at: Date.now(), root: current }); return current }
			} catch (_error) {
				/* an unreadable ancestor is not a project marker */
			}
			const parent = path.dirname(current)
			if (!parent || parent === current) break
			current = parent
		}
		projectRootMemo.set(start, { at: Date.now(), root: start })
		return start
	}

	/**
	 * No path is special.
	 *
	 * This used to exclude this plugin's own package whenever its source lived
	 * inside the workspace — a guard for the plugin developer's checkout. But a
	 * normal user never has the package there, so the rule only ever changed the
	 * behaviour of one unusual layout: it made the library pretend a real project
	 * in the workspace did not exist. A workspace is a workspace.
	 */
	function excludeFor(root) {
		// This package's own directory is never project code, even when the plugin
		// lives inside the workspace (it does in this repo). Scanning it would list
		// the plugin's own bundle as a derivation of the user's icons, and a save
		// would then rewrite the plugin itself.
		const out = []
		try {
			const relative = path.relative(path.resolve(root), PACKAGE_DIR)
			if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
				out.push(relative.split(path.sep).join('/'))
			}
		} catch (_error) { /* nothing to exclude */ }
		return out
	}

	/**
	 * Resolve the library root for one request.
	 * Explicit `workspace` wins (validated against the allowed roots), then the
	 * caller's session cwd, then the most recent workspace.
	 */
	async function resolveRoot(scope, { workspace, sessionId, walkUp = true } = {}, known = null) {
		const all = known || await candidates(scope)
		if (all.length === 0) throw Object.assign(new Error('no workspace available'), { code: 'unknown-workspace' })
		let base = ''
		if (typeof workspace === 'string' && workspace !== '') {
			const resolved = path.resolve(workspace)
			let allowed = all.some((candidate) => resolved === candidate || resolved.startsWith(`${candidate}${path.sep}`))
			if (!allowed) {
				// A session cwd may sit below its project root; the panel sends the
				// resolved root back, so accept an ancestor that really carries the
				// project markers instead of rejecting the second request.
				const ancestor = all.some((candidate) => candidate.startsWith(`${resolved}${path.sep}`))
				if (ancestor) {
					const probe = makeIo(scope, resolved)
					allowed = !!(await probe.stat(`${MANIFEST_FILE}`)) || !!(await probe.stat(`${LIB_DIR}/manifest.json`)) || !!(await probe.stat('.git'))
				}
			}
			if (!allowed) throw Object.assign(new Error(`workspace not allowed: ${workspace}`), { code: 'unknown-workspace' })
			base = resolved
		} else if (typeof sessionId === 'string' && sessionId !== '') {
			const sessions = scope.get('sessions')
			const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
			const cwd = session && session.header ? session.header.cwd : undefined
			base = typeof cwd === 'string' && cwd !== '' ? cwd : all[0]
		} else {
			base = all[0]
		}
		if (!walkUp) return base
		return projectRoot(scope, base)
	}

	function storeFor(scope, root) {
		return createStore(makeIo(scope, root))
	}

	/** Library entries that draw the same shape under another name. */
	async function sameShapeEntries(io, store, graphic) {
		const wanted = bodySignature(graphic.svg)
		if (wanted === '') return []
		const { entries } = await store.list()
		const out = []
		for (const entry of entries) {
			if (entry.name === graphic.entry.name) continue
			let text = null
			try {
				text = await readEntrySvg(io, entry)
			} catch (_error) {
				continue
			}
			if (text === null) continue
			if (bodySignature(text) === wanted) out.push({ name: entry.name, rule: entry.rule })
		}
		return out
	}

	/**
	 * Workspace scans are the one expensive thing here: they read every UI file,
	 * so the result is shared instead of recomputed per click.
	 *
	 *   scanCache    the shape groups the "add from workspace" view lists
	 *   pointerCache where one icon's drawing already lives, keyed by shape
	 *
	 * Both are bounded by a short TTL and dropped whenever the library changes;
	 * an explicit rescan bypasses them.
	 */
	const SCAN_TTL = 60 * 1000
	const scanCache = new Map()
	const pointerCache = new Map()
	// Normalised signatures for entries saved before `signature` existed. Keyed by
	// content hash so an edit naturally misses; bounded so a churn-heavy library
	// cannot grow it forever.
	const legacySignatureCache = new Map()
	// The registry check is shared by every panel: six hours is plenty for a
	// version hint, and a failed attempt waits ten minutes before trying again.
	const UPDATE_TTL = 6 * 60 * 60 * 1000
	const UPDATE_RETRY = 10 * 60 * 1000
	let updateState = { at: 0, latest: '', registry: '' }

	function forgetScans(root) {
		scanCache.delete(root)
		for (const key of [...pointerCache.keys()]) {
			if (key.startsWith(`${root}\u0000`)) pointerCache.delete(key)
		}
	}

	async function workspaceScan(io, root, { force = false } = {}) {
		const hit = scanCache.get(root)
		if (!force && hit && Date.now() - hit.at < SCAN_TTL) return hit.groups
		const groups = await scanCodeShapes(io, { exclude: excludeFor(root) })
		scanCache.set(root, { at: Date.now(), groups })
		return groups
	}

	/** Pointer sites for one drawing, from cache when the shape was just scanned. */
	async function scanPointers(io, root, svg) {
		const key = `${root}\u0000${bodySignature(svg)}`
		const hit = pointerCache.get(key)
		if (hit && Date.now() - hit.at < SCAN_TTL) return hit
		const stats = {}
		const pointers = await findShapePointers(io, svg, { exclude: excludeFor(root), stats })
		const value = { at: Date.now(), pointers, files: stats.files ?? 0 }
		pointerCache.set(key, value)
		return value
	}

	/* ───────────────────────────── agent tools ───────────────────────────── */

	ctx.inject(['tools', 'fs', 'sessions'], (scope) => {
		const tools = scope.get('tools')
		if (!tools) return

		/** Character-bigram overlap: a cheap "closest" for a miss, not a search. */
		const closeness = (query, entry) => {
			const text = entry.rule || ''
			const haystack = `${entry.name} ${text}`.toLowerCase()
			const needle = query.toLowerCase()
			if (needle === '') return 0
			if (needle.length < 2) return haystack.includes(needle) ? 1 : 0
			const grams = (value) => {
				const out = new Set()
				for (let index = 0; index < value.length - 1; index += 1) out.add(value.slice(index, index + 2))
				return out
			}
			const want = grams(needle)
			const have = grams(haystack)
			let shared = 0
			for (const gram of want) if (have.has(gram)) shared += 1
			return want.size === 0 ? 0 : shared / want.size
		}

		const truncate = (text, max = 140) => {
			const value = String(text ?? '').replace(/\s+/g, ' ').trim()
			return value.length <= max ? value : `${value.slice(0, max - 1)}…`
		}

		const listTool = {
			name: 'icon_list',
			description: [
				"List this workspace's own icon library (`.icons.json`) as a compact index: name, viewBox and a truncated 应用规则, never SVG bodies.",
				'Call it first for any icon need — close, chevron, search, trash, empty state — before writing SVG paths by hand.',
				'Search matches name and rule, so `关闭` and `close` can both hit one graphic. If nothing matches, report the miss and list the closest candidates; never substitute a generic icon silently.',
				'Then call `icon_get` with the chosen name for the SVG and the full rule.',
			].join(' '),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					query: { type: 'string', description: 'Free text matched against name and rule (case-insensitive; Chinese or English).' },
					limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum rows to return (default 20).' },
				},
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						text: { type: 'string' },
						total: { type: 'integer' },
						returned: { type: 'integer' },
					},
					required: ['text'],
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const root = await resolveRoot(scope, { sessionId: sessionIdOf(exec) })
				const store = storeFor(scope, root)
				const { exists, entries } = await store.list()
				if (!exists) {
					return {
						total: 0,
						returned: 0,
						text: `No graphics library yet: ${MANIFEST_FILE} does not exist in ${root}.\nCreate the first icon in the right-sidebar Icons tab, or call icon_save with an SVG. Do not hand-write SVG paths yet.`,
					}
				}
				const rawQuery = args && typeof args.query === 'string' ? refName(args.query) : ''
				const queryText = rawQuery.trim().toLowerCase()
				const limit = Math.max(1, Math.min(200, Number(args && args.limit) || 20))
				const scored = []
				for (const entry of entries) {
					let score = 0
					if (queryText !== '') {
						const name = entry.name.toLowerCase()
						if (name === queryText) score += 100
						else if (name.includes(queryText)) score += 40
						if (entry.rule.toLowerCase().includes(queryText)) score += 10
						if (score === 0) continue
					}
					scored.push({ entry, score })
				}
				scored.sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
				const picked = scored.slice(0, limit)
				const lines = []
				lines.push(`${picked.length} of ${entries.length} icons in ${MANIFEST_FILE} (${root})${queryText ? ` matching "${queryText}"` : ''}.`)
				for (const { entry } of picked) {
					lines.push(`- <${entry.name}> ${entry.viewBox}\n  ${truncate(entry.rule || '（未填写描述）')}`)
				}
				if (picked.length === 0) {
					lines.push('Nothing matched. Report the miss and list the closest candidates instead of inventing a graphic.')
					const near = entries
						.map((entry) => ({ entry, score: closeness(queryText, entry) }))
						.filter((item) => item.score > 0)
						.sort((left, right) => right.score - left.score)
						.slice(0, 8)
						.map((item) => item.entry.name)
					if (near.length > 0) lines.push(`Candidates: ${near.map((name) => `<${name}>`).join(', ')}`)
				}
				return {
					total: entries.length,
					returned: picked.length,
					text: lines.join('\n'),
				}
			},
		}

		const getTool = {
			name: 'icon_get',
			description: [
				"Fetch one icon from this workspace's `.icons.json` by name (English or Chinese): clean SVG source, full 应用规则 and palette.",
				'Call `icon_list` first. Inline the SVG so it inherits currentColor; never `<img src="*.svg">`.',
				'`format`: svg (default), inline, file (repo path), datauri (large artwork), module (ESM export).',
			].join(' '),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string', description: 'Icon name exactly as icon_list reported it, e.g. "close" or "关闭".' },
					format: { type: 'string', enum: ['svg', 'inline', 'file', 'datauri', 'module'], description: 'How to deliver the graphic (default svg).' },
				},
				required: ['name'],
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						text: { type: 'string' },
						name: { type: 'string' },
						viewBox: { type: 'string' },
					},
					required: ['text'],
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const root = await resolveRoot(scope, { sessionId: sessionIdOf(exec) })
				const store = storeFor(scope, root)
				// `<name:modifier>` addresses a variant of an icon: a style that must
				// exist as its own drawing, or a stroke weight this drawing can take.
				const name = normalizeName(refName(args && args.name))
				let graphic
				try {
					graphic = await store.get(name)
				} catch (error) {
					if (error && error.code === 'not-found') {
						const { entries } = await store.list()
						const candidates = entries
							.map((entry) => ({ entry, score: closeness(name, entry) }))
							.filter((item) => item.score > 0)
							.sort((left, right) => right.score - left.score)
							.slice(0, 10)
							.map((item) => item.entry.name)
						const hint = candidates.length > 0 ? ` Candidates: ${candidates.map((item) => `<${item}>`).join(', ')}.` : ''
						throw Object.assign(new Error(`No graphic named "${name}" in ${MANIFEST_FILE}.${hint} Do not substitute a generic icon without telling the user.`), { code: 'not-found' })
					}
					throw error
				}
				const { entry, svg } = graphic
				const format = typeof args?.format === 'string' ? args.format : 'svg'
				const usage = entry.palette.length <= 1
					? 'Single-colour art: inline it so `currentColor` follows the text colour; never `<img src="...svg">`.'
					: 'Multi-colour art: inline or load it as a file/image; it keeps its own colours.'
				let body = svg
				if (format === 'datauri') {
					body = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
				} else if (format === 'module') {
					body = `// ${entry.name} (${entry.viewBox})\nexport default ${JSON.stringify(svg)}\n`
				} else if (format === 'file') {
					body = `${MANIFEST_FILE}`
				}
				const lines = []
				lines.push(`<${entry.name}> · ${entry.viewBox} · inline (${MANIFEST_FILE})`)
				lines.push(entry.rule === '' ? '应用规则: (none yet — call icon_annotate once you know what it is for)' : `应用规则: ${entry.rule}`)
				if (entry.palette.length > 0) lines.push(`Palette: ${entry.palette.join(', ')}`)
				lines.push(`Usage: ${usage}`)
				lines.push(`In conversation, refer to it as <${entry.name}>.`)
				lines.push('')
				if (format === 'file') lines.push(`Path: ${body}`)
				else lines.push('```svg', body.replace(/\n+$/, ''), '```')
				return {
					name: entry.name,
					viewBox: entry.viewBox,
					text: lines.join('\n'),
				}
			},
		}

		const saveTool = {
			name: 'icon_save',
			description: [
				"Save an icon into this workspace's `.icons.json` (create or overwrite by name). Dedupes by content hash.",
				'`name` is the identity, unique in the library. `rule` (应用规则: what it is, when to use it, when not to) is how later agents pick it — write one.',
				'Identical artwork under another name is refused and the reply names the existing icon.',
			].join(' '),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string', description: 'Unique identity; English or Chinese (e.g. close / 关闭).' },
					svg: { type: 'string', description: 'Full SVG markup, or path data is not enough — pass the <svg>…</svg> document.' },
					rule: { type: 'string', description: 'Optional 应用规则 (application rule): when to use it and when NOT to. One or two sentences.' },
					source: { type: 'string', description: 'Optional provenance (figma, lucide, hand-drawn…).' },
					license: { type: 'string', description: 'Optional license of imported artwork.' },
					previousName: { type: 'string', description: 'Rename this existing graphic instead of creating another one.' },
				},
				required: ['name', 'svg'],
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						text: { type: 'string' },
						name: { type: 'string' },
						file: { type: 'string' },
					},
					required: ['text'],
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const root = await resolveRoot(scope, { sessionId: sessionIdOf(exec) })
				const store = storeFor(scope, root)
				const result = await store.save({
					name: refName(args?.name),
					previousName: args?.previousName === undefined ? undefined : refName(args.previousName),
					svg: args?.svg,
					rule: args?.rule ?? args?.note,
					source: args?.source,
					license: args?.license,
				})
				if (result.status === 'duplicate') {
					return {
						name: result.name,
						text: `Not saved: an identical graphic already exists as "${result.of}" (same normalised hash).${result.rule ? ` Its 应用规则: ${result.rule}` : ''} Reference that one instead of duplicating it.`,
					}
				}
				let cascade = 0
				if (result.from) {
					try {
						cascade = (await cascadeRename(makeIo(scope, root), result.from, result.entry.name, { exclude: excludeFor(root) })).count
					} catch (_error) {
						cascade = 0
					}
				}
				let pointers = 0
				try {
					const io = makeIo(scope, root)
					// One walk, one read of each file: a create matches the artwork as
					// it was pasted (normalisation moves coordinates), an edit matches
					// the stored drawing the workspace copies now follow.
					const pasted = typeof args?.svg === 'string' && args.svg.trim() !== '' ? args.svg : ''
					const wanted = result.created && pasted !== '' ? pasted : (result.svg ?? '')
					const found = await findShapePointers(io, wanted, { exclude: excludeFor(root) })
					const merged = new Map()
					for (const pointer of [...(await store.pointers(result.entry.name)), ...found]) {
						merged.set(`${pointer.kind}:${pointer.file}:${pointer.index}`, pointer)
					}
					const list = [...merged.values()]
					await store.setPointers(result.entry.name, list)
					pointers = list.length
					if (!result.created) await pushShapePointers(io, result.svg ?? '', list)
					forgetScans(root)
				} catch (_error) { pointers = 0 }
				const lines = []
				lines.push(result.status === 'unchanged'
					? `Unchanged: <${result.entry.name}> already had this exact content.`
					: `${result.status === 'renamed' ? `Renamed <${result.from}> -> <${result.entry.name}>` : `Saved <${result.entry.name}>`} ${result.entry.viewBox}.`)
				lines.push(`Storage: inline in ${MANIFEST_FILE}`)
				lines.push(`Elements: ${result.elements?.length ?? 0}.`)
				if (cascade > 0) lines.push(`Rewrote @asset/component references in ${cascade} file(s).`)
				if (pointers > 0) lines.push(`Pointers: ${pointers} site(s) in the workspace reference this shape and will follow future edits.`)
				if (result.warnings && result.warnings.length > 0) lines.push(`Warnings: ${result.warnings.join('; ')}`)
				return {
					name: result.entry.name,
					file: `${MANIFEST_FILE}`,
					text: lines.join('\n'),
				}
			},
		}

		const annotateTool = {
			name: 'icon_annotate',
			description: [
				'Rewrite only the 应用规则 of an existing icon; the SVG is untouched.',
				'Use it after consuming an icon when you learned something durable: a better name for its job, an alias people will search for, or a case where it must NOT be used.',
			].join(' '),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					name: { type: 'string', description: 'Existing graphic name.' },
					rule: { type: 'string', description: 'The full replacement 应用规则 (not a delta); an empty string clears it.' },
				},
				required: ['name'],
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: { text: { type: 'string' }, name: { type: 'string' } },
					required: ['text'],
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const root = await resolveRoot(scope, { sessionId: sessionIdOf(exec) })
				const store = storeFor(scope, root)
				const result = await store.annotate({ name: refName(args?.name), rule: args?.rule ?? args?.note })
				return {
					name: result.entry.name,
					text: `Annotated <${result.entry.name}>. SVG untouched.`,
				}
			},
		}

		scope.effect(() => tools.register(listTool), 'dsh-icon-studio: icon_list')
		scope.effect(() => tools.register(getTool), 'dsh-icon-studio: icon_get')
		scope.effect(() => tools.register(saveTool), 'dsh-icon-studio: icon_save')
		scope.effect(() => tools.register(annotateTool), 'dsh-icon-studio: icon_annotate')
	})

	/* ───────────────────────────── HTTP routes ───────────────────────────── */

	ctx.inject(['webServer', 'fs', 'sessions'], (scope) => {
		const webServer = scope.get('webServer')
		if (!webServer) return

		const route = (name, handler) => {
			scope.effect(
				() => webServer.register({
					kind: 'exact',
					path: `${API}/${name}`,
					handler: (req, res) => {
						Promise.resolve(handler(req, res)).catch((err) => {
							if (!res.headersSent) error(res, err)
						})
					},
				}),
				`dsh-icon-studio: ${name} route`,
			)
		}

		route('state', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const workspace = params.get('workspace') ?? undefined
			const sessionId = params.get('sessionId') ?? undefined
			const all = await candidates(scope)
			const root = await resolveRoot(scope, { workspace, sessionId }, all)
			const io = makeIo(scope, root)
			const store = createStore(io)
			const { exists, entries, revision: libraryRevision } = await store.list()
			const revision = revisionToken(root, libraryRevision)
			// A poll carries the revision it already has. When nothing changed the
			// answer is a few bytes instead of every drawing, and the panel keeps
			// the state it rendered — no re-render, no re-parse.
			const since = params.get('since') ?? ''
			if (exists && since !== '' && since === revision) {
				return ok(res, { root, libraryExists: true, unchanged: true, revision, target: 'inline', version: PLUGIN_VERSION })
			}
			const graphics = []
			for (const entry of entries) {
				let svg = ''
				try {
					svg = (await readEntrySvg(io, entry)) ?? ''
				} catch (_error) {
					svg = ''
				}
				// Only what the grid draws. `pointers` is the largest per-icon
				// record and belongs to the detail view, which asks for it.
				graphics.push({
					name: entry.name,
					viewBox: entry.viewBox,
					rule: entry.rule,
					source: entry.source,
					origin: entry.origin,
					hash: entry.hash,
					version: entry.version,
					pushed: entry.pushed,
					createdAt: entry.createdAt,
					updatedAt: entry.updatedAt,
					// Where the shape is used, without the tracked path data: the
					// grid needs the sites for the delete confirmation, and `literal`
					// (a full `d`) is fetched only by the detail view.
					pointers: entry.pointers.map((pointer) => ({ file: pointer.file, kind: pointer.kind, line: pointer.line, index: pointer.index })),
					svg,
				})
			}
			ok(res, {
				root,
				libraryExists: exists,
				revision,
				version: PLUGIN_VERSION,
				graphics,
			})
		})

		route('update', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const now = Date.now()
			const fresh = updateState.latest !== '' && now - updateState.at < UPDATE_TTL
			const retryLater = updateState.latest === '' && now - updateState.at < UPDATE_RETRY
			if (!fresh && !retryLater) {
				const found = await latestPublished({ name: PLUGIN_NAME })
				updateState = {
					at: now,
					latest: found ? found.version : '',
					registry: found ? found.registry : '',
				}
			}
			const latest = updateState.latest
			ok(res, {
				current: PLUGIN_VERSION,
				latest,
				available: latest !== '' && isNewer(latest, PLUGIN_VERSION),
				registry: updateState.registry,
				checkedAt: updateState.at,
			})
		})

		route('graphic', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const root = await resolveRoot(scope, { workspace: params.get('workspace') ?? undefined, sessionId: params.get('sessionId') ?? undefined })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const graphic = await store.get(params.get('name') ?? '')
			// Opening an icon used to re-index the whole workspace and rewrite the
			// manifest on every click. The pointer list is already recorded when the
			// icon is saved, so it is served from the entry: the scan only runs for
			// a legacy entry that has never been indexed, or when asked explicitly
			// (`?rescan=1`).
			let pointers = Array.isArray(graphic.entry.pointers) ? graphic.entry.pointers : []
			const stats = {}
			const wantScan = params.get('rescan') === '1' || !graphic.entry.scannedAt
			if (wantScan) {
				try {
					const found = await scanPointers(io, root, graphic.svg)
					stats.files = found.files
					// The scan is the truth: replace the recorded list instead of
					// merging, so stale entries from older scans cannot linger.
					await store.setPointers(graphic.entry.name, found.pointers)
					pointers = found.pointers
				} catch (error) {
					console.warn('[dsh-icon-studio] pointer scan failed', error)
				}
			}
			let duplicates = []
			try {
				duplicates = await sameShapeEntries(io, store, graphic)
			} catch (_error) { duplicates = [] }
			ok(res, {
				root,
				entry: { ...graphic.entry, pointers },
				svg: graphic.svg,
				elements: graphic.elements,
				draft: null,
				duplicates,
				scan: { files: stats.files ?? 0, found: pointers.length, root },
			})
		})

		route('inspect', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.inspect({ svg: body.svg, preserveViewBox: body.preserveViewBox === true })
			ok(res, result)
		})

		route('init', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.init()
			forgetScans(root)
			ok(res, { root, created: result.created, file: MANIFEST_FILE })
		})

		route('save', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			let name = typeof body.name === 'string' ? refName(body.name) : ''
			let inferred = null
			if (name.trim() === '' && body.useHint === true) {
				const hint = nameHintFromMarkup(body.svg)
				if (hint !== '') {
					const { entries } = await store.list()
					let candidate = hint
					let index = 2
					while (entries.some((entry) => entry.name === candidate)) {
						candidate = `${hint}-${index}`
						index += 1
					}
					name = candidate
					inferred = { name: candidate, source: 'markup' }
				}
			}
			const result = await store.save({
				name,
				previousName: typeof body.previousName === 'string' ? refName(body.previousName) : body.previousName,
				svg: body.svg,
				elements: body.elements,
				rule: body.rule ?? body.note,
				source: body.source,
				license: body.license,
				viewBox: body.viewBox,
				allowDuplicate: body.allowDuplicate === true,
			})
			let cascade = 0
			if (result.from) {
				try {
					cascade = (await cascadeRename(io, result.from, result.entry.name, { exclude: excludeFor(root) })).count
				} catch (_error) {
					cascade = 0
				}
			}
			// Every @asset copy follows the source without asking: the panel is the
			// single place an icon is edited, so stale copies are never wanted.
			let synced = { replaced: 0, files: [] }
			let pointers = []
			if (result.entry) {
				try {
					const applied = await applyAsset(io, result.entry.name, result.svg ?? '', [], { exclude: excludeFor(root), hash: shortHash(result.entry.hash) })
					synced = { replaced: applied.replaced, files: applied.files }
				} catch (_error) { /* a project without copies needs nothing */ }
				// Pointers: the same shape may already live in the workspace (a paste
				// usually comes from there). Link it, and keep every linked site in
				// step with the library, so an edit never has to be repeated by hand.
				try {
					// One walk: a create matches the artwork as it was pasted
					// (normalisation crops the canvas, so the exported SVG no longer
					// has the coordinates the project's copies still use); an edit
					// matches the stored drawing the copies now follow.
					const pasted = typeof body.svg === 'string' && body.svg.trim() !== '' ? body.svg : ''
					const wanted = result.created && pasted !== '' ? pasted : (result.svg ?? '')
					const found = await findShapePointers(io, wanted, { exclude: excludeFor(root) })
					// Existing pointers survive an edit: they follow the icon, not the
					// old shape, and the new artwork is pushed into them below.
					const merged = new Map()
					for (const pointer of [...(await store.pointers(result.entry.name)), ...found]) {
						merged.set(`${pointer.kind}:${pointer.file}:${pointer.index}`, pointer)
					}
					pointers = [...merged.values()]
					const recorded = await store.setPointers(result.entry.name, pointers)
					result.entry.pointers = recorded.pointers
					result.entry.scannedAt = recorded.scannedAt
					// Only an edit pushes: creating an icon must never rewrite code.
					if (!result.created) {
						// The panel lets the user uncheck references: those sites keep
						// their old artwork for this save, but stay tracked.
						const skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : [])
						const targets = pointers.filter((pointer) => !skip.has(`${pointer.kind}:${pointer.file}:${pointer.index}`))
						const pushed = await pushShapePointers(io, result.svg ?? '', targets)
						synced = { replaced: synced.replaced + pushed.rewritten, files: [...synced.files, ...pushed.files] }
					}
				} catch (_error) { /* scanning is best-effort */ }
			}
			forgetScans(root)
			ok(res, {
				root,
				status: result.status,
				from: result.from,
				inferred,
				dedupe: result.status === 'duplicate' ? result.of : null,
				entry: result.entry,
				svg: result.svg ?? null,
				elements: result.elements ?? null,
				warnings: result.warnings ?? [],
				cascade,
				synced,
				pointers,
			})
		})

		route('order', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.reorder(body.names)
			forgetScans(root)
			ok(res, { root, entries: result.entries })
		})

		route('scan', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			// Walking the workspace is the expensive part; the host keeps the
			// answer for a minute and every caller shares it. `force` is the
			// panel's explicit "scan again" press.
			const groups = await workspaceScan(io, root, { force: body.force === true })
			const excluded = typeof groups.excluded === 'number' ? groups.excluded : 0
			const { entries } = await store.list()
			const known = new Map()
			for (const entry of entries) {
				let sig = entry.signature
				if (sig === '') {
					// Legacy entry: normalise it once and remember, so the marker shows
					// up after an upgrade without a re-save.
					const key = entry.hash || `${entry.name}\u0000${entry.updatedAt}`
					sig = legacySignatureCache.get(key)
					if (sig === undefined) {
						let text = null
						try {
							text = await readEntrySvg(io, entry)
						} catch (_error) {
							text = null
						}
						sig = ''
						if (text !== null) {
							try {
								sig = bodySignature(normalizeSvg(text).svg)
							} catch (_error) {
								sig = ''
							}
						}
						if (legacySignatureCache.size > 2000) legacySignatureCache.clear()
						legacySignatureCache.set(key, sig)
					}
				}
				if (sig !== '' && !known.has(sig)) known.set(sig, entry.name)
			}
			ok(res, {
				root,
				excluded,
				groups: groups.map((group) => ({ ...group, existing: known.get(group.signature) ?? null })),
			})
		})

		/* ── supply: one browser over Iconify and IconMCP ───────────── */

		const ICONIFY_API = 'https://api.iconify.design'
		// IconMCP is an original MIT icon library served over MCP (streamable
		// HTTP, no auth). Its search is semantic, which ours cannot be before
		// rules exist — so it is a supply source here, never a second identity:
		// `.icons.json` stays the single source of truth, and nothing is fetched
		// at build time.
		const SUPPLY_TTL = 30 * 60 * 1000
		const iconmcp = createIconmcpClient()

		/**
		 * Shape identity for a remote/local pair. A remote answer carries paint on
		 * the root; the stored body keeps the authored markup (a wrapping <g>).
		 * Normalising both sides is what lets "already in the library" work at all.
		 */
		const shapeSignatureOf = (text) => {
			if (typeof text !== 'string' || text.trim() === '') return ''
			const viewBox = /viewBox="([^"]+)"/u.exec(text)?.[1]
			try {
				return bodySignature(normalizeSvg(text, viewBox ? { viewBox } : undefined).svg)
			} catch (_error) {
				return bodySignature(text)
			}
		}

		/** Remote answers are immutable enough for a session. */
		const supplyCache = new Map()
		const cachedSupply = async (key, load) => {
			const hit = supplyCache.get(key)
			if (hit && Date.now() - hit.at < SUPPLY_TTL) return hit.data
			const data = await load()
			supplyCache.set(key, { data, at: Date.now() })
			return data
		}

		const iconifyJson = (pathname) => cachedSupply(`iconify:${pathname}`, async () => {
			const response = await fetch(`${ICONIFY_API}${pathname}`)
			if (!response.ok) throw new Error(`iconify ${response.status}`)
			return response.json()
		})

		/**
		 * Some sets declare a smaller grid than their artwork actually uses (e.g.
		 * energy-icons says 20x20 while its paths reach x=45), which crops the
		 * preview. Expand the canvas to cover both the declared size and the real
		 * geometry, never shrinking it.
		 */
		function iconifyLayout(body, width, height, left = 0, top = 0) {
			let maxX = left + width
			let maxY = top + height
			let minX = left
			let minY = top
			for (const match of body.matchAll(/\sd="([^"]+)"/gu)) {
				try {
					const box = pathBBox(match[1])
					if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.width)) continue
					minX = Math.min(minX, box.x)
					minY = Math.min(minY, box.y)
					maxX = Math.max(maxX, box.x + box.width)
					maxY = Math.max(maxY, box.y + box.height)
				} catch (_error) { /* unparsable path: keep the declared grid */ }
			}
			const viewBox = `${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`
			return { viewBox }
		}

		function iconifySvg(item, width, height) {
			const left = Number(item.left) || 0
			const top = Number(item.top) || 0
			const body = bakeIconifyTransform(item.body, width, height, {
				left,
				top,
				hFlip: item.hFlip === true,
				vFlip: item.vFlip === true,
				rotate: item.rotate,
			})
			const { viewBox } = iconifyLayout(item.body, width, height, left, top)
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`
		}

		route('library-collections', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			// `iconmcp.sets()` must not be shadowed by the settled result: naming
			// them *Result also keeps the TDZ out of the initialiser.
			const [iconifyResult, iconmcpResult] = await Promise.allSettled([
				iconifyJson('/collections'),
				iconmcp.sets(),
			])
			const warnings = []
			let iconifyList = []
			if (iconifyResult.status === 'fulfilled' && iconifyResult.value) {
				iconifyList = Object.entries(iconifyResult.value)
					.map(([prefix, info]) => ({
						prefix,
						name: info && info.name ? info.name : prefix,
						total: info && typeof info.total === 'number' ? info.total : 0,
						category: info && info.category ? info.category : '',
						license: info && info.license && info.license.spdx ? info.license.spdx : '',
						samples: info && Array.isArray(info.samples) ? info.samples.slice(0, 6) : [],
						source: 'iconify',
					}))
					.sort((left, right) => right.total - left.total)
			} else {
				warnings.push('iconify unavailable')
			}
			const iconmcpList = iconmcpResult.status === 'fulfilled' ? iconmcpResult.value : []
			if (iconmcpResult.status !== 'fulfilled') warnings.push('iconmcp unavailable')
			// IconMCP first: a curated 58-set house library; Iconify's long tail follows.
			ok(res, {
				collections: [...iconmcpList, ...iconifyList],
				sources: [
					{ id: 'iconmcp', label: 'IconMCP', license: 'MIT' },
					{ id: 'iconify', label: 'Iconify', license: '' },
				],
				warnings,
			})
		})

		route('library-search', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const q = String(params.get('query') || '').trim()
			if (q === '') return ok(res, { icons: [], meta: {} })
			const prefix = String(params.get('prefix') || '').trim()
			const limit = Math.min(96, Math.max(1, Number(params.get('limit')) || 48))
			const scope = prefix === '' ? null : parseSupplyRef(`${prefix}:x`)
			const icons = []
			const meta = {}
			const seen = new Set()
			const push = (item) => {
				if (seen.has(item.icon)) return
				seen.add(item.icon)
				icons.push(item.ref)
				meta[item.ref] = { label: item.label || '', tags: item.tags || [], source: item.source }
			}
			const tasks = []
			if (!scope || scope.source === 'iconmcp') {
				// Semantic first: these hits tolerate typos and rank the base icon
				// above its variants, which a substring match cannot do.
				tasks.push(iconmcp.search(q, scope ? scope.set : '', limit)
					.then((rows) => rows.forEach((row) => push({ ...row, source: 'iconmcp' })))
					.catch(() => {}))
			}
			if (!scope || scope.source === 'iconify') {
				const iconifyPrefix = scope ? scope.set : ''
				const search = `/search?query=${encodeURIComponent(q)}&limit=${limit}${iconifyPrefix ? `&prefix=${encodeURIComponent(iconifyPrefix)}` : ''}`
				tasks.push(iconifyJson(search).then((data) => {
					for (const full of Array.isArray(data.icons) ? data.icons : []) {
						const at = full.indexOf(':')
						if (at < 1) continue
						push({ ref: full, icon: full.slice(at + 1), label: '', tags: [], source: 'iconify' })
					}
				}).catch(() => {}))
			}
			await Promise.all(tasks)
			ok(res, { icons: icons.slice(0, limit), meta })
		})

		route('library-set', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const prefix = String(params.get('prefix') || '').trim()
			if (prefix === '') return json(res, 400, { status: 'error', error: { code: 'missing-prefix' } })
			const offset = Math.max(0, Number(params.get('offset')) || 0)
			const limit = Math.min(96, Math.max(1, Number(params.get('limit')) || 48))
			const ref = parseSupplyRef(`${prefix}:x`)
			if (ref.source === 'iconmcp') {
				// `format=svg` is the fast path: one get_set draws the whole page,
				// where one get_icon per card would take eight seconds.
				const wantSvg = params.get('format') === 'svg'
				const data = await iconmcp.json('get_set', {
					id: ref.set || 'generic',
					format: wantSvg ? 'svg' : 'list',
					offset,
					limit,
				})
				const list = Array.isArray(data.icons) ? data.icons : []
				// Names stay bare, exactly like an Iconify set: the client owns the
				// `prefix:` part, so it is added in one place only.
				const payload = {
					prefix,
					total: Number(data.total) || list.length,
					offset,
					names: list.map((item) => item.name),
				}
				if (wantSvg) {
					payload.icons = Object.fromEntries(
						list
							.filter((item) => item && typeof item.name === 'string' && typeof item.svg === 'string')
							.map((item) => [`${prefix}:${item.name}`, item.svg]),
					)
				}
				return ok(res, payload)
			}
			const data = await iconifyJson(`/collection?prefix=${encodeURIComponent(prefix)}`)
			const names = []
			if (Array.isArray(data.uncategorized)) names.push(...data.uncategorized)
			for (const list of Object.values(data.categories || {})) {
				if (Array.isArray(list)) names.push(...list)
			}
			ok(res, { prefix, total: names.length, offset, names: names.slice(offset, offset + limit) })
		})

		/**
		 * Preview art for a page of sets. Iconify ships `samples` with its
		 * collection list; IconMCP does not, so one `get_set` (format svg) is the
		 * cheapest way to draw three cards — one request per set, not one per icon.
		 */
		route('library-samples', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const prefixes = Array.isArray(body.prefixes)
				? body.prefixes.filter((item) => typeof item === 'string').slice(0, 32)
				: []
			const samples = {}
			const queue = prefixes.map((prefix) => parseSupplyRef(`${prefix}:x`)).filter((ref) => ref && ref.source === 'iconmcp')
			const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
				for (;;) {
					const ref = queue.shift()
					if (ref === undefined) return
					try {
						const data = await iconmcp.json('get_set', {
							id: ref.set || 'generic',
							format: 'svg',
							limit: 3,
						})
						const icons = Array.isArray(data.icons) ? data.icons : []
						samples[ref.prefix] = icons
							.filter((item) => item && typeof item.name === 'string' && typeof item.svg === 'string')
							.map((item) => ({ name: item.name, svg: item.svg }))
					} catch (_error) {
						// A set without previews still opens; only the card is plainer.
					}
				}
			})
			await Promise.all(workers)
			ok(res, { samples })
		})

		route('library-fetch', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const names = Array.isArray(body.names) ? body.names.filter((item) => typeof item === 'string') : []
			const iconifyByPrefix = new Map()
			const iconmcpIcons = []
			for (const full of names.slice(0, 48)) {
				const ref = parseSupplyRef(full)
				if (!ref) continue
				if (ref.source === 'iconmcp') {
					iconmcpIcons.push(ref)
					continue
				}
				if (!iconifyByPrefix.has(ref.prefix)) iconifyByPrefix.set(ref.prefix, [])
				iconifyByPrefix.get(ref.prefix).push(ref.icon)
			}
			const icons = {}
			await Promise.all([
				(async () => {
					for (const [prefix, list] of iconifyByPrefix) {
						const data = await iconifyJson(`/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(list.join(','))}`)
						const width = data.width || 24
						const height = data.height || 24
						for (const icon of list) {
							const item = data.icons && data.icons[icon]
							if (!item || typeof item.body !== 'string') continue
							icons[`${prefix}:${icon}`] = iconifySvg(item, width, height)
						}
					}
				})().catch(() => {}),
				(async () => {
					if (iconmcpIcons.length === 0) return
					const svgs = await iconmcp.svgs(iconmcpIcons.map((ref) => ref.icon))
					for (const ref of iconmcpIcons) {
						const svg = svgs.get(ref.icon)
						if (typeof svg === 'string' && svg !== '') icons[`${ref.prefix}:${ref.icon}`] = svg
					}
				})().catch(() => {}),
			])
			// Which of these remote drawings already exist locally? Compare shapes,
			// not names: an icon may have been imported under another name or pasted
			// in from somewhere else.
			const localByShape = new Map()
			try {
				const { entries } = await store.list()
				for (const entry of entries) {
					let text = null
					try {
						text = await readEntrySvg(io, entry)
					} catch (_error) {
						continue
					}
					if (text === null) continue
					const sig = shapeSignatureOf(text)
					if (sig !== '' && !localByShape.has(sig)) localByShape.set(sig, entry.name)
				}
			} catch (_error) { /* a missing library just means no matches */ }
			const matches = {}
			for (const [full, svg] of Object.entries(icons)) {
				// Normalise the remote copy exactly like a saved icon before comparing:
				// remote bodies often inherit paint from a <g>, which the local blob
				// has already flattened onto its elements.
				const hit = localByShape.get(shapeSignatureOf(svg))
				if (hit) matches[full] = hit
			}
			ok(res, { icons, matches })
		})

		/**
		 * One remote drawing, ready to store: the authored SVG plus the canvas it
		 * was drawn on, and — from IconMCP only — a first rule and provenance.
		 * Nothing here renames or reshapes the artwork beyond normalisation.
		 */
		async function supplyIcon(ref, style = 'outline') {
			if (ref.source === 'iconmcp') {
				const { svg, meta } = await iconmcp.icon(ref.icon, style)
				if (svg === '') return null
				const canvas = svgCanvasSize(svg, 16)
				return {
					svg,
					width: canvas.width,
					height: canvas.height,
					rule: seedRule(meta.label, meta.tags),
					source: `iconmcp:${meta.set || ref.set || ''}`,
					license: 'MIT',
				}
			}
			const data = await iconifyJson(`/${encodeURIComponent(ref.prefix)}.json?icons=${encodeURIComponent(ref.icon)}`)
			const item = data.icons && data.icons[ref.icon]
			if (!item || typeof item.body !== 'string') return null
			const width = data.width || 24
			const height = data.height || 24
			return {
				svg: iconifySvg(item, width, height),
				width,
				height,
				rule: '',
				source: `iconify:${ref.prefix}`,
				license: '',
			}
		}

		/**
		 * What the add panel needs before anything is written: the drawing, the
		 * name and rule to suggest, and whether this supplier can draw a second
		 * style. A style that renders identical artwork is not offered.
		 */
		route('library-peek', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const ref = parseSupplyRef(body.ref)
			if (!ref) return json(res, 400, { status: 'error', error: { code: 'missing-ref' } })
			const outline = await supplyIcon(ref, 'outline')
			if (!outline) return json(res, 404, { status: 'error', error: { code: 'not-found' } })
			let solid = null
			if (ref.source === 'iconmcp') {
				try {
					const alt = await supplyIcon(ref, 'solid')
					// Same artwork means the supplier has no solid drawing; offering it
					// would import an outline under a solid label.
					if (alt && alt.svg !== outline.svg) solid = alt
				} catch (_error) { solid = null }
			}
			const suggested = (outline.rule || '').trim()
			const { entries } = await store.list()
			const taken = entries.find((entry) => entry.name === ref.icon)
			ok(res, {
				ref: `${ref.prefix}:${ref.icon}`,
				source: outline.source,
				license: outline.license,
				supplier: ref.source,
				name: ref.icon,
				rule: suggested,
				hasRule: suggested !== '',
				styles: solid ? ['outline', 'solid'] : ['outline'],
				previews: solid ? { outline: outline.svg, solid: solid.svg } : { outline: outline.svg },
				taken: taken ? taken.name : '',
			})
		})

		route('library-import', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const action = body.action === 'replace' || body.action === 'rename' ? body.action : ''
			// The add panel decides the name, the rule and the style; a bare `names`
			// list keeps the old automatic behaviour for callers that have no panel.
			const wanted = Array.isArray(body.items) && body.items.length > 0
				? body.items.filter((item) => item && typeof item.ref === 'string').slice(0, 50)
				: (Array.isArray(body.names) ? body.names.filter((item) => typeof item === 'string') : [])
					.map((full) => ({ ref: full }))
			const results = []
			for (const item of wanted) {
				const full = item.ref
				const ref = parseSupplyRef(full)
				if (!ref) continue
				const base = typeof item.name === 'string' && item.name.trim() !== ''
					? normalizeName(item.name)
					: `${ref.prefix}:${ref.icon}`
				const style = item.style === 'solid' ? 'solid' : 'outline'
				try {
					const remote = await supplyIcon(ref, ref.source === 'iconmcp' ? style : 'outline')
					if (!remote) {
						results.push({ name: full, status: 'missing' })
						continue
					}
					const viewBox = `0 0 ${remote.width} ${remote.height}`
					// Provenance travels with the artwork; the rule does not. Replacing a
					// drawing must never overwrite a rule a human (or an agent) wrote.
					const provenance = {
						...(remote.source ? { source: remote.source } : {}),
						...(remote.license ? { license: remote.license } : {}),
						origin: full,
					}
					const rule = typeof item.rule === 'string' ? item.rule.trim() : remote.rule
					const extra = {
						...(rule ? { rule } : {}),
						...provenance,
					}
					const { entries } = await store.list()
					const sameName = entries.find((entry) => entry.name === base)
					if (sameName) {
						let local = ''
						try {
							local = (await readEntrySvg(io, sameName)) || ''
						} catch (_error) { local = '' }
						if (local !== '' && shapeSignatureOf(local) === shapeSignatureOf(remote.svg)) {
							results.push({ name: full, status: 'same', local: base })
							continue
						}
						if (action === 'replace') {
							await store.save({
								name: base,
								previousName: base,
								svg: remote.svg,
								viewBox,
								allowDuplicate: true,
								...provenance,
							})
							results.push({ name: full, status: 'saved', local: base, replaced: true })
							continue
						}
						results.push({ name: full, status: 'name-conflict', of: base })
						continue
					}
					const inspected = await store.inspect({ svg: remote.svg, preserveViewBox: true })
					if (inspected.duplicate) {
						if (action === 'rename') {
							const target = entries.find((entry) => entry.name === inspected.duplicate)
							if (target) {
								let local = ''
								try {
									local = (await readEntrySvg(io, target)) || ''
								} catch (_error) { local = '' }
								if (local !== '') {
									await store.save({
										name: base,
										previousName: target.name,
										svg: local,
										viewBox: target.viewBox,
										allowDuplicate: true,
									})
									results.push({ name: full, status: 'saved', local: base, renamedFrom: target.name })
									continue
								}
							}
						}
						results.push({ name: full, status: 'shape-conflict', of: inspected.duplicate })
						continue
					}
					const saved = await store.save({
						name: base,
						svg: remote.svg,
						viewBox,
						...extra,
					})
					// Never report success without checking what actually happened.
					if (saved.status === 'duplicate') {
						results.push({ name: full, status: 'shape-conflict', of: saved.of })
					} else {
						results.push({ name: full, status: 'saved', local: base })
					}
				} catch (error) {
					results.push({ name: full, status: 'error', message: error && error.message ? error.message : String(error) })
				}
			}
			ok(res, { root, results })
		})

		route('suggest', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			let sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
			if (sessionId === '') {
				try {
					const sessions = scope.get('sessions')
					const live = sessions && typeof sessions.list === 'function' ? sessions.list() : []
					const last = live[live.length - 1]
					if (last && typeof last.id === 'string') sessionId = last.id
				} catch (_error) { /* no live session: no model */ }
			}
			const suggestion = await inferSuggestion(scope, sessionId, String(body.svg || ''))
			ok(res, {
				root,
				suggestion: suggestion && suggestion.name ? { name: suggestion.name, rule: suggestion.rule || '' } : null,
				error: suggestion && suggestion.error ? suggestion.error : null,
			})
		})

		/**
		 * Icons of the same subject from the supply library. They are references
		 * for the model, never output: the answer is still drawn in this project's
		 * own style with its own path data.
		 */
		async function findReferences(query, limit = 3) {
			const out = []
			const push = (item) => {
				if (out.length >= limit) return
				if (out.some((existing) => existing.label === item.label && existing.source === item.source)) return
				out.push(item)
			}
			try {
				const hits = await iconmcp.search(query, '', limit)
				for (const hit of hits.slice(0, 2)) {
					try {
						const { svg } = await iconmcp.icon(hit.icon)
						if (svg !== '') push({ label: hit.label || hit.icon, source: 'iconmcp', svg: svg.slice(0, 1400) })
					} catch (_error) { /* one unreadable reference is fine */ }
				}
			} catch (_error) { /* offline: draw from the prompt alone */ }
			if (out.length < limit) {
				try {
					const data = await iconifyJson(`/search?query=${encodeURIComponent(query)}&limit=${limit}`)
					for (const full of (Array.isArray(data.icons) ? data.icons : []).slice(0, limit - out.length)) {
						const ref = parseSupplyRef(full)
						if (!ref) continue
						try {
							const art = await supplyIcon(ref)
							if (art && typeof art.svg === 'string' && art.svg !== '') {
								push({ label: ref.icon, source: 'iconify', svg: art.svg.slice(0, 1400) })
							}
						} catch (_error) { /* skip this one */ }
					}
				} catch (_error) { /* offline */ }
			}
			return out
		}

		/**
		 * AI create: draw one icon in this library's own style.
		 *
		 * Nothing is written here. The draft goes back to the paste dialog, where
		 * the user confirms name, rule and artwork — the same door every other
		 * icon comes through.
		 */
		route('ai-create', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const prompt = String(body.prompt || '').trim().slice(0, 500)
			if (prompt === '') {
				return json(res, 400, { status: 'error', error: { code: 'prompt-required', message: 'describe the icon first' } })
			}
			const previous = typeof body.previous === 'string' ? body.previous.slice(0, 8000) : ''
			const problem = typeof body.problem === 'string' ? body.problem.trim().slice(0, 200) : ''
			const profile = await styleProfile(io, store)
			const references = await findReferences(prompt)
			const draft = await sketchIcon(scope, body.sessionId, prompt, profile, previous === '' ? null : { previous, problem }, references)
			ok(res, {
				root,
				references: references.map((item) => ({ label: item.label, source: item.source })),
				profile: {
					canvas: profile.canvas,
					strokeWidth: profile.strokeWidth,
					painted: profile.painted,
					icons: profile.total,
				},
				...draft,
			})
		})

		route('delete', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.remove({ name: body.name })
			forgetScans(root)
			ok(res, {
				root,
				name: result.entry.name,
				file: `${MANIFEST_FILE}`,
				// Artwork lives inline in the manifest since format v3: deleting the
				// entry removes the drawing with it, so there is no loose file left.
				fileRemoved: true,
			})
		})

		route('derivations', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const graphic = await store.get(normalizeName(refName(body.name)))
			const excluded = excludeFor(root)
			const stored = Array.isArray(graphic.entry.pointers) ? graphic.entry.pointers : []
			// Pointers recorded before the plugin's own directory was excluded still
			// point into it; drop them here and persist the cleanup so the panel
			// never offers the plugin's own bundle as a derivative.
			const pointers = stored.filter((pointer) => !excluded.some((prefix) => pointer.file === prefix || pointer.file.startsWith(`${prefix}/`)))
			if (pointers.length !== stored.length) {
				try { await store.setPointers(graphic.entry.name, pointers) } catch (_error) { /* keep the cleaned view */ }
			}
			const all = await readDerivations(io, pointers, graphic.svg)
			ok(res, {
				name: graphic.entry.name,
				derivations: all.filter((item) => item.stale !== true),
				stale: all.filter((item) => item.stale === true).length,
			})
		})

	})

	/* ───────────────────────────── prompt rule ───────────────────────────── */

	ctx.inject(['systemPrompt'], (scope) => {
		scope.effect(
			() => scope.systemPrompt.section({ name: 'dsh-icon-studio', order: 640, text: RULE }),
			'dsh-icon-studio: graphic rule',
		)
	})
}

/** The calling Agent's session id, used to resolve that session's project root. */
function sessionIdOf(exec) {
	const id = exec && exec.agent && exec.agent.id
	return typeof id === 'string' ? id : undefined
}
