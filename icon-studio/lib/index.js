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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cascadeRename, applyAsset, scanUsage } from './assets.js'
import { findShapePointers, pushShapePointers, signature, bodySignature, scanCodeShapes } from './sync.js'
import { expandMask, normalizeSvg, pathBBox, bakeIconifyTransform } from './svg.js'
import { readFileSync as readJsonFile } from 'node:fs'

/** The 16-hex blob name, used as the marker's cache hint. */
function shortHash(hash) {
	return String(hash ?? '').replace(/^sha256:/u, '').slice(0, 16)
}

/** Shown in the panel footer; read once at load so a hot reload picks it up. */
const PLUGIN_VERSION = (() => {
	try {
		const url = new URL('../package.json', import.meta.url)
		return JSON.parse(readJsonFile(url, 'utf8')).version ?? ''
	} catch (_error) {
		return ''
	}
})()

import { createStore, readEntrySvg, entrySvg, LIB_DIR, MANIFEST_FILE, normalizeName, refName } from './store.js'

const API = '/api/dsh-icon-studio'

/** This package's own directory, so scans never rewrite its docs or fixtures. */
const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const RULE = [
	'This workspace has its own icon library in a hidden file `.icons.json` at the project root: names, descriptions and inline SVG bodies. Icons the user added there are the first-class choice: prefer them over any generic library.',
	'Whenever a task needs an icon or glyph — close, chevron, search, trash, empty-state mark — call `icon_list` first and consume a matching icon with `icon_get` instead of writing SVG paths by hand.',
	'Each icon has an 应用规则 (application rule) instead of a note: when to use it and when NOT to. `icon_list` returns truncated rules and `icon_get` returns the full one, so pick by meaning, not just by name.',
	'If nothing matches, say so explicitly and list the closest candidates; never silently substitute a generic icon library or an invented path.',
	'In conversation a name is written in angle brackets — `<删除>` means the icon named 删除 (names may be Chinese or English). Strip the brackets, then resolve that name with `icon_get`; never treat the brackets as part of the name. Business code consumes an icon by inlining the SVG that `icon_get` returns (single-colour, so it inherits `currentColor`; never `<img src="*.svg">`). Do not add markers to code: the library indexes shapes and rewrites every occurrence when the icon changes.',
	'When a used icon taught you something durable (a better name for its job, a case to avoid), call `icon_annotate` to improve its 应用规则.',
	'Pasting SVG markup into the chat is just text: do not import it unless the user explicitly asks. Importing belongs to the Icons panel.',
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

	/** One model round-trip: returns the answer text, or `!code` on failure. */
	async function streamName(scope, route, sessionId, svg, maxTokens) {
		const llm = scope.get('llm')
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), 15000)
		let text = ''
		try {
			const stream = llm.stream({
				provider: route.provider,
				model: route.model,
				system: 'You name icons. Reply with exactly one short name in the user\'s language (Chinese or English), no spaces, no punctuation, no angle brackets, and nothing else. No explanation, no code fences.',
				messages: [{
					role: 'user',
					content: [{ type: 'text', text: `This is an SVG icon:\n\n${String(svg).slice(0, 6000)}\n\nWhat is it? Reply with only its name.` }],
				}],
				maxTokens,
				signal: controller.signal,
				...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
			})
			for await (const chunk of stream) {
				if (!chunk) continue
				if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
				if (chunk.type === 'block-end' && text === '' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') text = chunk.block.text
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
					return `!${chunk.reason.failure && chunk.reason.failure.message ? chunk.reason.failure.message : 'error'}`
				}
				if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'max-tokens' && text === '') {
					return '!max-tokens'
				}
			}
		} catch (error) {
			return `!${error && error.message ? error.message : 'stream-failed'}`
		} finally {
			clearTimeout(timer)
		}
		return text
	}

	/**
	 * Ask the configured model what the shape is. Reasoning models can spend the
	 * first budget on reasoning, so one max-tokens finish retries with more room.
	 */
	async function inferNameFromModel(scope, sessionId, svg) {
		const llm = scope.get('llm')
		if (!llm || typeof llm.stream !== 'function') return ''
		const route = resolveModelRoute(scope, sessionId)
		if (!route) return ''
		for (const budget of [1500, 4000]) {
			const answer = await streamName(scope, route, sessionId, svg, budget)
			if (answer === '!max-tokens') continue
			if (answer.startsWith('!')) return answer
			const name = cleanName(String(answer).trim().split(/\s+/u)[0] || '')
			if (name !== '') return name
			return answer === '' ? '' : '!unreadable'
		}
		return '!max-tokens'
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

	/** Walk up from `start` to the project that owns .icons.json (or .git/). */
	async function projectRoot(io, start) {
		if (typeof start !== 'string' || start === '') return ''
		const seen = new Set()
		let current = start
		for (let depth = 0; depth < 40; depth += 1) {
			if (seen.has(current)) break
			seen.add(current)
			const hasManifest = await io.stat(`${MANIFEST_FILE}`)
			const hasGraphics = hasManifest
			if (hasGraphics || hasManifest) return current
			try {
				if (await io.stat('.git')) return current
			} catch (_error) {
				/* ignore */
			}
			const parent = path.dirname(current)
			if (!parent || parent === current) break
			current = parent
		}
		return start
	}

	/**
	 * Remove one workspace file. The Host filesystem service only reads and
	 * writes, so deletion goes through the managed subprocess with an argv list
	 * (no shell interpolation) under the same workspace.
	 */
	async function removeFile(scope, root, relative) {
		const fs = scope.get('fs')
		const subprocess = scope.get('subprocess')
		if (!fs || !subprocess) return false
		const target = await fs.resolve(relative, { cwd: root })
		const path = fs.processPath(target)
		const argv = process.platform === 'win32'
			? ['cmd', '/c', 'del', '/f', '/q', path]
			: ['rm', '--', path]
		const handle = subprocess.spawn({
			argv,
			cwd: root,
			stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
			graceMs: 2000,
		})
		const outcome = await handle.done
		return outcome.exitCode === 0
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
	function excludeFor(_root) {
		return []
	}

	/**
	 * Resolve the library root for one request.
	 * Explicit `workspace` wins (validated against the allowed roots), then the
	 * caller's session cwd, then the most recent workspace.
	 */
	async function resolveRoot(scope, { workspace, sessionId, walkUp = true } = {}) {
		const all = await candidates(scope)
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
		const io = makeIo(scope, base)
		return projectRoot(io, base)
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
				"List this workspace's own icon library (`.icons.json`) as a compact index.",
				'Call it FIRST for any icon or glyph need — close, chevron, search, trash, empty-state mark — before writing SVG paths by hand.',
				'Returns name, viewBox and a truncated description (the application rule); never SVG bodies.',
				'Search matches name and description, so `关闭` and `close` can both hit the same graphic when the description says so.',
				'If nothing matches, say so explicitly and list the closest candidates; never silently substitute a generic icon library.',
				'Then call `icon_get` with the chosen name to receive the SVG and the full rule.',
			].join(' '),
			parameters: {
				type: 'object',
				additionalProperties: false,
				properties: {
					query: { type: 'string', description: 'Free text matched against name and description (case-insensitive; Chinese or English).' },
					limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum rows to return (default 40).' },
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
				const limit = Math.max(1, Math.min(200, Number(args && args.limit) || 40))
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
				"Fetch one icon from this workspace's `.icons.json` library by name (English or Chinese).",
				'Returns the clean SVG source, the full description (when to use / when not to) and palette.',
				'Call `icon_list` first to find the name. Icons must be inlined so they inherit currentColor; never consume an icon through `<img src="*.svg">`.',
				'`format`: svg (default) returns markup; inline returns markup ready to paste; file returns the repo path; datauri returns a data: URL for large artwork; module returns an ESM export.',
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
						viewBox: { type: 'string' },
					},
					required: ['text'],
				},
				render: (_args, value) => [{ type: 'text', text: value.text }],
			},
			async execute(args, exec) {
				const root = await resolveRoot(scope, { sessionId: sessionIdOf(exec) })
				const store = storeFor(scope, root)
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
				"Save an icon into this workspace's `.icons.json` library (create or overwrite by name).",
				'Stores the SVG (IconifyIcon semantics: authored body + viewBox), dedupes by content hash and name, and updates `.icons.json`.',
				'`name` is required and must be unique in this library: it is the identity the agent and the business code refer to.',
				'`rule` is optional and recommended: the 应用规则 — what the icon means, when to use it and when NOT to. That text is how later agents choose correctly.',
				'Saving identical artwork under another name is refused; the reply points at the existing name and its rule.',
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
					const pasted = typeof args?.svg === 'string' && args.svg.trim() !== '' ? args.svg : (result.svg ?? '')
					const found = [
						...(await findShapePointers(io, result.svg ?? '', { exclude: excludeFor(root) })),
						...(result.created ? await findShapePointers(io, pasted, { exclude: excludeFor(root) }) : []),
					]
					const merged = new Map()
					for (const pointer of [...(await store.pointers(result.entry.name)), ...found]) {
						merged.set(`${pointer.kind}:${pointer.file}:${pointer.index}`, pointer)
					}
					const list = [...merged.values()]
					await store.setPointers(result.entry.name, list)
					pointers = list.length
					if (!result.created) await pushShapePointers(io, result.svg ?? '', list)
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
				'Rewrite only the description of an existing icon; the SVG is not touched.',
				'Use it after consuming an icon when you learned something durable: a better description of its job, an alias someone will search for, or a case where it must NOT be used.',
				'This is the mechanism that makes the library get better as it is used — prefer it over leaving the 应用规则 stale.',
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

		route('workspaces', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const all = await candidates(scope)
			const list = []
			for (const candidate of all) {
				const io = makeIo(scope, candidate)
				const base = path.basename(candidate) || candidate
				let library = false
				try {
					library = !!(await io.stat(`${MANIFEST_FILE}`))
				} catch (_error) {
					library = false
				}
				list.push({ path: candidate, title: base, library })
			}
			ok(res, { workspaces: list })
		})

		route('state', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const workspace = params.get('workspace') ?? undefined
			const sessionId = params.get('sessionId') ?? undefined
			const root = await resolveRoot(scope, { workspace, sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const { exists, entries } = await store.list()
			const graphics = []
			for (const entry of entries) {
				let svg = ''
				try {
					svg = (await readEntrySvg(io, entry)) ?? ''
				} catch (_error) {
					svg = ''
				}
				graphics.push({ ...entry, svg })
			}
			const all = await candidates(scope)
			ok(res, {
				root,
				libraryExists: exists,
				target: 'inline',
				version: PLUGIN_VERSION,
				graphics,
				workspaces: all.map((candidate) => ({ path: candidate, title: path.basename(candidate) || candidate })),
			})
		})

		route('graphic', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const root = await resolveRoot(scope, { workspace: params.get('workspace') ?? undefined, sessionId: params.get('sessionId') ?? undefined })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const graphic = await store.get(params.get('name') ?? '')
			// Opening an icon is the check: link every place that already draws this
			// shape (read-only for the code) and report same-shape names in the
			// library. Nothing here asks the user to push anything.
			let pointers = Array.isArray(graphic.entry.pointers) ? graphic.entry.pointers : []
			let duplicates = []
			const stats = {}
			try {
				const found = await findShapePointers(io, graphic.svg, { exclude: excludeFor(root), stats })
				// The scan is the truth: replace the recorded list instead of merging,
				// otherwise stale or duplicated entries from older scans live forever.
				await store.setPointers(graphic.entry.name, found)
				pointers = found
			} catch (error) {
				console.warn('[dsh-icon-studio] pointer scan failed', error)
			}
			try {
				duplicates = await sameShapeEntries(io, store, graphic)
			} catch (_error) { duplicates = [] }
			ok(res, {
				root,
				entry: { ...graphic.entry, pointers },
				svg: graphic.svg,
				elements: graphic.elements,
				draft: graphic.draft ?? null,
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

		route('create', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.create({ name: body.name, width: body.width, height: body.height })
			ok(res, { root, entry: result.entry, svg: result.svg, elements: result.elements })
		})

		route('init', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.init()
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
					// Match against the artwork as it was pasted: normalisation crops
					// the canvas, so the exported SVG no longer has the coordinates the
					// project's copies still use.
					const pasted = typeof body.svg === 'string' && body.svg.trim() !== '' ? body.svg : (result.svg ?? '')
					const found = [
						...(await findShapePointers(io, result.svg ?? '', { exclude: excludeFor(root) })),
						...(result.created ? await findShapePointers(io, pasted, { exclude: excludeFor(root) }) : []),
					]
					// Existing pointers survive an edit: they follow the icon, not the
					// old shape, and the new artwork is pushed into them below.
					const merged = new Map()
					for (const pointer of [...(await store.pointers(result.entry.name)), ...found]) {
						merged.set(`${pointer.kind}:${pointer.file}:${pointer.index}`, pointer)
					}
					pointers = [...merged.values()]
					await store.setPointers(result.entry.name, pointers)
					result.entry.pointers = pointers
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

		route('annotate', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.annotate({ name: refName(body.name), rule: body.rule ?? body.note })
			ok(res, { root, entry: result.entry })
		})

		route('order', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.reorder(body.names)
			ok(res, { root, entries: result.entries })
		})

		route('expand-mask', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const elements = expandMask({
				defs: body.defs,
				mask: body.mask,
				fill: body.fill,
				stroke: body.stroke,
				opacity: body.opacity,
			})
			ok(res, { elements })
		})

		route('suggest-name', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const graphic = await store.get(body.name)
			let sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
			if (sessionId === '') {
				try {
					const sessions = scope.get('sessions')
					const live = sessions && typeof sessions.list === 'function' ? sessions.list() : []
					const last = live[live.length - 1]
					if (last && typeof last.id === 'string') sessionId = last.id
				} catch (_error) { /* no live session */ }
			}
			const suggestion = await inferNameFromModel(scope, sessionId, graphic.svg)
			if (suggestion === '' || suggestion.startsWith('!')) {
				ok(res, { root, suggestion: '', error: suggestion.startsWith('!') ? suggestion.slice(1) : 'no-answer' })
				return
			}
			const { entries } = await store.list()
			let candidate = suggestion
			let index = 2
			while (entries.some((entry) => entry.name === candidate && entry.name !== graphic.entry.name)) {
				candidate = `${suggestion}-${index}`
				index += 1
			}
			ok(res, { root, suggestion: candidate })
		})

		route('scan', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const groups = await scanCodeShapes(io, { exclude: excludeFor(root) })
			const { entries } = await store.list()
			const known = new Map()
			for (const entry of entries) {
				let text = null
				try {
					text = await readEntrySvg(io, entry)
				} catch (_error) {
					continue
				}
				if (text === null) continue
				const sig = bodySignature(text)
				if (sig !== '' && !known.has(sig)) known.set(sig, entry.name)
			}
			ok(res, {
				root,
				groups: groups.map((group) => ({ ...group, existing: known.get(group.signature) ?? null })),
			})
		})

		/* ── Iconify import ─────────────────────────────────────────── */

		const ICONIFY_API = 'https://api.iconify.design'
		let iconifySets = null
		// Remote answers are immutable enough for a session: cache them so re-opening
		// the browser does not hit the network again.
		const iconifyCache = new Map()
		const ICONIFY_TTL = 30 * 60 * 1000

		async function iconifyJson(pathname) {
			const cached = iconifyCache.get(pathname)
			if (cached && Date.now() - cached.at < ICONIFY_TTL) return cached.data
			const response = await fetch(`${ICONIFY_API}${pathname}`)
			if (!response.ok) throw new Error(`iconify ${response.status}`)
			const data = await response.json()
			iconifyCache.set(pathname, { data, at: Date.now() })
			return data
		}

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

		function iconifySvg(prefix, item, width, height) {
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

		route('iconify-collections', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			if (iconifySets === null) {
				const all = await iconifyJson('/collections')
				iconifySets = Object.entries(all)
					.map(([prefix, info]) => ({
						prefix,
						name: info && info.name ? info.name : prefix,
						total: info && typeof info.total === 'number' ? info.total : 0,
						category: info && info.category ? info.category : '',
						license: info && info.license && info.license.spdx ? info.license.spdx : '',
						samples: info && Array.isArray(info.samples) ? info.samples.slice(0, 6) : [],
					}))
					.sort((left, right) => right.total - left.total)
			}
			ok(res, { collections: iconifySets })
		})

		route('iconify-search', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const q = String(params.get('query') || '').trim()
			if (q === '') return ok(res, { icons: [] })
			const prefix = String(params.get('prefix') || '').trim()
			const limit = Math.min(96, Math.max(1, Number(params.get('limit')) || 48))
			const search = `/search?query=${encodeURIComponent(q)}&limit=${limit}${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`
			const data = await iconifyJson(search)
			ok(res, { icons: Array.isArray(data.icons) ? data.icons : [] })
		})

		route('iconify-set', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const prefix = String(params.get('prefix') || '').trim()
			if (prefix === '') return json(res, 400, { status: 'error', error: { code: 'missing-prefix' } })
			const offset = Math.max(0, Number(params.get('offset')) || 0)
			const limit = Math.min(96, Math.max(1, Number(params.get('limit')) || 48))
			const data = await iconifyJson(`/collection?prefix=${encodeURIComponent(prefix)}`)
			const names = []
			if (Array.isArray(data.uncategorized)) names.push(...data.uncategorized)
			for (const list of Object.values(data.categories || {})) {
				if (Array.isArray(list)) names.push(...list)
			}
			ok(res, { prefix, total: names.length, offset, names: names.slice(offset, offset + limit) })
		})

		route('iconify-fetch', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const names = Array.isArray(body.names) ? body.names.filter((item) => typeof item === 'string') : []
			const byPrefix = new Map()
			for (const full of names.slice(0, 48)) {
				const at = full.indexOf(':')
				if (at < 1) continue
				const prefix = full.slice(0, at)
				const icon = full.slice(at + 1)
				if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
				byPrefix.get(prefix).push(icon)
			}
			const icons = {}
			await Promise.all([...byPrefix].map(async ([prefix, list]) => {
				const data = await iconifyJson(`/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(list.join(','))}`)
				const width = data.width || 24
				const height = data.height || 24
				for (const icon of list) {
					const item = data.icons && data.icons[icon]
					if (!item || typeof item.body !== 'string') continue
					icons[`${prefix}:${icon}`] = iconifySvg(prefix, item, width, height)
				}
			}))
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
					const sig = bodySignature(text)
					if (sig !== '' && !localByShape.has(sig)) localByShape.set(sig, entry.name)
				}
			} catch (_error) { /* a missing library just means no matches */ }
			const matches = {}
			for (const [full, svg] of Object.entries(icons)) {
				// Normalise the remote copy exactly like a saved icon before comparing:
				// remote bodies often inherit paint from a <g>, which the local blob
				// has already flattened onto its elements.
				let normalized = svg
				try {
					const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1]
					normalized = normalizeSvg(svg, viewBox ? { viewBox } : undefined).svg
				} catch (_error) { /* keep the raw copy */ }
				const hit = localByShape.get(bodySignature(normalized))
				if (hit) matches[full] = hit
			}
			ok(res, { icons, matches })
		})

		route('iconify-import', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const action = body.action === 'replace' || body.action === 'rename' ? body.action : ''
			const names = Array.isArray(body.names) ? body.names.filter((item) => typeof item === 'string').slice(0, 50) : []
			const results = []
			for (const full of names) {
				const at = full.indexOf(':')
				if (at < 1) continue
				const prefix = full.slice(0, at)
				const icon = full.slice(at + 1)
				const base = `${prefix}:${icon}`
				try {
					const data = await iconifyJson(`/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(icon)}`)
					const item = data.icons && data.icons[icon]
					if (!item || typeof item.body !== 'string') {
						results.push({ name: full, status: 'missing' })
						continue
					}
					const width = data.width || 24
					const height = data.height || 24
					const remote = iconifySvg(prefix, item, width, height)
					const viewBox = iconifyLayout(item.body, width, height, Number(item.left) || 0, Number(item.top) || 0).viewBox
					let pinnedRemote = remote
					try {
						pinnedRemote = normalizeSvg(remote, { viewBox }).svg
					} catch (_error) { /* keep the raw copy */ }
					const { entries } = await store.list()
					const sameName = entries.find((entry) => entry.name === base)
					if (sameName) {
						let local = ''
						try {
							local = (await readEntrySvg(io, sameName)) || ''
						} catch (_error) { local = '' }
						if (local !== '' && bodySignature(local) === bodySignature(pinnedRemote)) {
							results.push({ name: full, status: 'same', local: base })
							continue
						}
						if (action === 'replace') {
							await store.save({
								name: base,
								previousName: base,
								svg: remote,
								viewBox: `0 0 ${width} ${height}`,
								allowDuplicate: true,
							})
							results.push({ name: full, status: 'saved', local: base, replaced: true })
							continue
						}
						results.push({ name: full, status: 'name-conflict', of: base })
						continue
					}
					const inspected = await store.inspect({ svg: remote, preserveViewBox: true })
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
						svg: remote,
						viewBox: `0 0 ${width} ${height}`,
						source: `iconify:${prefix}`,
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

		route('delete', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const store = storeFor(scope, root)
			const result = await store.remove({ name: body.name })
			const fileRemoved = true
			// Layer 1 goes with the icon; a stale draft would resurrect the drawing.
			try {
				await removeFile(scope, root, draftPath(result.entry.name))
			} catch (_error) { /* no draft */ }
			ok(res, {
				root,
				name: result.entry.name,
				file: `${MANIFEST_FILE}`,
				fileRemoved,
			})
		})

		route('usage', async (req, res) => {
			if (req.method !== 'GET') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const params = query(req)
			const root = await resolveRoot(scope, { workspace: params.get('workspace') ?? undefined, sessionId: params.get('sessionId') ?? undefined })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const { entries } = await store.list()
			const usages = await scanUsage(io, entries.map((entry) => entry.name), { exclude: excludeFor(root) })
			ok(res, { root, usages })
		})

		route('apply', async (req, res) => {
			if (req.method !== 'POST') return json(res, 405, { status: 'error', error: { code: 'method-not-allowed' } })
			const body = await readBody(req)
			const root = await resolveRoot(scope, { workspace: body.workspace, sessionId: body.sessionId })
			const io = makeIo(scope, root)
			const store = createStore(io)
			const name = normalizeName(body.name)
			const graphic = await store.get(name)
			const warnings = []
			const result = await applyAsset(io, name, graphic.svg, warnings, { exclude: excludeFor(root), hash: shortHash(graphic.entry?.hash) })
			ok(res, { root, name, replaced: result.replaced, files: result.files, warnings })
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
