/**
 * Supply refs: how this plugin names a drawing that does not live in the
 * project yet.
 *
 * One remote icon is addressed by a single string, exactly the way a library
 * entry is addressed by its name:
 *
 *   Iconify -> `lucide:trash`            the prefix is the set id
 *   IconMCP -> `iconmcp-generic:trash`   the prefix carries the set
 *
 * Keeping one convention means the browser's grid, previews, selection and
 * import code stay shared instead of forking per supplier.
 *
 * Nothing here talks to the network: these are the pure decisions (which
 * supplier, which canvas, which first rule) that the host and the tests both
 * need.
 */

export const ICONMCP_PREFIX = 'iconmcp'

/** Parse a `<prefix>:<icon>` ref into its supplier and set. */
export function parseSupplyRef(ref) {
	if (typeof ref !== 'string') return null
	const at = ref.indexOf(':')
	if (at < 1) return null
	const prefix = ref.slice(0, at)
	const icon = ref.slice(at + 1)
	if (icon === '') return null
	if (prefix === ICONMCP_PREFIX) return { source: 'iconmcp', set: '', prefix, icon }
	if (prefix.startsWith(`${ICONMCP_PREFIX}-`)) {
		return { source: 'iconmcp', set: prefix.slice(ICONMCP_PREFIX.length + 1), prefix, icon }
	}
	return { source: 'iconify', set: prefix, prefix, icon }
}

/** The ref for one icon of one supplier set. */
export function supplyRef(source, set, icon) {
	if (typeof icon !== 'string' || icon === '') return ''
	if (source === 'iconmcp') return `${ICONMCP_PREFIX}-${set || 'generic'}:${icon}`
	return `${set}:${icon}`
}

/**
 * A remote label and its tags are the raw material of a first 应用规则 — the
 * one thing a catalogue can honestly hand us. "When NOT to use it" is project
 * knowledge and stays for `icon_annotate`.
 */
export function seedRule(label, tags) {
	const name = typeof label === 'string' ? label.trim() : ''
	const words = (Array.isArray(tags) ? tags : [])
		.filter((tag) => typeof tag === 'string' && tag.trim() !== '')
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag, index, all) => all.indexOf(tag) === index && tag !== name.toLowerCase())
		.slice(0, 6)
	if (name === '') return words.join(', ')
	return words.length > 0 ? `${name} — ${words.join(', ')}` : name
}

/**
 * The canvas a remote drawing was authored on. Without it an imported body is
 * drawn at the wrong scale: a 16-unit artwork stored on the default 24-unit
 * canvas comes out two thirds of its intended size, in the corner.
 */
export function svgCanvasSize(svg, fallback = 24) {
	const match = /viewBox="\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*"/u.exec(
		typeof svg === 'string' ? svg : '',
	)
	if (match) {
		const width = Number(match[1])
		const height = Number(match[2])
		if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
			return { width, height }
		}
	}
	return { width: fallback, height: fallback }
}

/** True for a local `source` value written by an import (not by hand). */
export function isImportedSource(source) {
	return typeof source === 'string' && (source.startsWith('iconify:') || source.startsWith('iconmcp:'))
}

/* ── IconMCP transport ──────────────────────────────────────────────── */

export const ICONMCP_MCP = 'https://iconmcp.com/mcp'

/**
 * A tiny MCP client for one tool surface: seven tools over streamable HTTP,
 * no auth, answers made of text blocks.
 *
 * `fetch`, `now` and `ttl` are injectable so the protocol can be tested with a
 * canned answer instead of a live server — the shapes that matter (a `get_icon`
 * answer is two blocks, an error arrives as JSON-RPC `error`) are pinned by
 * tests rather than by memory of a manual curl.
 */
export function createIconmcpClient(options = {}) {
	const doFetch = options.fetch ?? globalThis.fetch
	const now = options.now ?? (() => Date.now())
	const ttl = Number(options.ttl) > 0 ? Number(options.ttl) : 30 * 60 * 1000
	const cache = options.cache ?? new Map()

	/** Every call answers with text blocks; some tools send more than one. */
	const texts = async (tool, args) => {
		const key = `${tool}:${JSON.stringify(args)}`
		const hit = cache.get(key)
		if (hit && now() - hit.at < ttl) return hit.data
		const response = await doFetch(ICONMCP_MCP, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
		})
		if (!response.ok) throw new Error(`iconmcp ${response.status}`)
		const payload = await response.json()
		if (payload && payload.error) throw new Error(`iconmcp ${payload.error.message || 'error'}`)
		const content = payload && payload.result && Array.isArray(payload.result.content) ? payload.result.content : []
		const blocks = content
			.map((item) => (item && typeof item.text === 'string' ? item.text : ''))
			.filter((text) => text !== '')
		if (blocks.length === 0) throw new Error('iconmcp empty answer')
		cache.set(key, { data: blocks, at: now() })
		return blocks
	}

	const json = async (tool, args) => JSON.parse((await texts(tool, args))[0] || '{}')

	/** `get_icon` answers with the SVG, then a JSON description of the same icon. */
	const icon = async (name, style = 'outline') => {
		const blocks = await texts('get_icon', { name, format: 'svg', style, size: 24 })
		const svg = blocks.find((block) => block.trim().startsWith('<svg')) || ''
		let meta = {}
		const described = blocks.find((block) => block.trim().startsWith('{'))
		if (described) {
			try { meta = JSON.parse(described) } catch (_error) { meta = {} }
		}
		return { svg, meta }
	}

	const sets = async () => {
		const data = await json('list_sets', {})
		const list = Array.isArray(data.sets) ? data.sets : []
		return list.map((set) => ({
			prefix: `${ICONMCP_PREFIX}-${set.id}`,
			name: typeof set.label === 'string' ? set.label : set.id,
			total: Number(set.count) || 0,
			category: typeof set.group === 'string' ? set.group : '',
			description: typeof set.description === 'string' ? set.description : '',
			license: 'MIT',
			source: 'iconmcp',
			// Samples would need one get_icon call each; the set page fills previews.
			samples: [],
		}))
	}

	const search = async (query, set, limit) => {
		const args = { query, limit: Math.max(1, Math.min(50, limit)) }
		if (set !== '') args.set = set
		const data = await json('search_icons', args)
		const results = Array.isArray(data.results) ? data.results : []
		return results.map((item) => {
			const setId = typeof item.set === 'string' && item.set !== '' ? item.set : (set || 'generic')
			return {
				ref: `${ICONMCP_PREFIX}-${setId}:${item.name}`,
				icon: item.name,
				label: typeof item.label === 'string' ? item.label : '',
				tags: Array.isArray(item.tags) ? item.tags : [],
			}
		})
	}

	/**
	 * One drawing per request, so keep the fan-out narrow: a 48-card page must
	 * not open 48 sockets at once.
	 */
	const svgs = async (icons, style = 'outline') => {
		const out = new Map()
		const queue = icons.slice(0, 48)
		const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
			for (;;) {
				const name = queue.shift()
				if (name === undefined) return
				try {
					const { svg } = await icon(name, style)
					if (svg !== '') out.set(name, svg)
				} catch (_error) { /* one missing drawing must not sink the page */ }
			}
		})
		await Promise.all(workers)
		return out
	}

	return { texts, json, icon, sets, search, svgs }
}
