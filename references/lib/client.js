/**
 * Browser half of dsh-links-panel.
 *
 * A right-sidebar tab type named 「链接」: it scans the conversation this Session
 * has already loaded, collects every http(s) URL that ever appeared in it, groups
 * them into 资料 / 代码 / 工具 / 媒体 tags (a URL may carry several), and counts
 * occurrences. Clicking a row opens
 * the URL in the right sidebar's Browser tab; the ⌖ action scrolls the chat back
 * to the message that carried it.
 *
 * Loaded as a lazy-CJS client bundle: executing this file only registers a
 * factory; the module body runs when the plugin is materialized. `require` may
 * only name platform-baseline modules (react here) — the bundle must be
 * self-contained otherwise.
 *
 * @see package.json `dsh.client`
 */
window.__ModuleLoader__.load({
	id: 'dsh-links-panel',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const h = React.createElement

		/** This implementation's identity in the tab system, and the key its body registers under. */
		const ID = 'dsh-links-panel'
		/** The page-tab kind users open. */
		const KIND = 'links'
		/** The Browser tab kind this plugin opens URLs into. */
		const BROWSER_KIND = 'browser'

		/** The three kinds the panel groups links into, in display order. */
		/** The tag vocabulary, in display order. A row may carry several tags. */
		const TAGS = ['doc', 'code', 'tool', 'media']
		const TAG_LABEL = { doc: '资料', code: '代码', tool: '工具', media: '媒体' }
		const TAG_COLOR = { doc: '#4c8dff', code: '#a06bff', tool: '#3fb950', media: '#f0a020' }

		const EMPTY_SNAPSHOT = Object.freeze({ entries: Object.freeze([]), hasMore: false, revision: 0 })
		const EMPTY_MATCHES = Object.freeze([])

		// ------------------------------------------------------------------
		// URL grammar
		// ------------------------------------------------------------------

		/**
		 * One candidate URL: everything that is not whitespace, angle brackets,
		 * quotes, backticks, or CJK/full-width punctuation. Latin parentheses and
		 * brackets stay in so balanced ones survive; `trimTrailing` fixes those that
		 * belong to the surrounding prose (markdown `](…)`, sentences ending `.)`).
		 */
		const URL_RE = /https?:\/\/[^\s<>"'`\u3000-\u303f\uff00-\uffef[\]{}|\\^]+/gi

		/** Markdown link `[label](url)` — used only to borrow a display title. */
		const MD_LINK_RE = /\[([^\]\n]{0,300})\]\(\s*<?(https?:\/\/[^\s)>]{1,2048})>?\s*(?:"[^"]*")?\)/g

		/** A trailing run of sentence punctuation (Latin or CJK) that never belongs to a URL. */
		const TRAILING_PUNCT = /[.,;:!?'"…。，、；：！？》〉」』】〕）］｝”’．]+$/

		/** Query parameters that only carry campaign/share identity. */
		const TRACKING_PARAM_RE =
			/^(utm_[a-z0-9_]*|fbclid|gclid|dclid|yclid|msclkid|mc_cid|mc_eid|igshid|igsh|ref_src|ref_url|spm|scm|share_source|share_medium|share_plat|share_tag|share_from|_hsenc|_hsmi|vero_id|wickedid|oly_enc_id|oly_anon_id|__s|trk|trkcampaign|si|feature|vd_source)$/i

		/**
		 * Placeholder labels used by documentation and test fixtures: `acme.dev`,
		 * `foo.com`, `sub.acme.co.uk`, `demo.example` … A real page essentially never
		 * lives at one of these registrable names, and a conversation about code
		 * mentions them constantly, so they are not references.
		 */
		const PLACEHOLDER_LABELS = new Set([
			'acme', 'example', 'foo', 'bar', 'baz', 'qux', 'demo', 'sample', 'placeholder', 'dummy', 'test',
		])

		/**
		 * Reserved documentation names (RFC 2606 / RFC 6761). They never name a real
		 * page — test sessions, pasted fixtures and docs examples use them — so they
		 * never become references.
		 */
		const PLACEHOLDER_HOST_RE =
			/(^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost|acme\.dev|example\.dev)$/i

		/** Hosts that are pure API fronts: `api.github.com` (but not `api-docs.*`). */
		const API_HOST_RE = /^api\./
		/** First path segments that name an endpoint namespace rather than a page. */
		const API_SEGMENTS = new Set(['api', 'graphql', 'rest', 'rpc', 'openapi', 'swagger', 'jsapi', 'fetch'])
		/** Data files are payloads, not pages. */
		const API_DATA_EXT_RE = /\.(?:json|jsonl|ndjson)$/i

		/**
		 * Whether a URL is an API/fetch endpoint rather than a page someone reads.
		 * Only unambiguous shapes count: an `api`-prefixed host, an endpoint namespace
		 * as the first segment, a versioned `/v2/` path, or a JSON payload extension.
		 * @param {string} host - lowercase hostname.
		 * @param {string} pathname - parsed path.
		 * @returns {boolean} true when the URL should not be collected.
		 */
		function looksLikeApiEndpoint(host, pathname) {
			const path = (pathname || '').toLowerCase()
			// Documentation pages that merely live under `/api` or on a docs-flavoured host
			// are reading material, not endpoints.
			if (
				host.startsWith('docs.') ||
				host.startsWith('developer.') ||
				host.startsWith('learn.') ||
				path.indexOf('/docs/') >= 0 ||
				path.endsWith('/docs')
			) {
				return false
			}
			if (API_HOST_RE.test(host)) return true
			if (API_DATA_EXT_RE.test(path)) return true
			const first = path.split('/').filter(Boolean)[0]
			if (first !== undefined && API_SEGMENTS.has(first)) return true
			return false
		}

		/** A public hostname: dot-separated labels, no stray punctuation. */
		const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

		/** The final label of a public hostname: a TLD or a punycode TLD (`.dev`, `.xn--p1ai`). */
		const TLD_RE = /\.(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/

		/** Hosts that never leave the machine and so are never "references". */
		const PRIVATE_HOST_RE =
			/^(localhost|0\.0\.0\.0|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)$/i

		// ------------------------------------------------------------------
		// URL helpers
		// ------------------------------------------------------------------

		/**
		 * Drop the punctuation a sentence or markdown wrapper left on the end of a
		 * URL, including unbalanced closing parentheses.
		 * @param {string} value - raw match.
		 * @returns {string} the trimmed URL candidate.
		 */
		/**
		 * Shorten a long string by hiding its middle, keeping both ends readable.
		 * @param {string} text - source text.
		 * @param {number} [max] - maximum length before shortening.
		 * @returns {string} possibly shortened text.
		 */
		function middleEllipsis(text, max) {
			const value = String(text || '')
			const limit = typeof max === 'number' ? max : 48
			if (value.length <= limit) return value
			const head = Math.ceil((limit - 1) / 2)
			const tail = Math.floor((limit - 1) / 2)
			return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
		}

		function trimTrailing(value) {
			let out = value
			for (let pass = 0; pass < 4; pass += 1) {
				const before = out
				out = out.replace(TRAILING_PUNCT, '')
				if (out.endsWith(')')) {
					let open = 0
					let close = 0
					for (const ch of out) {
						if (ch === '(') open += 1
						else if (ch === ')') close += 1
					}
					while (out.endsWith(')') && close > open) {
						out = out.slice(0, -1)
						close -= 1
					}
				}
				if (out === before) break
			}
			return out
		}

		/**
		 * Whether a hostname addresses the local machine or a private network.
		 * @param {string} host - lowercase hostname.
		 * @returns {boolean} true when the URL must not be collected.
		 */
		function isPrivateHost(host) {
			if (host === '') return true
			const bare = host.replace(/^\[/, '').replace(/\]$/, '')
			if (PRIVATE_HOST_RE.test(bare)) return true
			// Numeric shorthand ("http://127") and reserved 0/8 ranges never name a public site.
			if (/^\d+$/.test(bare)) return true
			if (/^0\./.test(bare)) return true
			if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return true
			if (/^f[cd][0-9a-f]{2}:/i.test(bare)) return true
			if (bare.endsWith('.local') || bare.endsWith('.internal') || bare.endsWith('.localhost')) return true
			return false
		}

		/**
		 * Canonicalize one URL: lowercase host, drop tracking params, fragment,
		 * default port, duplicate slashes and trailing slash.
		 * @param {string} raw - candidate.
		 * @returns {{key: string, url: string, host: string, pathname: string} | null} the
		 *   canonical row, or null when the candidate is not a usable http(s) URL.
		 */
		/**
		 * System blocklist: hosts that are never references, whatever the path.
		 * - status/echo test services and request bins;
		 * - the fixture hosts used by this repository's own tests and docs.
		 * Placeholder word rules and structural rules live next to their checks.
		 */
		const SYSTEM_BLOCKED_HOST_RE =
			/(^|\.)(httpstat\.us|httpbin\.org|httpbingo\.org|requestbin\.net|requestcatcher\.com|webhook\.site|beeceptor\.com|postman-echo\.com|harness\.dev|hello\.dev|notexample\.com|a\.com|b\.com|c\.com)$/i

		/**
		 * One URL through the validity pipeline. Every rejection carries a stable code so
		 * the panel (and tests) can explain why a link is not a reference.
		 * @param {unknown} raw - candidate text.
		 * @returns {{url: string, key: string, host: string, pathname: string} | {reason: string}} the
		 *   canonical row or the rejection code.
		 */
		function inspectUrl(raw) {
			if (typeof raw !== 'string') return { reason: 'input' }
			const trimmed = trimTrailing(raw)
			if (!/^https?:\/\//i.test(trimmed)) return { reason: 'scheme' }
			let parsed
			try {
				parsed = new URL(trimmed)
			} catch (error) {
				return { reason: 'syntax' }
			}
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { reason: 'scheme' }
			const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
			if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return { reason: 'ip' }
			if (/^\[/.test(host)) return { reason: 'ip' }
			if (isPrivateHost(host)) return { reason: 'private' }
			if (!HOSTNAME_RE.test(host)) return { reason: 'host' }
			if (!TLD_RE.test(host)) return { reason: 'tld' }
			if (SYSTEM_BLOCKED_HOST_RE.test(host)) return { reason: 'blocklist' }
			if (PLACEHOLDER_HOST_RE.test(host)) return { reason: 'placeholder' }
			if (PLACEHOLDER_LABELS.has(rootDomain(host).split('.')[0])) return { reason: 'placeholder' }
			if (looksLikeApiEndpoint(host, parsed.pathname)) return { reason: 'api' }
			if (RESOURCE_EXT_RE.test(parsed.pathname)) return { reason: 'resource' }
			const params = []
			for (const [key, value] of parsed.searchParams) {
				if (TRACKING_PARAM_RE.test(key)) continue
				params.push([key, value])
			}
			let pathname = parsed.pathname.replace(/\/{2,}/g, '/')
			if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
			const search = params.length
				? '?' + params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
				: ''
			const port = parsed.port ? `:${parsed.port}` : ''
			const url = `${parsed.protocol}//${host}${port}${pathname}${search}`
			const key = `${host.replace(/^www\./, '')}${port}${pathname}${search}`
			return { key, url, host, pathname }
		}

		/**
		 * Canonicalize one URL for the list: host lowercased, tracking params, fragment,
		 * default port, duplicate slashes and trailing slash dropped.
		 * @param {unknown} raw - candidate.
		 * @returns {{key: string, url: string, host: string, pathname: string} | null} canonical row.
		 */
		function normalizeUrl(raw) {
			const result = inspectUrl(raw)
			return result.reason === undefined ? result : null
		}

		// ------------------------------------------------------------------
		// Classification
		// ------------------------------------------------------------------

		/** Hosts that are source code, repositories and programming Q&A. */
		const CODE_HOSTS = new Set([
			'github.com', 'gitlab.com', 'gitee.com', 'bitbucket.org', 'gist.github.com',
			'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com',
			'leetcode.cn', 'leetcode.com', 'sourcegraph.com',
			// Online coding tools are source code and a tool at the same time.
			'codepen.io', 'codesandbox.io', 'replit.com', 'jsfiddle.net', 'observablehq.com',
			'huggingface.co',
		])

		/** Hosts that are online tools, registries and product pages. */
		const TOOL_HOSTS = new Set([
			'npmjs.com', 'pypi.org', 'crates.io', 'packagist.org', 'rubygems.org', 'pkg.go.dev', 'nuget.org',
			'codepen.io', 'codesandbox.io', 'replit.com', 'jsfiddle.net', 'observablehq.com',
			'huggingface.co', 'kaggle.com',
			'figma.com', 'vercel.com', 'netlify.com', 'cloudflare.com', 'supabase.com',
			'linear.app', 'notion.so', 'airtable.com', 'trello.com', 'miro.com', 'canva.com',
			'excalidraw.com', 'draw.io',
		])

		const MEDIA_HOSTS = new Set([
			'youtube.com', 'm.youtube.com', 'youtu.be', 'bilibili.com', 'b23.tv',
			'vimeo.com', 'dailymotion.com', 'ted.com', 'v.qq.com', 'youku.com', 'iqiyi.com',
			'douyin.com', 'tiktok.com', 'instagram.com', 'x.com', 'twitter.com',
			'podcasts.apple.com', 'open.spotify.com', 'xiaoyuzhoufm.com', 'music.163.com',
			'soundcloud.com', 'figma.com', 'dribbble.com', 'behance.net', 'unsplash.com',
			'pinterest.com', 'artstation.com', '500px.com',
		])

		/**
		 * Static asset files: images, icons, fonts, styles, media files and archives are
		 * files to download, not pages that reference anything.
		 */
		const RESOURCE_EXT_RE =
			/\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|tiff?|heic|heif|woff2?|ttf|otf|eot|css|map|mp4|m4v|webm|mov|avi|mkv|flv|wmv|mp3|m4a|aac|wav|ogg|oga|flac|opus|zip|tar|gz|tgz|bz2|xz|7z|rar|dmg|pkg|msi|exe|apk|iso|bin)$/i
		const MEDIA_EXT_RE = /\.(mp4|webm|mov|avi|mkv|mp3|m4a|wav|ogg|flac)$/i
		const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|markdown|epub|rtf|json|ipynb)$/i
		const CODE_EXT_RE =
			/\.(pyi?|js|mjs|cjs|jsx|tsx?|rs|go|java|kt|kts|swift|m|mm|c|h|cpp|cc|hpp|cs|rb|php|sh|bash|zsh|ps1|sql|scss|css|html?|vue|svelte|astro|lua|pl|r|jl|scala|clj|exs?|erl|hs|ml|zig|nim|dart|ipynb)$/i

		/**
		 * Tag one canonical URL. Classification is multi-label: a GitHub repository is
		 * code, a CodePen is code and a tool, a Figma file is a tool and media, an
		 * `.ipynb` is reading material and code. Every row gets at least one tag.
		 * @param {string} host - lowercase hostname.
		 * @param {string} pathname - path component.
		 * @returns {string[]} tags in display order.
		 */
		function classify(host, pathname) {
			const path = pathname || ''
			const found = new Set()
			if (DOC_EXT_RE.test(path) || path.endsWith('.ipynb')) found.add('doc')
			if (MEDIA_EXT_RE.test(path)) found.add('media')
			if (CODE_EXT_RE.test(path)) found.add('code')
			if (CODE_HOSTS.has(host)) found.add('code')
			if (TOOL_HOSTS.has(host)) found.add('tool')
			if (MEDIA_HOSTS.has(host)) found.add('media')
			if (/(^|\.)wikipedia\.org$/.test(host)) found.add('doc')
			if (
				host.startsWith('docs.') ||
				host.startsWith('developer.') ||
				host.startsWith('learn.') ||
				host.endsWith('.readthedocs.io') ||
				host.endsWith('.gitbook.io')
			) {
				found.add('doc')
			}
			if (found.size === 0) found.add('doc')
			return TAGS.filter((tag) => found.has(tag))
		}

		/**
		 * One row's primary tag: its first tag in display order.
		 * @param {object} reference - reference row.
		 * @returns {string} tag id.
		 */
		function primaryTag(reference) {
			const tags = Array.isArray(reference.tags) ? reference.tags : []
			return tags.length > 0 ? tags[0] : 'doc'
		}

		/**
		 * Public suffixes that carry one extra label (`example.co.uk` keeps three),
		 * a deliberately small subset: enough for the domains conversations cite
		 * most, and a wrong guess only affects which header a row groups under.
		 */
		const MULTI_LABEL_SUFFIXES = new Set([
			'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
			'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
			'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
			'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
			'co.kr', 'or.kr', 'co.nz', 'co.in', 'co.za',
			'com.br', 'com.mx', 'com.tr', 'com.sg', 'com.hk', 'com.tw',
		])

		/**
		 * The registrable domain a row groups under: `docs.acme.co.uk` → `acme.co.uk`,
		 * `www.acme.dev` → `acme.dev`, IPs and single labels stay whole.
		 * @param {string} host - lowercase hostname.
		 * @returns {string} the grouping domain.
		 */
		function rootDomain(host) {
			const bare = String(host || '').toLowerCase().replace(/^www\./, '')
			if (bare === '') return ''
			if (/^\d+\.\d+\.\d+\.\d+$/.test(bare) || bare.indexOf(':') >= 0) return bare
			const labels = bare.split('.')
			if (labels.length <= 2) return bare
			if (MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.'))) return labels.slice(-3).join('.')
			return labels.slice(-2).join('.')
		}

		/**
		 * Keep the list flat but adjacent per registrable domain: rows keep their
		 * sorted order inside each domain, and domains keep the order of their first
		 * row. No section headers — grouping is only visible as adjacency.
		 * @param {Array<object>} references - rows in sorted order.
		 * @returns {Array<object>} the same rows, reordered.
		 */
		function orderByDomain(references) {
			const byDomain = new Map()
			for (const reference of references) {
				const domain = rootDomain(reference.host)
				const bucket = byDomain.get(domain)
				if (bucket === undefined) byDomain.set(domain, [reference])
				else bucket.push(reference)
			}
			const ordered = []
			for (const bucket of byDomain.values()) {
				for (const reference of bucket) ordered.push(reference)
			}
			return ordered
		}

		// ------------------------------------------------------------------
		// Text scanning
		// ------------------------------------------------------------------

		/**
		 * Whether a captured link label reads like a page title. Labels are captured
		 * from arbitrary conversation text (tool arguments, pasted JSON, code), so a
		 * label that is really a fragment of source code must not become a title.
		 * @param {string} value - cleaned label.
		 * @returns {boolean} true when the label can title a row.
		 */
		function isUsableTitle(value) {
			const text = String(value || '').trim()
			if (text === '' || text.length > 120) return false
			if (/[{}`]/.test(text)) return false
			if (/\btype:\s*['"]/.test(text)) return false
			if (/^(?:https?:|\/\/)/i.test(text)) return false
			if (!/[\p{L}\p{N}]/u.test(text)) return false
			return true
		}

		/**
		 * Collapse one markdown link label into a short display title.
		 * @param {string} label - raw markdown label.
		 * @returns {string} plain, single-line text.
		 */
		function cleanLabel(label) {
			let text = String(label || '')
			text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			text = text.replace(/[*_`~]+/g, '')
			text = text.replace(/\s+/g, ' ').trim()
			if (text.length > 120) text = `${text.slice(0, 117)}…`
			return text
		}

		/**
		 * A short context line around one match, for the occurrence tooltip.
		 * @param {string} text - source text.
		 * @param {number} index - match start.
		 * @param {number} length - match length.
		 * @returns {string} the trimmed context.
		 */
		function snippetOf(text, index, length) {
			const start = Math.max(0, index - 44)
			const end = Math.min(text.length, index + length + 44)
			let text2 = text.slice(start, end).replace(/\s+/g, ' ').trim()
			if (start > 0) text2 = `…${text2}`
			if (end < text.length) text2 = `${text2}…`
			return text2.slice(0, 180)
		}

		/**
		 * Split text into prose and fenced-code segments, so URLs copied from a code
		 * block can be marked instead of silently treated as prose references.
		 * @param {string} text - message text.
		 * @returns {Array<{text: string, inCode: boolean}>} segments.
		 */
		function splitFences(text) {
			const segments = []
			const fence = /```[\s\S]*?```/g
			let last = 0
			let match
			while ((match = fence.exec(text)) !== null) {
				if (match.index > last) segments.push({ text: text.slice(last, match.index), inCode: false })
				segments.push({ text: match[0], inCode: true })
				last = match.index + match[0].length
			}
			if (last < text.length) segments.push({ text: text.slice(last), inCode: false })
			return segments
		}

		/**
		 * Collect URL matches from one block of text into `out`.
		 * @param {string} text - source text.
		 * @param {{source: string, tool?: string, inCode?: boolean}} options - provenance.
		 * @param {Array<object>} out - accumulator.
		 */
		function scanText(text, options, out) {
			if (typeof text !== 'string' || text.length === 0) return
			const titles = new Map()
			MD_LINK_RE.lastIndex = 0
			let link
			while ((link = MD_LINK_RE.exec(text)) !== null) {
				const normalized = normalizeUrl(link[2])
				if (!normalized) continue
				const label = cleanLabel(link[1])
				if (!isUsableTitle(label)) continue
				if (!titles.has(normalized.key)) titles.set(normalized.key, label)
			}
			URL_RE.lastIndex = 0
			let match
			while ((match = URL_RE.exec(text)) !== null) {
				const raw = trimTrailing(match[0])
				if (raw.length < 10) continue
				const normalized = normalizeUrl(raw)
				if (!normalized) continue
				out.push({
					key: normalized.key,
					url: normalized.url,
					host: normalized.host,
					pathname: normalized.pathname,
					tags: classify(normalized.host, normalized.pathname),
					title: titles.get(normalized.key) || '',
					source: options.source,
					tool: options.tool || '',
					snippet: snippetOf(text, match.index, raw.length),
					inCode: options.inCode === true,
				})
			}
		}

		/**
		 * Scan one content-block array, honouring block kinds.
		 * @param {unknown} blocks - message content blocks.
		 * @param {{source: string, fenced: boolean}} options - provenance and whether
		 *   to treat fenced code separately.
		 * @param {Array<object>} out - accumulator.
		 */
		function scanBlocks(blocks, options, out) {
			if (!Array.isArray(blocks)) return
			for (const block of blocks) {
				if (!block || block.type !== 'text' || typeof block.text !== 'string') continue
				if (options.fenced) {
					for (const segment of splitFences(block.text)) {
						scanText(segment.text, { source: options.source, inCode: segment.inCode }, out)
					}
				} else {
					scanText(block.text, { source: options.source }, out)
				}
			}
		}

		/**
		 * Concatenate a tool result's text blocks.
		 * @param {unknown} blocks - message content blocks.
		 * @returns {string} the joined text.
		 */
		function blocksText(blocks) {
			if (!Array.isArray(blocks)) return ''
			let text = ''
			for (const block of blocks) {
				if (block && block.type === 'text' && typeof block.text === 'string') text += `${block.text}\n`
			}
			return text
		}

		/**
		 * web_search results list sources after a `Sources:` marker; anything before
		 * it is framing, so only the list is treated as references.
		 * @param {string} text - tool result text.
		 * @param {Array<object>} out - accumulator.
		 */
		function scanSearchResult(text, out) {
			if (typeof text !== 'string' || text === '') return
			const marker = text.indexOf('Sources:')
			scanText(marker >= 0 ? text.slice(marker + 8) : text, { source: 'tool', tool: 'web_search' }, out)
		}

		/**
		 * web_fetch results carry the final (post-redirect) address on their first
		 * line; the page body is arbitrary markdown whose navigation links are not
		 * references the user would want counted.
		 * @param {string} text - tool result text.
		 * @param {Array<object>} out - accumulator.
		 */
		function scanFetchResult(text, out) {
			if (typeof text !== 'string') return
			const match = /^Fetched\s+(\S+)/m.exec(text)
			if (match) scanText(match[1], { source: 'tool', tool: 'web_fetch' }, out)
		}

		/** Tool names whose arguments legitimately contain reference URLs. */
		const WEB_TOOL_RE = /^(web_?fetch|web_?search|browser|navigate|fetch|search|browse)/i

		/** Structural keys whose values are identifiers, never user-visible text. */
		const SKIP_JSON_KEYS = new Set(['callId', 'id', 'rpcId', 'toolCallId', 'messageId', 'attemptId', 'sessionId', 'turn', 'step'])

		/**
		 * Scan the string leaves of a decoded JSON value (tool arguments).
		 * @param {unknown} value - decoded arguments.
		 * @param {{source: string, tool?: string}} options - provenance.
		 * @param {Array<object>} out - accumulator.
		 */
		function scanJsonStrings(value, options, out) {
			if (typeof value === 'string') {
				scanText(value, options, out)
				return
			}
			if (Array.isArray(value)) {
				for (const item of value) scanJsonStrings(item, options, out)
				return
			}
			if (value && typeof value === 'object') {
				for (const key of Object.keys(value)) {
					if (SKIP_JSON_KEYS.has(key)) continue
					scanJsonStrings(value[key], options, out)
				}
			}
		}

		/**
		 * The call a tool result belongs to. The event data carries only
		 * `{ turn, step, message }`; the id lives on that message (and on its
		 * `source`, which is the shape the trajectory view reads).
		 * @param {object} event - session event.
		 * @returns {string} the call id, or '' when absent.
		 */
		function toolResultCallId(event) {
			const data = (event && event.data) || {}
			const message = data.message
			if (message && typeof message === 'object') {
				if (typeof message.toolCallId === 'string') return message.toolCallId
				const source = message.source
				if (source && typeof source.callId === 'string') return source.callId
			}
			if (typeof data.toolCallId === 'string') return data.toolCallId
			return ''
		}

		/**
		 * Whether one event's extraction may be reused for its seq. Durable events
		 * are stable, except a tool result whose tool name is not known yet: its
		 * extraction depends on the call→name map that `加载更早` can still fill in.
		 * @param {object} event - session event.
		 * @param {Map<string, string>} callNames - tool-call id → tool name.
		 * @returns {boolean} true when the extraction can be cached.
		 */
		function cacheableEvent(event, callNames) {
			if (event.type !== 'tool/result') return true
			const callId = toolResultCallId(event)
			return callId === '' || callNames.has(callId)
		}

		/**
		 * Extract every reference carried by one session event.
		 * @param {object} event - durable or transient session event.
		 * @param {Map<string, string>} callNames - tool-call id → tool name.
		 * @param {Array<object>} out - accumulator for matches.
		 */
		function extractEvent(event, callNames, out) {
			if (!event || typeof event.type !== 'string') return
			const data = event.data || {}
			switch (event.type) {
				case 'user/message':
					scanBlocks(data.content, { source: 'user', fenced: true }, out)
					return
				case 'assistant/message':
					scanBlocks(data.message && data.message.content, { source: 'assistant', fenced: true }, out)
					return
				case 'tool/call': {
					const name = typeof data.name === 'string' ? data.name : 'tool'
					if (typeof data.callId === 'string') callNames.set(data.callId, name)
					// URLs inside a shell/python command are implementation noise (curl probes,
					// test fixtures); only web-facing tools carry real references in arguments.
					if (!WEB_TOOL_RE.test(name)) return
					if (typeof data.arguments === 'string') {
						let parsed = null
						try {
							parsed = JSON.parse(data.arguments)
						} catch (error) {
							parsed = null
						}
						if (parsed !== null && typeof parsed === 'object') {
							scanJsonStrings(parsed, { source: 'tool', tool: name }, out)
						} else {
							scanText(data.arguments, { source: 'tool', tool: name }, out)
						}
					}
					return
				}
				case 'tool/result': {
					const toolCallId = toolResultCallId(event)
					const name = (toolCallId && callNames.get(toolCallId)) || ''
					const text = blocksText(data.message && data.message.content)
					if (name === 'web_search') scanSearchResult(text, out)
					else if (name === 'web_fetch') scanFetchResult(text, out)
					else scanText(text, { source: 'tool', tool: name || 'tool' }, out)
					return
				}
				default:
					return
			}
		}

		// ------------------------------------------------------------------
		// Aggregation
		// ------------------------------------------------------------------

		/**
		 * Merge one match into the reference table.
		 * @param {Map<string, object>} refs - key → reference row.
		 * @param {object} match - one extracted URL.
		 * @param {object} event - the event that carried it.
		 * @param {number | null} turn - turn number, when known.
		 */
		function addMatch(refs, match, event, turn) {
			let reference = refs.get(match.key)
			if (reference === undefined) {
				reference = {
					key: match.key,
					url: match.url,
					host: match.host,
					pathname: match.pathname,
					tags: [],
					title: match.title,
					titleFromPath: match.title === '',
					count: 0,
					turnCount: 0,
					turns: [],
					bySource: { user: 0, tool: 0, assistant: 0 },
					firstSeq: event.seq,
					lastSeq: event.seq,
					firstTurn: turn,
					lastTurn: turn,
					inCode: false,
					occurrences: [],
				}
				refs.set(match.key, reference)
			}
			reference.count += 1
			if (typeof turn === 'number' && reference.turns.indexOf(turn) < 0) {
				reference.turns.push(turn)
				reference.turnCount = reference.turns.length
			}
			if (match.source in reference.bySource) reference.bySource[match.source] += 1
			if (Array.isArray(match.tags)) {
				for (const tag of match.tags) {
					if (reference.tags.indexOf(tag) < 0) reference.tags.push(tag)
				}
				reference.tags.sort((left, right) => TAGS.indexOf(left) - TAGS.indexOf(right))
			}
			if (match.title !== '') {
				// Later mentions are closer to how the page is described now: the newest
				// explicit title wins, but only when it is actually newer.
				const nextTitle = normalizeTitle(match.title)
				if (nextTitle !== '' && event.seq >= (reference.titleSeq || 0)) {
					reference.title = nextTitle
					reference.titleFromPath = false
					reference.titleSeq = event.seq
				}
			}
			if (match.inCode) reference.inCode = true
			if (typeof event.seq === 'number') {
				if (event.seq < reference.firstSeq) reference.firstSeq = event.seq
				if (event.seq > reference.lastSeq) {
					reference.lastSeq = event.seq
					reference.lastTurn = turn
				}
			}
			if (reference.occurrences.length < 40) {
				reference.occurrences.push({
					seq: event.seq,
					turn,
					source: match.source,
					tool: match.tool,
					snippet: match.snippet,
					inCode: match.inCode === true,
				})
			}
		}

		/**
		 * Fold the loaded event window into reference rows.
		 * @param {Array<{type: string, event: object}>} entries - the session window.
		 * @param {Map<number, Array<object>>} cache - per-seq extraction cache.
		 * @param {Map<string, string>} callNames - tool-call id → tool name.
		 * @returns {Array<object>} reference rows.
		 */
		function aggregate(entries, cache, callNames) {
			const refs = new Map()
			if (!Array.isArray(entries)) return []
			let turn = 0
			for (const entry of entries) {
				const event = entry && entry.event
				if (!event || typeof event.type !== 'string') continue
				if (event.type === 'turn/start') {
					turn += 1
					continue
				}
				const turnOfEvent = typeof (event.data && event.data.turn) === 'number' ? event.data.turn : turn > 0 ? turn : null
				const seq = typeof event.seq === 'number' ? event.seq : null
				let matches
				if (seq !== null && entry.type !== 'transient' && cache.has(seq)) {
					matches = cache.get(seq)
				} else {
					matches = []
					extractEvent(event, callNames, matches)
					if (seq !== null && entry.type !== 'transient' && cacheableEvent(event, callNames)) cache.set(seq, matches)
				}
				if (matches.length === 0) continue
				for (const match of matches) addMatch(refs, match, event, turnOfEvent)
			}
			return Array.from(refs.values())
		}

		// ------------------------------------------------------------------
		// Chat navigation
		// ------------------------------------------------------------------

		/**
		 * Briefly highlight one DOM element without owning any stylesheet.
		 * @param {Element | null} element - target.
		 * @returns {boolean} whether anything was highlighted.
		 */
		function flashElement(element) {
			if (!element) return false
			try {
				element.scrollIntoView({ block: 'center', behavior: 'smooth' })
			} catch (error) {
				try { element.scrollIntoView() } catch (ignored) { /* detached */ }
			}
			try {
				element.animate(
					[{ backgroundColor: 'rgba(255, 196, 0, 0.35)' }, { backgroundColor: 'rgba(255, 196, 0, 0)' }],
					{ duration: 1600, easing: 'ease-out' },
				)
			} catch (error) {
				/* reduced-motion or unsupported: the scroll still lands */
			}
			return true
		}

		/**
		 * Scroll the chat back to the message that carried one URL.
		 * @param {string} url - the canonical URL.
		 * @returns {boolean} whether the source was found in the loaded transcript.
		 */
		/**
		 * Scroll the conversation to one turn and flash it.
		 * @param {number} turn - 1-based turn number.
		 * @returns {boolean} true when a mounted row matched.
		 */
		function locateTurn(turn) {
			if (typeof document === 'undefined' || !Number.isFinite(turn)) return false
			const rows = Array.from(document.querySelectorAll('[data-chat-turn]'))
			const numbered = rows
				.map((row) => ({ row, turn: Number(row.getAttribute('data-chat-turn')) }))
				.filter((entry) => Number.isFinite(entry.turn))
			if (numbered.length === 0) return false
			const match =
				numbered.find((entry) => entry.turn === turn) ||
				numbered.find((entry) => entry.turn >= turn) ||
				numbered[numbered.length - 1]
			if (!match) return false
			match.row.scrollIntoView({ block: 'center', behavior: 'smooth' })
			return flashElement(match.row)
		}

		function locateUrl(url) {
			if (typeof document === 'undefined') return false
			const root = document.querySelector('[data-conversation-scroll]') || document.body
			if (!root) return false
			const bare = url.replace(/^https?:\/\//i, '')
			const needles = [url, bare, bare.replace(/^www\./, '')]
			const anchors = root.querySelectorAll('a[href]')
			for (const anchor of anchors) {
				const href = anchor.getAttribute('href') || ''
				const resolved = anchor.href
				if (href === url || resolved === url) return flashElement(anchor)
				for (const needle of needles) {
					if (needle !== '' && (href.indexOf(needle) >= 0 || resolved.indexOf(needle) >= 0)) {
						return flashElement(anchor)
					}
				}
			}
			if (typeof document.createTreeWalker !== 'function') return false
			const walker = document.createTreeWalker(root, 4)
			let node
			while ((node = walker.nextNode())) {
				const value = node.nodeValue
				if (typeof value !== 'string' || value.length > 4000) continue
				for (const needle of needles) {
					if (needle !== '' && value.indexOf(needle) >= 0) return flashElement(node.parentElement)
				}
			}
			return false
		}

		// ------------------------------------------------------------------
		// Ignore list and Markdown export
		// ------------------------------------------------------------------

		/** localStorage key prefix for the per-session ignore list. */
		const IGNORE_KEY_PREFIX = 'dsh-links.ignored.v1:'

		/**
		 * What one row shows as its title: the page's own `<title>`, otherwise the URL.
		 * A captured markdown label is not a page title (labels like "视频" are
		 * fragments of the conversation), so it never stands in for one.
		 * @param {object} reference - reference row.
		 * @param {Record<string, object | string>} [probes] - probe records (or title map) by URL.
		 * @returns {string} a single-line title.
		 */
		/**
		 * Distinct conversational turns a row appeared in.
		 * @param {object} reference - reference row.
		 * @returns {number} turn count.
		 */
		function turnCountOf(reference) {
			if (!reference || typeof reference !== 'object') return 0
			if (Array.isArray(reference.turns) && reference.turns.length > 0) return reference.turns.length
			if (typeof reference.turnCount === 'number' && reference.turnCount > 0) return reference.turnCount
			return typeof reference.count === 'number' ? reference.count : 0
		}

		/**
		 * Collapse whitespace in a candidate title so cosmetic differences do not look like
		 * distinct titles (newlines, repeated spaces, zero-width marks).
		 * @param {string} value - raw title.
		 * @returns {string} normalized title.
		 */
		function normalizeTitle(value) {
			return String(value || '')
				.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
				.replace(/\s+/g, ' ')
				.trim()
		}

		/**
		 * Build a readable title from the text around a URL's latest mention.
		 * @param {object} reference - reference row.
		 * @returns {string} derived title, or '' when the context has nothing usable.
		 */
		function contextTitle(reference) {
			const occurrences = Array.isArray(reference && reference.occurrences) ? reference.occurrences : []
			// Only natural-language mentions can describe a page: tool payloads and code
			// snippets produce garbage like "assert.ok(rendered.includes(" as a title.
			const usableText = (value) => {
				if (typeof value !== 'string') return false
				const text = value.trim()
				if (text === '') return false
				if (/[{}<>;\\]|=>|\$\{|\bconst\b|\bfunction\b|\bassert\.|\bimport\b/.test(text)) return false
				return true
			}
			const candidates = occurrences.filter(
				(entry) =>
					entry &&
					entry.source !== 'tool' &&
					entry.inCode !== true &&
					typeof entry.snippet === 'string' &&
					usableText(entry.snippet),
			)
			const latest = candidates.length > 0 ? candidates[candidates.length - 1] : null
			const raw = latest && typeof latest.snippet === 'string' ? latest.snippet : ''
			const cleaned = raw
				.replace(/https?:\/\/\S+/g, ' ')
				.replace(/[`*_>#|]/g, ' ')
				.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
				.replace(/\s+/g, ' ')
				.replace(/^[\s\-–—:：,，.。;；!！?？()（）\[\]【】<>《》"“”'‘’…]+/, '')
				.replace(/[\s\-–—:：,，.。;；...]+$/, '')
				.replace(/[\s]*(和|与|及|以及|and|or|、)$/i, '')
				.trim()
			if (cleaned === '' || cleaned.length < 8) return ''
			if (/[{}<>;\\]|=>|\$\{/.test(cleaned)) return ''
			return cleaned.length > 48 ? `${cleaned.slice(0, 47)}…` : cleaned
		}

		function titleOf(reference, probes) {
			// Strip bidi/zero-width marks before judging: some pages and labels contain only
			// invisible characters, which rendered as a blank row.
			const visible = (text) => String(text).replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').trim()
			const usable = (value) => typeof value === 'string' && visible(value) !== ''
			// The conversation's own title (Markdown link text / tool result titles) wins.
			if (reference && usable(reference.title) && reference.titleFromPath === false) {
				return visible(reference.title)
			}
			// Fallback: the page's own <title> (what the site says it is), probed once and
			// cached; the newest explicit conversation title always wins over it.
			const probe = probes ? probes[reference.url] : undefined
			if (typeof probe === 'string' && usable(probe)) return visible(probe)
			if (probe && typeof probe === 'object' && usable(probe.title)) return visible(probe.title)
			// Never render an empty row: fall back to the URL.
			return reference.url
		}

		/**
		 * A localStorage handle, or null when the frame blocks storage. The panel
		 * must keep working when persistence is unavailable.
		 * @returns {Storage | null} the store.
		 */
		function ignoreStore() {
			try {
				if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
			} catch (error) {
				/* storage access can throw in a sandboxed or partitioned frame */
			}
			return null
		}

		/**
		 * Read the ignore list persisted for one session.
		 * @param {string} sessionId - session key.
		 * @returns {{links: string[], hosts: string[]}} ignored keys and hosts.
		 */
		function loadIgnores(sessionId) {
			const empty = { links: [], hosts: [] }
			const store = ignoreStore()
			if (!store || !sessionId) return empty
			try {
				const raw = store.getItem(IGNORE_KEY_PREFIX + sessionId)
				if (!raw) return empty
				const parsed = JSON.parse(raw)
				return {
					links: Array.isArray(parsed.links) ? parsed.links.filter((item) => typeof item === 'string') : [],
					hosts: Array.isArray(parsed.hosts) ? parsed.hosts.filter((item) => typeof item === 'string') : [],
				}
			} catch (error) {
				return empty
			}
		}

		/** Manual title overrides: row key → user-written title. */
		const CUSTOM_TITLES_KEY = 'dsh-links.customtitles.v1'
		const CUSTOM_TITLES_LIMIT = 500

		/** @returns {Record<string, string>} manual titles by row key. */
		function loadCustomTitles() {
			const store = ignoreStore()
			if (!store) return {}
			try {
				const raw = store.getItem(CUSTOM_TITLES_KEY)
				const parsed = raw ? JSON.parse(raw) : null
				if (!parsed || typeof parsed !== 'object') return {}
				const result = {}
				for (const [key, value] of Object.entries(parsed)) {
					if (typeof key === 'string' && typeof value === 'string' && value.trim() !== '') result[key] = value
				}
				return result
			} catch (error) {
				return {}
			}
		}

		/**
		 * Persist manual titles.
		 * @param {Record<string, string>} titles - overrides by row key.
		 * @returns {void}
		 */
		function saveCustomTitles(titles) {
			const store = ignoreStore()
			if (!store) return
			try {
				const entries = Object.entries(titles).slice(-CUSTOM_TITLES_LIMIT)
				store.setItem(CUSTOM_TITLES_KEY, JSON.stringify(Object.fromEntries(entries)))
			} catch (error) {
				/* quota: keep overrides in memory for this mount */
			}
		}

		/**
		 * Deterministic fallback icon derived from the host, so an unreadable site still
		 * gets a stable, site-specific mark instead of a generated letter or a brand guess.
		 * @param {string} host - row hostname.
		 * @returns {string} data URL with a 5×5 identicon.
		 */
		function hashIconFor(host) {
			const name = String(host || '').replace(/^www\./, '') || '?'
			let hash = 2166136261
			for (let index = 0; index < name.length; index += 1) {
				hash ^= name.charCodeAt(index)
				hash = Math.imul(hash, 16777619)
			}
			const seed = hash >>> 0
			const hue = seed % 360
			const hue2 = (hue + 47 + ((seed >>> 9) % 60)) % 360
			const fg = `hsl(${hue} 62% 48%)`
			const fg2 = `hsl(${hue2} 58% 56%)`
			const size = 32
			const cell = size / 5
			let cells = ''
			let bits = seed
			for (let y = 0; y < 5; y += 1) {
				for (let x = 0; x < 3; x += 1) {
					bits = (bits * 1103515245 + 12345) >>> 0
					if ((bits >>> 16) % 2 === 0) continue
					const color = ((bits >>> 8) % 3 === 0) ? fg2 : fg
					cells += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell}" height="${cell}" fill="${color}"/>`
					if (x < 2) cells += `<rect x="${((4 - x) * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell}" height="${cell}" fill="${color}"/>`
				}
			}
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="7" fill="hsl(${hue} 30% 92%)"/>${cells}</svg>`
			return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
		}

		/**
		 * Hosts table: host → cached favicon bytes (data URL). Exact hosts and registrable
		 * domains share one map: rendering looks up `hosts[host]` then `hosts[domain]`.
		 */
		const HOSTS_TABLE_KEY = 'dsh-links.hosts.v1'
		const HOSTS_TABLE_LIMIT = 800
		const ICON_ROUTE = '/dsh-links/icon'

		/**
		 * Load the hosts table, migrating the earlier split cache once.
		 * @returns {Record<string, string>} icon data URL by host or domain.
		 */
		function loadHostsTable() {
			const store = ignoreStore()
			if (!store) return {}
			const pick = (source) => {
				const result = {}
				if (!source || typeof source !== 'object') return result
				for (const [key, value] of Object.entries(source)) {
					if (typeof key === 'string' && typeof value === 'string' && value.indexOf('data:') === 0) result[key] = value
				}
				return result
			}
			try {
				const raw = store.getItem(HOSTS_TABLE_KEY)
				const parsed = raw ? JSON.parse(raw) : null
				const current = pick(parsed)
				if (Object.keys(current).length > 0) return current
				// one-time migration from v0.58's { hosts, domains } shape
				const legacyRaw = store.getItem('dsh-links.hosticons.v2')
				if (!legacyRaw) return current
				const legacy = JSON.parse(legacyRaw)
				return { ...pick(legacy && legacy.domains), ...pick(legacy && legacy.hosts) }
			} catch (error) {
				return {}
			}
		}

		/**
		 * Persist the hosts table.
		 * @param {Record<string, string>} table - icon data URL by host or domain.
		 * @returns {void}
		 */
		function saveHostsTable(table) {
			const store = ignoreStore()
			if (!store) return
			try {
				const entries = Object.entries(table || {}).slice(-HOSTS_TABLE_LIMIT)
				if (entries.length === 0) {
					store.removeItem(HOSTS_TABLE_KEY)
					return
				}
				store.setItem(HOSTS_TABLE_KEY, JSON.stringify(Object.fromEntries(entries)))
			} catch (error) {
				/* quota: icons stay in memory for this mount */
			}
		}

		/** Per-session cache of already collected reference rows. */
		const LINKS_CACHE_PREFIX = 'dsh-links.links.v3:'
		const LINKS_CACHE_LIMIT = 1500

		function linksCacheKey(sessionId) {
			return `${LINKS_CACHE_PREFIX}${sessionId || 'default'}`
		}

		/**
		 * Read the collected rows of one session, so reopening the panel shows the list
		 * immediately and only appends what is new in the conversation.
		 * @param {string} sessionId - session the rows belong to.
		 * @returns {object[]} cached rows.
		 */
		function loadLinksCache(sessionId) {
			const store = ignoreStore()
			if (!store) return { rows: [], seq: 0, minSeq: 0, complete: false }
			try {
				const raw = store.getItem(linksCacheKey(sessionId))
				const parsedRaw = raw ? JSON.parse(raw) : null
				const parsed = Array.isArray(parsedRaw) ? parsedRaw : parsedRaw && Array.isArray(parsedRaw.rows) ? parsedRaw.rows : null
				if (!Array.isArray(parsed)) return { rows: [], seq: 0, minSeq: 0, complete: false }
				const rows = []
				for (const row of parsed) {
					if (!row || typeof row !== 'object') continue
					if (typeof row.key !== 'string' || typeof row.url !== 'string' || typeof row.host !== 'string') continue
					rows.push({
						key: row.key,
						url: row.url,
						host: row.host,
						pathname: typeof row.pathname === 'string' ? row.pathname : '',
						tags: Array.isArray(row.tags) ? row.tags : [],
						title: typeof row.title === 'string' ? row.title : '',
						titleFromPath: row.titleFromPath !== false,
						count: Number.isFinite(row.count) ? row.count : 1,
						turnCount: Number.isFinite(row.turnCount) ? row.turnCount : Array.isArray(row.turns) ? row.turns.length : 1,
						turns: Array.isArray(row.turns) ? row.turns.slice(0, 400) : [],
						bySource:
							row.bySource && typeof row.bySource === 'object'
								? { user: row.bySource.user || 0, tool: row.bySource.tool || 0, assistant: row.bySource.assistant || 0 }
								: { user: 0, tool: 0, assistant: 0 },
						firstSeq: Number.isFinite(row.firstSeq) ? row.firstSeq : 0,
						lastSeq: Number.isFinite(row.lastSeq) ? row.lastSeq : 0,
						firstTurn: Number.isFinite(row.firstTurn) ? row.firstTurn : 0,
						lastTurn: Number.isFinite(row.lastTurn) ? row.lastTurn : 0,
						inCode: row.inCode === true,
						occurrences: Array.isArray(row.occurrences) ? row.occurrences.slice(0, 8) : [],
					})
				}
				const seq = parsedRaw && !Array.isArray(parsedRaw) && Number.isFinite(parsedRaw.seq) ? parsedRaw.seq : 0
				const minSeq =
					parsedRaw && !Array.isArray(parsedRaw) && Number.isFinite(parsedRaw.minSeq)
						? parsedRaw.minSeq
						: seq > 0
							? Number.MIN_SAFE_INTEGER
							: 0
				const complete = parsedRaw && !Array.isArray(parsedRaw) && parsedRaw.complete === true
				return { rows: rows.slice(-LINKS_CACHE_LIMIT), seq, minSeq, complete }
			} catch (error) {
				return { rows: [], seq: 0, minSeq: 0, complete: false }
			}
		}

		/**
		 * Persist the collected rows of one session.
		 * @param {string} sessionId - session the rows belong to.
		 * @param {object[]} rows - collected rows.
		 * @returns {void}
		 */
		function saveLinksCache(sessionId, rows, seq, minSeq, complete) {
			const store = ignoreStore()
			if (!store) return
			try {
				const slim = rows.slice(-LINKS_CACHE_LIMIT).map((row) => ({
					key: row.key,
					url: row.url,
					host: row.host,
					pathname: row.pathname,
					tags: row.tags,
					title: row.title,
					titleFromPath: row.titleFromPath,
					count: row.count,
					turnCount: row.turnCount,
					turns: row.turns,
					bySource: row.bySource,
					firstSeq: row.firstSeq,
					lastSeq: row.lastSeq,
					firstTurn: row.firstTurn,
					lastTurn: row.lastTurn,
					inCode: row.inCode,
					occurrences: row.occurrences.slice(0, 8),
				}))
				store.setItem(
					linksCacheKey(sessionId),
					JSON.stringify({
						rows: slim,
						seq: Number.isFinite(seq) ? seq : 0,
						minSeq: Number.isFinite(minSeq) ? minSeq : 0,
						complete: complete === true,
					}),
				)
			} catch (error) {
				/* quota: keep the in-memory list */
			}
		}

		/**
		 * Merge an incremental scan into previously collected rows (same key = one row).
		 * @param {object[]} base - rows already collected.
		 * @param {object[]} incoming - rows produced by the newest events only.
		 * @returns {object[]} merged rows.
		 */
		function mergeRows(base, incoming) {
			const byKey = new Map()
			for (const row of base) {
				const turns = Array.isArray(row.turns) ? row.turns.slice() : []
				byKey.set(row.key, {
					...row,
					tags: row.tags.slice(),
					bySource: { ...row.bySource },
					occurrences: row.occurrences.slice(),
					turns,
					turnCount: Number.isFinite(row.turnCount) ? row.turnCount : turns.length,
				})
			}
			for (const row of incoming) {
				const previous = byKey.get(row.key)
				if (previous === undefined) {
					byKey.set(row.key, row)
					continue
				}
				// The fresh scan is produced with the current turn numbering: replace the
				// cached numbers instead of unioning them (turn ids from different scans are
				// not comparable and used to inflate the count).
				const turns = Array.isArray(row.turns) ? row.turns.slice() : []
				previous.count = row.count
				previous.turns = turns
				previous.turnCount = turns.length
				for (const tag of row.tags) if (previous.tags.indexOf(tag) < 0) previous.tags.push(tag)
				previous.tags.sort((left, right) => TAGS.indexOf(left) - TAGS.indexOf(right))
				if (row.title !== '' && previous.titleFromPath) {
					previous.title = row.title
					previous.titleFromPath = false
				}
				previous.firstSeq = Math.min(previous.firstSeq, row.firstSeq)
				previous.lastSeq = Math.max(previous.lastSeq, row.lastSeq)
				if (!previous.firstTurn) previous.firstTurn = row.firstTurn
				if (row.lastTurn) previous.lastTurn = row.lastTurn
				previous.inCode = previous.inCode || row.inCode
				previous.bySource.user += row.bySource.user
				previous.bySource.tool += row.bySource.tool
				previous.bySource.assistant += row.bySource.assistant
				previous.occurrences = previous.occurrences.concat(row.occurrences).slice(0, 40)
			}
			return Array.from(byKey.values())
		}

		/**
		 * Drop the collected rows of one session (used before a global rescan).
		 * @param {string} sessionId - session the rows belong to.
		 * @returns {void}
		 */
		function clearLinksCache(sessionId) {
			const store = ignoreStore()
			if (!store) return
			try {
				store.removeItem(linksCacheKey(sessionId))
			} catch (error) {
				/* nothing to clear */
			}
		}

		/** User blocklist: domains hidden everywhere, across sessions. */
		const BLOCKED_HOSTS_KEY = 'dsh-links.blocked-hosts.v1'
		/** Maximum remembered blocked domains. */
		const BLOCKED_HOSTS_LIMIT = 300

		/**
		 * Read the global domain blocklist, absorbing any per-session host entries left by
		 * older versions so "ignore this domain" applies to every conversation.
		 * @returns {Set<string>} blocked bare domains.
		 */
		function loadBlockedHosts() {
			const store = ignoreStore()
			if (!store) return new Set()
			const hosts = new Set()
			try {
				const raw = store.getItem(BLOCKED_HOSTS_KEY)
				if (raw) {
					const parsed = JSON.parse(raw)
					if (Array.isArray(parsed)) {
						for (const host of parsed) if (typeof host === 'string' && host !== '') hosts.add(host)
					}
				}
				for (let index = 0; index < store.length; index += 1) {
					const key = store.key(index)
					if (typeof key !== 'string' || key.indexOf(IGNORE_KEY_PREFIX) !== 0) continue
					try {
						const perSession = JSON.parse(store.getItem(key) || '{}')
						if (perSession && Array.isArray(perSession.hosts)) {
							for (const host of perSession.hosts) if (typeof host === 'string' && host !== '') hosts.add(host)
						}
					} catch (error) {
						/* ignore a corrupt per-session entry */
					}
				}
			} catch (error) {
				return new Set()
			}
			return hosts
		}

		/**
		 * Persist the global domain blocklist.
		 * @param {Set<string>} hosts - blocked bare domains.
		 * @returns {void}
		 */
		function saveBlockedHosts(hosts) {
			const store = ignoreStore()
			if (!store) return
			try {
				const values = Array.from(hosts).slice(-BLOCKED_HOSTS_LIMIT)
				if (values.length === 0) {
					store.removeItem(BLOCKED_HOSTS_KEY)
					return
				}
				store.setItem(BLOCKED_HOSTS_KEY, JSON.stringify(values))
			} catch (error) {
				/* quota or partitioning: the blocklist stays in memory for this mount */
			}
		}

		/** Global pin list: pinned URLs stay on top in every session. */
		const PIN_STORE_KEY = 'dsh-links.pinned.v1'
		/** Maximum remembered pins. */
		const PIN_LIMIT = 500

		/**
		 * Read pinned URLs.
		 * @returns {Set<string>} pinned URLs.
		 */
		function loadPins() {
			const store = ignoreStore()
			if (!store) return new Set()
			try {
				const raw = store.getItem(PIN_STORE_KEY)
				if (!raw) return new Set()
				const parsed = JSON.parse(raw)
				if (!Array.isArray(parsed)) return new Set()
				return new Set(parsed.filter((url) => typeof url === 'string'))
			} catch (error) {
				return new Set()
			}
		}

		/**
		 * Persist pinned URLs.
		 * @param {Set<string>} pinned - pinned URLs.
		 * @returns {void}
		 */
		function savePins(pinned) {
			const store = ignoreStore()
			if (!store) return
			try {
				const urls = Array.from(pinned).slice(-PIN_LIMIT)
				if (urls.length === 0) {
					store.removeItem(PIN_STORE_KEY)
					return
				}
				store.setItem(PIN_STORE_KEY, JSON.stringify(urls))
			} catch (error) {
				/* quota or partitioning: pins stay in memory for this mount */
			}
		}

		/** localStorage key for site icons resolved from any page of that host. */
		const HOST_ICON_KEY = 'dsh-links.hosticons.v1'
		/** Maximum remembered site icons. */
		const HOST_ICON_LIMIT = 300

		/**
		 * Map every registrable domain to an icon another page of that site declared.
		 * One site keeps one icon across subdomains (`gist.github.com` uses
		 * `github.com`'s icon), and an apex-page icon wins over a subdomain's.
		 * @param {Record<string, object>} probes - probes by URL.
		 * @returns {Map<string, string>} icon URL by registrable domain.
		 */
		function hostIconMap(probes) {
			const fromApex = new Map()
			const fromSubdomain = new Map()
			for (const [url, probe] of Object.entries(probes || {})) {
				if (!probe || typeof probe !== 'object' || !probe.icon) continue
				let host
				try {
					host = new URL(url).hostname
				} catch (error) {
					continue
				}
				const root = rootDomain(host)
				const target = host === root ? fromApex : fromSubdomain
				if (!target.has(root)) target.set(root, probe.icon)
			}
			return new Map([...fromSubdomain, ...fromApex])
		}

		/**
		 * Read remembered host icons.
		 * @returns {Record<string, string>} icon URL by host.
		 */
		function loadHostIcons() {
			const store = ignoreStore()
			if (!store) return {}
			try {
				const raw = store.getItem(HOST_ICON_KEY)
				if (!raw) return {}
				const parsed = JSON.parse(raw)
				if (!parsed || typeof parsed !== 'object') return {}
				const icons = {}
				for (const [host, icon] of Object.entries(parsed)) {
					if (typeof host === 'string' && typeof icon === 'string' && icon !== '') icons[host] = icon
				}
				return icons
			} catch (error) {
				return {}
			}
		}

		/**
		 * Persist host icons.
		 * @param {Record<string, string>} icons - icon URL by host.
		 * @returns {void}
		 */
		function saveHostIcons(icons) {
			const store = ignoreStore()
			if (!store) return
			try {
				const entries = Object.entries(icons).slice(-HOST_ICON_LIMIT)
				if (entries.length === 0) {
					store.removeItem(HOST_ICON_KEY)
					return
				}
				store.setItem(HOST_ICON_KEY, JSON.stringify(Object.fromEntries(entries)))
			} catch (error) {
				/* quota or partitioning: icons stay in memory for this mount */
			}
		}

		/**
		 * Split rows into the pinned group and the rest, keeping their order.
		 * @param {Array<object>} rows - rows in display order.
		 * @param {Set<string>} pinned - pinned URLs.
		 * @returns {[Array<object>, Array<object>]} [pinned rows, remaining rows].
		 */
		function splitPinned(rows, pinned) {
			const pinnedRows = []
			const rest = []
			for (const row of rows) {
				if (pinned && pinned.has(row.url)) pinnedRows.push(row)
				else rest.push(row)
			}
			return [pinnedRows, rest]
		}

		/**
		 * Persist one session's ignore list.
		 * @param {string} sessionId - session key.
		 * @param {{links: string[], hosts: string[]}} ignored - current list.
		 * @returns {void}
		 */
		function saveIgnores(sessionId, ignored) {
			const store = ignoreStore()
			if (!store || !sessionId) return
			try {
				if (ignored.links.length === 0 && ignored.hosts.length === 0) {
					store.removeItem(IGNORE_KEY_PREFIX + sessionId)
					return
				}
				store.setItem(IGNORE_KEY_PREFIX + sessionId, JSON.stringify(ignored))
			} catch (error) {
				/* quota or partitioning: ignoring stays in-memory for this tab */
			}
		}

		/**
		 * Whether a host is covered by the ignore list. A bare-domain entry also
		 * covers its subdomains, so ignoring `example.com` hides `docs.example.com`.
		 * @param {string} host - the row's host.
		 * @param {string[]} hosts - ignored bare domains.
		 * @returns {boolean} true when hidden.
		 */
		function hostIgnored(host, hosts) {
			const bare = String(host || '').replace(/^www\./, '')
			for (const candidate of hosts) {
				if (bare === candidate || bare.endsWith(`.${candidate}`)) return true
			}
			return false
		}

		/**
		 * Whether one row is currently ignored.
		 * @param {object} reference - reference row.
		 * @param {{links: string[], hosts: string[]}} ignored - ignore list.
		 * @returns {boolean} true when hidden from the list.
		 */
		function isIgnored(reference, ignored) {
			if (!ignored) return false
			return ignored.links.indexOf(reference.key) >= 0 || hostIgnored(reference.host, ignored.hosts)
		}

		/**
		 * The ignore list plus one entry. Ignoring a host drops narrower host
		 * entries it now covers.
		 * @param {{links: string[], hosts: string[]}} ignored - current list.
		 * @param {object} reference - the row acted on.
		 * @param {'link' | 'host'} scope - single row or whole domain.
		 * @returns {{links: string[], hosts: string[]}} a new list.
		 */
		function withIgnore(ignored, reference, scope) {
			const next = { links: ignored.links.slice(), hosts: ignored.hosts.slice() }
			if (scope === 'host') {
				const host = rootDomain(reference.host)
				// A broader entry may already cover this host; a narrower entry it covers is dropped.
				if (hostIgnored(host, next.hosts)) return next
				next.hosts = next.hosts.filter((item) => !hostIgnored(item, [host]))
				next.hosts.push(host)
			} else if (next.links.indexOf(reference.key) < 0) {
				next.links.push(reference.key)
			}
			return next
		}

		/**
		 * Undo: drop every entry that hides one row (a domain entry goes away whole,
		 * so the rest of that domain comes back too).
		 * @param {{links: string[], hosts: string[]}} ignored - current list.
		 * @param {object} reference - the row the notice action was about.
		 * @returns {{links: string[], hosts: string[]}} a new list.
		 */
		function withoutIgnore(ignored, reference) {
			return {
				links: ignored.links.filter((key) => key !== reference.key),
				hosts: ignored.hosts.filter((host) => !hostIgnored(reference.host, [host])),
			}
		}

		/**
		 * Restore one row without releasing its neighbours: when a domain entry was
		 * hiding it, that entry is replaced by per-row entries for the siblings it
		 * used to cover.
		 * @param {Array<object>} rows - every row the panel knows about.
		 * @param {{links: string[], hosts: string[]}} ignored - current list.
		 * @param {object} reference - the row to restore.
		 * @returns {{links: string[], hosts: string[]}} a new list.
		 */
		function restoreOne(rows, ignored, reference) {
			const next = {
				links: ignored.links.filter((key) => key !== reference.key),
				hosts: ignored.hosts.slice(),
			}
			if (!isIgnored(reference, next)) return next
			const covering = next.hosts.filter((host) => hostIgnored(reference.host, [host]))
			if (covering.length === 0) return next
			next.hosts = next.hosts.filter((host) => !hostIgnored(reference.host, [host]))
			for (const row of rows || []) {
				if (row.key === reference.key) continue
				if (!isIgnored(row, { links: [], hosts: covering })) continue
				if (next.links.indexOf(row.key) < 0) next.links.push(row.key)
			}
			return next
		}

		/**
		 * Escape a title so it cannot end the surrounding link text or turn into HTML.
		 * @param {string} text - plain title.
		 * @returns {string} Markdown-safe label.
		 */
		function escapeLabel(text) {
			return String(text).replace(/[\\[\]<>]/g, '\\$&')
		}

		/**
		 * Render the given rows as a flat Markdown reference list.
		 * @param {Array<object>} references - rows in their current display order.
		 * @param {Record<string, object>} [probes] - probe records by URL (for titles).
		 * @returns {string} Markdown, or an empty string.
		 */
		function markdownOf(references, probes) {
			const lines = []
			for (const reference of references) {
				const label = escapeLabel(titleOf(reference, probes))
				const turns = turnCountOf(reference)
				const times = turns > 1 ? `（${turns} 轮）` : ''
				lines.push(`- [${label}](<${reference.url}>)${times}`)
			}
			return lines.join('\n')
		}

		/**
		 * Copy text to the clipboard, falling back to the legacy execCommand path
		 * when the async clipboard API is unavailable (non-secure origins, older
		 * Electron builds).
		 * @param {string} text - payload.
		 * @returns {Promise<boolean>} whether the copy succeeded.
		 */
		function copyText(text) {
			const legacy = () => {
				try {
					if (typeof document === 'undefined' || !document.body) return false
					const area = document.createElement('textarea')
					area.value = text
					area.setAttribute('readonly', '')
					area.style.position = 'fixed'
					area.style.top = '-1000px'
					document.body.appendChild(area)
					area.select()
					const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
					document.body.removeChild(area)
					return ok
				} catch (error) {
					return false
				}
			}
			try {
				if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
					return navigator.clipboard.writeText(text).then(() => true, legacy)
				}
			} catch (error) {
				/* fall through to the legacy path */
			}
			return Promise.resolve(legacy())
		}

		/** Host route that probes pages; see the host half in lib/index.js. */
		const META_ROUTE = '/dsh-links/meta'
		/** One URL per request: metadata is fetched linearly, never concurrently. */
		const META_BATCH = 1
		/** Gap between two linear metadata requests, to keep the network quiet. */
		const META_GAP_MS = 120
		/** Cap on probes for rows still missing a title/icon or dead: they are never skipped. */
		const META_REQUEST_LIMIT = 200
		/** Cap on re-fetching rows whose title is already known and merely old. */
		const META_REFRESH_LIMIT = 12
		/** A resolved title/icon is reused for a day before a background re-check. */
		const META_OK_TTL_MS = 24 * 60 * 60 * 1000
		/** A failed probe (timeout, bot block) is retried after this long. */
		const META_RETRY_MS = 5 * 60 * 1000
		/** A row judged dead is re-checked after this long, in case the page is back. */
		const META_DEAD_RECHECK_MS = 6 * 60 * 60 * 1000
		/** Shown when the Host probe route cannot be reached at all. */
		const META_UNAVAILABLE_NOTICE =
			'探测服务不可用：Host 插件未加载或网络被阻断。完全退出并重新打开 DeepSeek Harness 后重试。'

		/**
		 * Probe reasons that put a row into the collapsed "已隐藏" section rather than the
		 * main list. Nothing is deleted: the row stays reachable from that section.
		 */
		const META_DEAD_REASONS = new Set(['gone', 'dns', 'refused', 'blocked'])
		/** Global link-items table: url → {title, host, icon, status, ok, reason, at}. */
		const META_STORE_KEY = 'dsh-links.linkitems.v1'
		/** Legacy metadata keys, read once for migration. */
		const LEGACY_STORE_KEYS = ['dsh-links.probes.v3', 'dsh-links.probes.v2', 'dsh-links.probes.v1', 'dsh-links.titles.v1']
		/** Maximum remembered probes; the oldest entries fall out first. */
		const META_STORE_LIMIT = 600

		/**
		 * Normalize one stored probe record, tolerating every older format.
		 * @param {unknown} value - stored value.
		 * @returns {{title: string, icon: string, dead: boolean, ok: boolean, reason: string, at: number} | null} probe.
		 */
		function normalizeProbe(value) {
			if (typeof value === 'string') {
				return value === '' ? null : { title: value, icon: '', dead: false, ok: true, reason: 'ok', at: 0 }
			}
			if (!value || typeof value !== 'object') return null
			const title = typeof value.title === 'string' ? value.title : ''
			const icon = typeof value.icon === 'string' ? value.icon : ''
			const dead = value.dead === true
			const ok = value.ok !== false
			const reason = typeof value.reason === 'string' ? value.reason : ok ? 'ok' : dead ? 'gone' : 'failed'
			const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
			const host = typeof value.host === 'string' ? value.host : ''
			const status = typeof value.status === 'number' && Number.isFinite(value.status) ? value.status : 0
			// Old caches may hold "dead" verdicts from a bad network moment; ignore them.
			if (dead) return null
			if (title === '' && icon === '' && ok) return null
			return { title, icon, host, status, dead: false, ok, reason, at }
		}

		/**
		 * Read metadata probed in earlier mounts. Titles and icons show immediately;
		 * age decides what is re-checked, so a session never re-fetches everything.
		 * @returns {Record<string, object>} probes by URL.
		 */
		function loadProbes() {
			const store = ignoreStore()
			if (!store) return {}
			const probes = {}
			try {
				let raw = store.getItem(META_STORE_KEY)
				if (!raw) {
					for (const key of LEGACY_STORE_KEYS) {
						raw = store.getItem(key)
						if (raw) break
					}
				}
				if (!raw) return {}
				const parsed = JSON.parse(raw)
				if (!parsed || typeof parsed !== 'object') return {}
				for (const [url, value] of Object.entries(parsed)) {
					const probe = normalizeProbe(value)
					if (probe !== null) probes[url] = probe
				}
			} catch (error) {
				return {}
			}
			return probes
		}

		/**
		 * Remember probed metadata for the next mount.
		 * @param {Record<string, object>} probes - probes by URL.
		 * @returns {void}
		 */
		function saveProbes(probes) {
			const store = ignoreStore()
			if (!store) return
			try {
				const entries = Object.entries(probes).filter(([, probe]) => {
					if (!probe || typeof probe !== 'object') return false
					// "Unreachable" is a per-session observation, not a durable fact: persisting
					// it hid every row after one bad network or Host state.
					if (probe.dead === true) return false
					return probe.title !== '' || probe.icon !== ''
				})
				const kept = entries.slice(-META_STORE_LIMIT).map(([url, probe]) => {
					let host = typeof probe.host === 'string' ? probe.host : ''
					if (host === '') {
						try {
							host = new URL(url).hostname.toLowerCase()
						} catch (error) {
							host = ''
						}
					}
					return [
						url,
						{
							title: probe.title,
							host,
							status: typeof probe.status === 'number' ? probe.status : 0,
							icon: probe.icon,
							ok: probe.ok !== false,
							reason: probe.reason,
							at: probe.at,
						},
					]
				})
				// Never delete the stored metadata: an empty in-memory map (for example right
				// after a rescan clears it) must not wipe titles and icons gathered earlier.
				if (kept.length === 0) return
				store.setItem(META_STORE_KEY, JSON.stringify(Object.fromEntries(kept)))
			} catch (error) {
				/* quota or partitioning: probes stay in memory for this mount */
			}
		}

		/**
		 * Ask the Host to probe a batch of pages. The Host owns the network access;
		 * its answer is advisory — a missing answer simply leaves rows as they are.
		 * @param {string[]} urls - absolute http(s) URLs.
		 * @param {boolean} [refresh] - bypass the Host's short-lived cache.
		 * @returns {Promise<Record<string, object> | null>} probes by URL.
		 */
		function fetchProbes(urls, refresh) {
			if (typeof fetch !== 'function' || urls.length === 0) return Promise.resolve(null)
			let target
			try {
				const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://127.0.0.1/'
				target = new URL(META_ROUTE, base)
			} catch (error) {
				return Promise.resolve(null)
			}
			target.searchParams.set('urls', JSON.stringify(urls))
			if (refresh) target.searchParams.set('refresh', '1')
			try {
				return fetch(target, { headers: { accept: 'application/json' } })
					.then((response) => (response && response.ok ? response.json() : null))
					.then((payload) => {
						const pages = payload && payload.pages
						if (!pages || typeof pages !== 'object') return null
						const probes = {}
						for (const [url, page] of Object.entries(pages)) {
							if (!page || typeof page !== 'object') continue
							let host = ''
							try {
								host = new URL(url).hostname.toLowerCase()
							} catch (error) {
								host = ''
							}
							probes[url] = {
								title: typeof page.title === 'string' ? page.title : '',
								icon: typeof page.icon === 'string' ? page.icon : '',
								host,
								status: typeof page.status === 'number' && Number.isFinite(page.status) ? page.status : 0,
								dead: page.dead === true,
								ok: page.ok !== false,
								reason: typeof page.reason === 'string' ? page.reason : '',
								at: 0,
							}
						}
						return { probes, build: payload && typeof payload.build === 'string' ? payload.build : '' }
					})
					.catch((error) => ({ probes: null, build: '', error: String((error && error.message) || error) }))
			} catch (error) {
				return Promise.resolve(null)
			}
		}

		/**
		 * Membership test for the per-cycle request guard.
		 * @param {Set<string>} requested - URLs already asked for.
		 * @param {string} url - row URL.
		 * @returns {boolean} true when already requested this cycle.
		 */
		function requestedHas(requested, url) {
			return !!(requested && typeof requested.has === 'function' && requested.has(url))
		}

		/**
		 * Whether a probed URL is gone rather than merely unreadable from this Host:
		 * only 404/410, an unresolvable name, a refused connection, or a non-public
		 * resolution keep a row hidden. A timeout or a bot block leaves it visible.
		 * @param {Record<string, object>} probes - probes by URL.
		 * @param {string} url - row URL.
		 * @returns {boolean} true when the row should not be shown.
		 */
		function isUnavailableProbe(probes, url) {
			const probe = probes ? probes[url] : undefined
			if (!probe || typeof probe !== 'object') return false
			const reason = typeof probe.reason === 'string' ? probe.reason : ''
			// An HTTP error (including 404) still reached the site: the page renders, so the
			// link is accessible. Only network-level failures count as unavailable.
			if (reason === 'http-error' || reason === 'gone') return false
			if (probe.ok === false) return true
			return META_DEAD_REASONS.has(reason)
		}

		// ------------------------------------------------------------------
		// Styles
		// ------------------------------------------------------------------

		const COLOR_LABEL_PRIMARY = 'var(--dsw-alias-label-primary)'
		const COLOR_LABEL_SECONDARY = 'var(--dsw-alias-label-secondary)'
		const COLOR_LABEL_TERTIARY = 'var(--dsw-alias-label-tertiary)'
		const COLOR_BORDER = 'var(--dsw-alias-border-l1)'
		const COLOR_FILL = 'var(--dsw-alias-fill-l2)'

		const S = {
			root: {
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				minHeight: 0,
				position: 'relative',
				boxSizing: 'border-box',
				padding: '16px',
				color: COLOR_LABEL_PRIMARY,
				fontSize: 13,
			},
			header: {
				display: 'flex',
				alignItems: 'baseline',
				gap: 8,
				padding: '10px 12px 2px',
				flex: 'none',
			},
			title: { fontSize: 13, fontWeight: 600, flex: 'none' },
			count: { color: COLOR_LABEL_TERTIARY, fontSize: 12, flex: 1, minWidth: 0 },
			sort: {
				font: 'inherit',
				fontSize: 12,
				lineHeight: '20px',
				padding: '0 8px',
				borderRadius: 6,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: 'transparent',
				color: COLOR_LABEL_SECONDARY,
				cursor: 'pointer',
				flex: 'none',
			},
			searchWrap: { position: 'relative', margin: 8, flex: 'none' },
			search: {
				width: '100%',
				boxSizing: 'border-box',
				height: 32,
				font: 'inherit',
				fontSize: 12,
				lineHeight: '32px',
				padding: '0 32px 0 8px',
				borderRadius: 8,
				border: 'none',
				// Same surface as a hovered link row (token may be absent in some themes).
				background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,0.12))',
				color: COLOR_LABEL_PRIMARY,
				outline: 'none',
			},
			searchButton: {
				position: 'absolute',
				right: 4,
				top: '50%',
				transform: 'translateY(-50%)',
				width: 24,
				height: 24,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: 0,
				border: 'none',
				borderRadius: 6,
				background: 'transparent',
				color: COLOR_LABEL_TERTIARY,
				cursor: 'pointer',
			},
			filters: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 12px', flex: 'none' },
			chip: (active) => ({
				font: 'inherit',
				fontSize: 12,
				lineHeight: '20px',
				padding: '0 8px',
				borderRadius: 999,
				border: `0.5px solid ${active ? 'transparent' : COLOR_BORDER}`,
				background: active ? COLOR_LABEL_PRIMARY : 'transparent',
				color: active ? 'var(--dsw-alias-bg-layer-1)' : COLOR_LABEL_SECONDARY,
				cursor: 'pointer',
			}),
			scroll: {
				flex: 1,
				minHeight: 0,
				overflowY: 'auto',
				padding: '0 0 8px',
				borderRadius: 8,
			},
			groupHeader: {
				display: 'flex',
				alignItems: 'baseline',
				gap: 6,
				padding: '8px',
				fontSize: 11,
				fontWeight: 500,
				letterSpacing: 0.3,
				color: COLOR_LABEL_TERTIARY,
			},
			row: {
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				padding: '7px 10px',
				borderRadius: 8,
				cursor: 'pointer',
			},
			favicon: { flex: 'none', width: 16, height: 16, borderRadius: 4, objectFit: 'cover', display: 'block' },
			faviconFallback: (tag) => ({
				flex: 'none',
				width: 16,
				height: 16,
				borderRadius: 4,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				fontSize: 9,
				fontWeight: 700,
				color: '#fff',
				background: TAG_COLOR[tag] || TAG_COLOR.doc,
			}),
			rowMain: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
			rowTitle: {
				flex: 1,
				minWidth: 0,
				overflow: 'hidden',
				whiteSpace: 'nowrap',
				fontSize: 13,
				lineHeight: '20px',
				// Long titles fade out under a gradient mask instead of an ellipsis.
				maskImage: 'linear-gradient(to right, #000 calc(100% - 28px), transparent 100%)',
				WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 28px), transparent 100%)',
			},
			rowCount: {
				flex: 'none',
				fontSize: 11,
				lineHeight: '16px',
				fontVariantNumeric: 'tabular-nums',
				padding: '0 6px',
				borderRadius: 999,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: 'var(--dsw-alias-bg-layer-2)',
				color: COLOR_LABEL_SECONDARY,
				cursor: 'help',
			},
			editorBackdrop: {
				position: 'fixed',
				inset: 0,
				zIndex: 50,
				display: 'flex',
				alignItems: 'flex-start',
				justifyContent: 'center',
				paddingTop: 120,
				background: 'transparent',
			},
			editorCard: {
				width: 320,
				maxWidth: 'calc(100vw - 32px)',
				padding: 10,
				borderRadius: 8,
				background: 'var(--dsw-alias-bg-layer-2)',
				border: `0.5px solid ${COLOR_BORDER}`,
				boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
			},
			editorInput: {
				height: 30,
				padding: '0 8px',
				font: 'inherit',
				fontSize: 12,
				borderRadius: 6,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: 'transparent',
				color: COLOR_LABEL_PRIMARY,
				outline: 'none',
			},
			editorActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
			editorButton: {
				font: 'inherit',
				fontSize: 12,
				lineHeight: '22px',
				padding: '0 10px',
				borderRadius: 6,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: 'transparent',
				color: COLOR_LABEL_PRIMARY,
				cursor: 'pointer',
			},
			hoverTip: {
				position: 'fixed',
				zIndex: 60,
				pointerEvents: 'none',
				padding: '3px 8px',
				borderRadius: 6,
				background: 'var(--dsw-alias-bg-layer-2, #2a2a2a)',
				border: `0.5px solid ${COLOR_BORDER}`,
				boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
				fontSize: 11,
				lineHeight: '16px',
				color: COLOR_LABEL_SECONDARY,
				whiteSpace: 'nowrap',
			},
			countTip: {
				position: 'fixed',
				zIndex: 40,
				maxWidth: 320,
				padding: '6px 8px',
				borderRadius: 8,
				background: 'var(--dsw-alias-bg-layer-2)',
				border: `0.5px solid ${COLOR_BORDER}`,
				boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
				color: COLOR_LABEL_SECONDARY,
				fontSize: 11,
				lineHeight: '16px',
				pointerEvents: 'none',
				display: 'flex',
				flexDirection: 'column',
				gap: 2,
			},
			countTipTitle: { color: COLOR_LABEL_TERTIARY },
			more: {
				flex: 'none',
				font: 'inherit',
				fontSize: 14,
				lineHeight: '18px',
				width: 22,
				height: 20,
				padding: 0,
				border: 'none',
				borderRadius: 4,
				background: 'transparent',
				color: COLOR_LABEL_TERTIARY,
				cursor: 'pointer',
			},
			menu: {
				position: 'fixed',
				zIndex: 30,
				minWidth: 176,
				padding: 0,
				overflow: 'hidden',
				borderRadius: 8,
				background: 'var(--dsw-alias-bg-layer-2)',
				border: `0.5px solid ${COLOR_BORDER}`,
				boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
				display: 'flex',
				flexDirection: 'column',
				gap: 1,
			},
			menuItem: {
				font: 'inherit',
				fontSize: 12,
				lineHeight: '20px',
				padding: '6px 10px',
				border: 'none',
				borderRadius: 0,
				background: 'transparent',
				color: COLOR_LABEL_PRIMARY,
				cursor: 'pointer',
				textAlign: 'left',
				whiteSpace: 'nowrap',
			},
			splash: {
				flex: 1,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 12,
				color: COLOR_LABEL_TERTIARY,
			},
			loadingOverlay: {
				position: 'absolute',
				inset: 0,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 12,
				background: 'transparent',
				color: COLOR_LABEL_TERTIARY,
				zIndex: 10,
			},
			loadingText: { fontSize: 12 },
			empty: {
				padding: '28px 0',
				textAlign: 'center',
				color: COLOR_LABEL_TERTIARY,
				fontSize: 12,
				lineHeight: '20px',
			},
			footer: {
				flex: 'none',
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				padding: '8px 0 0',
				margin: '8px 0 0',
				borderTop: `0.5px solid ${COLOR_BORDER}`,
				fontSize: 11,
				color: COLOR_LABEL_TERTIARY,
			},
			footerGrow: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
			footerButton: {
				font: 'inherit',
				fontSize: 11,
				lineHeight: '18px',
				padding: '0 8px',
				borderRadius: 6,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: 'transparent',
				color: COLOR_LABEL_SECONDARY,
				cursor: 'pointer',
				flex: 'none',
			},
			banner: {
				flex: 'none',
				margin: '8px 0 0',
				padding: '6px 8px',
				borderRadius: 6,
				border: `0.5px solid ${COLOR_BORDER}`,
				background: COLOR_FILL,
				color: COLOR_LABEL_SECONDARY,
				fontSize: 11,
				lineHeight: '16px',
			},
			notice: {
				position: 'absolute',
				left: 16,
				right: 16,
				bottom: 16,
				padding: '6px 10px',
				borderRadius: 6,
				background: 'var(--dsw-alias-bg-layer-2)',
				border: `0.5px solid ${COLOR_BORDER}`,
				color: COLOR_LABEL_SECONDARY,
				fontSize: 12,
				lineHeight: '18px',
				boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
				display: 'flex',
				alignItems: 'baseline',
				gap: 8,
			},
			noticeText: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
			noticeAction: {
				font: 'inherit',
				fontSize: 11,
				lineHeight: '18px',
				padding: '0 4px',
				border: 'none',
				borderRadius: 4,
				background: 'transparent',
				color: COLOR_LABEL_PRIMARY,
				textDecoration: 'underline',
				cursor: 'pointer',
				flex: 'none',
			},
		}

		/** Hover and focus affordances that inline styles cannot express. */
		const ROW_CSS = `
.dsh-links-row:hover{background:var(--dsw-alias-fill-l2,rgba(127,127,127,0.12))}
.dsh-links-row:focus-visible{outline:2px solid var(--dsw-alias-label-primary,rgba(127,127,127,0.55));outline-offset:-2px}
.dsh-links-title{opacity:0.8}
.dsh-links-row:hover .dsh-links-title{opacity:1}
.dsh-links-row:hover .dsh-links-more{color:var(--dsw-alias-label-secondary)}
.dsh-links-more:focus-visible{outline:2px solid var(--dsw-alias-label-primary,rgba(127,127,127,0.55));outline-offset:-2px}
.dsh-links-turn-item{cursor:pointer;border-radius:4px;padding:3px 6px;margin:0 -6px}
.dsh-links-turn-item:hover{background:rgba(127,127,127,0.14);background:color-mix(in srgb,currentColor 9%,transparent)}
.dsh-links-menu-item{border-radius:0;transition:background .12s ease}
.dsh-links-menu-item{color:var(--dsw-alias-label-primary,inherit)}
.dsh-links-menu-item:hover{background:rgba(127,127,127,0.14)!important;background:color-mix(in srgb,currentColor 9%,transparent)!important}
.dsh-links-menu-item:active{background:rgba(127,127,127,0.22)!important;background:color-mix(in srgb,currentColor 14%,transparent)!important}
.dsh-links-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,rgba(64,128,255,0.7));outline-offset:-2px}
.dsh-links-section .dsh-links-chevron{opacity:0;transition:opacity .12s ease}
.dsh-links-section:hover .dsh-links-chevron,.dsh-links-section:focus-within .dsh-links-chevron{opacity:1}
.dsh-links-spinner-lg{width:22px;height:22px;border-width:2.5px}
.dsh-links-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,0.3));border-top-color:var(--dsw-alias-label-secondary,rgba(127,127,127,0.9));border-radius:50%;animation:dsh-links-spin 0.8s linear infinite}
@keyframes dsh-links-spin{to{transform:rotate(360deg)}}
`

		// ------------------------------------------------------------------
		// Components
		// ------------------------------------------------------------------

		/** Human name of one occurrence source. */
		const SOURCE_LABEL = { user: '我发的', tool: '工具带回', assistant: '回答引用' }

		/**
		 * Linear queue for favicon images. The browser would fetch every row's icon at
		 * once, which is exactly the burst this panel must avoid; icons load one at a
		 * time and results are remembered for the session.
		 */
		const iconQueue = { waiting: [], active: false, loaded: new Set(), failed: new Set() }

		/**
		 * Request one icon through the queue.
		 * @param {string} url - icon URL (already cache-busted when refreshing).
		 * @param {(ok: boolean) => void} onResult - called once the image settles.
		 * @returns {() => void} cancellation.
		 */
		function enqueueIcon(url, onResult) {
			if (iconQueue.loaded.has(url)) {
				onResult(true)
				return () => {}
			}
			if (iconQueue.failed.has(url)) {
				onResult(false)
				return () => {}
			}
			const entry = { url, onResult, cancelled: false }
			iconQueue.waiting.push(entry)
			pumpIcons()
			return () => {
				entry.cancelled = true
			}
		}

		/** Start the next queued icon, one image at a time. */
		function pumpIcons() {
			if (iconQueue.active) return
			const entry = iconQueue.waiting.shift()
			if (entry === undefined) return
			if (entry.cancelled) {
				pumpIcons()
				return
			}
			iconQueue.active = true
			const finish = (ok) => {
				iconQueue.active = false
				if (ok) iconQueue.loaded.add(entry.url)
				else iconQueue.failed.add(entry.url)
				entry.onResult(ok)
				setTimeout(pumpIcons, 40)
			}
			let image
			try {
				image = new Image()
			} catch (error) {
				finish(false)
				return
			}
			image.referrerPolicy = 'no-referrer'
			image.onload = () => finish(true)
			image.onerror = () => finish(false)
			image.src = entry.url
		}

		/**
		 * One row's site icon: the site's own favicon, with a category-coloured
		 * letter tile when it cannot be loaded.
		 * @param {{reference: object}} props - the row.
		 * @returns {object} React element.
		 */
		/** Icon URLs that already failed to load in this page; never retried. */
		const FAILED_ICON_URLS = new Set()
		/** First icon that loaded for a row key, reused so re-renders never swap the image. */
		const ICON_CHOICE = new Map()

		/**
		 * The row icon. One source is chosen up front, so a re-render (probe update, hover)
		 * never swaps the image and makes it flash; a failed load settles on the hash icon.
		 * @param {{reference: object, icon: string, fallback: string, epoch: number}} props icon sources.
		 * @returns {object} React element.
		 */
		function Favicon({ reference, icon, fallback, epoch, onLoaded }) {
			const primary = typeof icon === 'string' && icon !== '' && !FAILED_ICON_URLS.has(icon) ? icon : ''
			const fallbackIcon = typeof fallback === 'string' && fallback !== '' ? fallback : hashIconFor(reference.host)
			const chosen = primary !== '' ? primary : fallbackIcon
			const [failed, setFailed] = React.useState(false)
			const src = !failed ? chosen : fallbackIcon
			return h('img', {
				src,
				alt: '',
				style: S.favicon,
				referrerPolicy: 'no-referrer',
				onLoad: () => {
					if (typeof onLoaded === 'function') onLoaded(chosen)
				},
				onError: () => {
					if (primary !== '') FAILED_ICON_URLS.add(primary)
					setFailed(true)
				},
			})
		}

		/**
		 * One action inside the row overflow menu.
		 * @param {{label: string, onSelect: Function}} props - label and action.
		 * @returns {object} React element.
		 */
		function MenuItem({ label, onSelect }) {
			return h(
				'button',
				{
					type: 'button',
					className: 'dsh-links-menu-item',
					style: S.menuItem,
					onClick: (event) => {
						event.stopPropagation()
						onSelect()
					},
				},
				label,
			)
		}

		/**
		 * One link row: site icon, page title (or the URL when no title is known),
		 * and an overflow menu holding the row actions.
		 * @param {{reference: object, ignored: boolean, title: string, onOpen: Function,
		 *   onToggleMenu: Function}} props - row data and callbacks.
		 * @returns {object} React element.
		 */
		function LinkRow({ reference, ignored, unreachable, title, icon, iconSources, iconEpoch, refreshing, onOpen, onToggleMenu, onCountHover, onTooltip }) {
			const [hoveringOpen, setHoveringOpen] = React.useState(false)
			const [marqueeShift, setMarqueeShift] = React.useState(0)
			const titleRef = React.useRef(null)
			const startMarquee = () => {
				const node = titleRef.current
				if (!node) return
				const overflow = node.scrollWidth - node.clientWidth
				setMarqueeShift(overflow > 4 ? -overflow : 0)
			}
			const stopMarquee = () => setMarqueeShift(0)
			const sources = []
			if (reference.bySource.user > 0) sources.push('我发的')
			if (reference.bySource.tool > 0) sources.push('工具带回')
			if (reference.bySource.assistant > 0) sources.push('回答引用')
			const tip = reference.occurrences
				.slice(0, 5)
				.map((item) => {
					const where = item.turn ? `第 ${item.turn} 轮` : '早期'
					const who = SOURCE_LABEL[item.source] || item.source
					return `· ${where} · ${who}${item.snippet ? `：${item.snippet}` : ''}`
				})
				.join('\n')
			const tags = Array.isArray(reference.tags) ? reference.tags : []
			const meta = []
			if (tags.length) meta.push(`标签：${tags.map((tag) => TAG_LABEL[tag] || tag).join(' · ')}`)
			if (sources.length) meta.push(sources.join(' · '))
			if (reference.lastTurn) meta.push(`第 ${reference.lastTurn} 轮`)
			if (ignored) meta.push('已隐藏')
			const urlTip = middleEllipsis(reference.url)
			const rowRef = React.useRef(null)
			const showRowTip = () => {
				const node = rowRef.current
				if (!node) return
				onTooltip({ key: reference.key, rect: node.getBoundingClientRect(), text: urlTip })
			}
			const showCountTip = (event) => {
				onTooltip({
					key: reference.key,
					rect: event.currentTarget.getBoundingClientRect(),
					text: `在 ${turnCountOf(reference)} 轮对话中提及`,
				})
			}
			return h(
				'div',
				{
					ref: rowRef,
					className: 'dsh-links-row',
					style: ignored ? { ...S.row, opacity: 0.6 } : S.row,
					'aria-label': urlTip,
					role: 'link',
					tabIndex: 0,
					onMouseEnter: () => {
						setHoveringOpen(true)
						showRowTip()
					},
					onMouseLeave: () => {
						setHoveringOpen(false)
						onTooltip(null)
					},
					onClick: (event) => onOpen(reference, event),
					onKeyDown: (event) => {
						if (event.target !== event.currentTarget) return
						if (event.key !== 'Enter' && event.key !== ' ') return
						event.preventDefault()
						onOpen(reference, event)
					},
					onAuxClick: (event) => {
						if (event.button === 1) onOpen(reference, { metaKey: true })
					},
				},
				h(
					'div',
					{ style: unreachable ? { ...S.rowMain, opacity: 0.5 } : S.rowMain },
					refreshing
						? h('span', { key: 'spinner', className: 'dsh-links-spinner', 'aria-label': '刷新中' })
						: hoveringOpen
						? h(
								'span',
								{
									key: 'open-icon',
									style: {
										flex: 'none',
										width: 16,
										height: 16,
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										color: COLOR_LABEL_SECONDARY,
									},
								},
								h(
									'svg',
									{
										width: 14,
										height: 14,
										viewBox: '0 0 16 16',
										fill: 'none',
										stroke: 'currentColor',
										strokeWidth: 1.5,
										strokeLinecap: 'round',
										strokeLinejoin: 'round',
										'aria-hidden': 'true',
									},
									h('path', { d: 'M9.5 2.5H13.5V6.5' }),
									h('path', { d: 'M13.5 2.5L7.5 8.5' }),
									h('path', { d: 'M11.5 9.5V12.5A1 1 0 0 1 10.5 13.5H3.5A1 1 0 0 1 2.5 12.5V5.5A1 1 0 0 1 3.5 4.5H6.5' }),
								),
							)
						: h(Favicon, {
								key: reference.key,
								reference,
								icon: Array.isArray(iconSources) ? iconSources[0] || icon : icon,
								fallback: Array.isArray(iconSources) ? iconSources[1] : '',
								epoch: iconEpoch,
							}),
					h(
						'div',
						{
							ref: titleRef,
							className: 'dsh-links-title',
							style: {
								...S.rowTitle,
								// While scrolling, the gradient mask would eat the revealed tail.
								maskImage: marqueeShift === 0 ? S.rowTitle.maskImage : 'none',
							},
							onMouseEnter: startMarquee,
							onMouseLeave: stopMarquee,
						},
						h(
							'span',
							{
								style: {
									display: 'inline-block',
									whiteSpace: 'nowrap',
									transform: `translateX(${marqueeShift}px)`,
									transition:
										marqueeShift === 0 ? 'transform 0.25s ease-out' : 'transform 2.4s ease-in-out',
								},
							},
							title,
						),
					),
				),
				h(
					'span',
					{
						style: { ...S.rowCount, cursor: 'pointer' },
						onMouseEnter: (event) => {
							event.stopPropagation()
							showCountTip(event)
						},
						onMouseLeave: (event) => {
							event.stopPropagation()
							showRowTip()
						},
						onClick: (event) => {
							event.stopPropagation()
							const rect = event.currentTarget.getBoundingClientRect()
							onCountHover({ key: reference.key, rect, reference })
						},
					},
					String(
						Array.isArray(reference.turns) && reference.turns.length > 0
							? reference.turns.length
							: reference.turnCount || reference.count,
					),
				),
				h(
					'button',
					{
						type: 'button',
						className: 'dsh-links-more',
						style: S.more,
						title: '更多操作',
						'aria-label': '更多操作',
						onClick: (event) => {
							event.stopPropagation()
							const rect = event.currentTarget.getBoundingClientRect()
							onToggleMenu({ key: reference.key, rect })
						},
					},
					'⋮',
				),
			)
		}

		/**
		 * Build the tab body component bound to the plugin context.
		 * @param {object} ctx - client root context.
		 * @returns {Function} the React component for the `links` tab body.
		 */
		function makeBody(ctx) {
			return function LinksBody(props) {
				const sessionId = props && props.sessionId
				const useTabInfo = props && props.useTabInfo
				const useSession = props && props.useSession
				const useSessionHook = typeof useSession === 'function' ? useSession : useNoSession
				const openState = useSessionHook((snapshot) => snapshot && snapshot.openState)
				const [retryTick, setRetryTick] = React.useState(0)
				const binding = React.useMemo(() => {
					try {
						if (ctx && ctx.sessions && typeof ctx.sessions.binding === 'function') {
							return ctx.sessions.binding(sessionId) || null
						}
					} catch (error) {
						/* not retained yet */
					}
					return null
				}, [sessionId, openState, retryTick])
				React.useEffect(() => {
					if (binding) return undefined
					let attempts = 0
					const timer = setInterval(() => {
						attempts += 1
						if (attempts > 33) {
							clearInterval(timer)
							return
						}
						setRetryTick((tick) => tick + 1)
					}, 600)
					return () => clearInterval(timer)
				}, [binding])
				const eventSource = binding ? binding.eventSource : null
				const subscribe = React.useCallback((notify) => (eventSource ? eventSource.subscribe(notify) : () => {}), [eventSource])
				const getSnapshot = React.useCallback(() => (eventSource ? eventSource.getSnapshot() : EMPTY_SNAPSHOT), [eventSource])
				const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
				const tabInfo = typeof useTabInfo === 'function' ? useTabInfo() : null
				const tab = tabInfo && tabInfo.tab ? tabInfo.tab : null
				const [query, setQuery] = React.useState('')
				const [loadingOlder, setLoadingOlder] = React.useState(false)

				const [ignored, setIgnored] = React.useState(() => loadIgnores(sessionId))
				const [blockedHosts, setBlockedHosts] = React.useState(() => loadBlockedHosts())
				const [linksCache, setLinksCache] = React.useState(() => loadLinksCache(sessionId))
				const scannedSeqRef = React.useRef(linksCache.seq)
				const scannedMinSeqRef = React.useRef(linksCache.minSeq)
				const completeRef = React.useRef(linksCache.complete === true)
				const scanStateRef = React.useRef(null)
				const [completeState, setCompleteState] = React.useState(linksCache.complete === true)
				const isRowHidden = React.useCallback(
					(reference) => isIgnored(reference, ignored) || hostIgnored(reference.host, Array.from(blockedHosts)),
					[ignored, blockedHosts],
				)
				const [pinned, setPinned] = React.useState(() => loadPins())
				const pinnedRef = React.useRef(pinned)
				pinnedRef.current = pinned
				// Pins are global and must survive every reload/restart.
				React.useEffect(() => {
					savePins(pinned)
				}, [pinned])
				React.useEffect(
					() => () => {
						savePins(pinnedRef.current)
					},
					[],
				)
				const [hostsTable, setHostsTable] = React.useState(() => loadHostsTable())

				const [customTitles, setCustomTitles] = React.useState(() => loadCustomTitles())
				const [titleEditor, setTitleEditor] = React.useState(null)
				const titleEditorInputRef = React.useRef(null)
				const [ignoredSession, setIgnoredSession] = React.useState(sessionId)
				const [pinnedOpen, setPinnedOpen] = React.useState(true)
				const [allOpen, setAllOpen] = React.useState(true)
				const [hiddenOpen, setHiddenOpen] = React.useState(false)
				const [probes, setProbes] = React.useState(() => loadProbes())
				const searchInputRef = React.useRef(null)
				const [metaEpoch, setMetaEpoch] = React.useState(0)
				const [probeError, setProbeError] = React.useState('')
				const [hostBuild, setHostBuild] = React.useState('')
				const [refreshing, setRefreshing] = React.useState(false)
				const [menu, setMenu] = React.useState(null)
				const [countTip, setCountTip] = React.useState(null)
				const [tooltip, setTooltip] = React.useState(null)
				const [panelVisible, setPanelVisible] = React.useState(true)
				const [autoProbing, setAutoProbing] = React.useState(() => new Set())
				const [autoTotal, setAutoTotal] = React.useState(0)
				const [autoDone, setAutoDone] = React.useState(0)
				const [sessionEpoch, setSessionEpoch] = React.useState(0)
				const autoRefreshRef = React.useRef({ timer: null, at: 0 })
				const rootRef = React.useRef(null)
				const [refreshingUrls, setRefreshingUrls] = React.useState(() => new Set())
				const [splashDone, setSplashDone] = React.useState(false)
				const [historyDone, setHistoryDone] = React.useState(false)
				const scanStoreRef = React.useRef(null)
				if (scanStoreRef.current === null) {
					scanStoreRef.current = { cache: new Map(), callNames: new Map() }
				}
				// A keep-mounted tab can outlive the session it was opened for: reload the
				// ignore list when the bound session changes.
				if (ignoredSession !== sessionId) {
					setIgnoredSession(sessionId)
					setIgnored(loadIgnores(sessionId))
					const nextCache = loadLinksCache(sessionId)
					setLinksCache(nextCache)
					// Reset the incremental state to the newly bound conversation.
					scanStateRef.current = null
					scannedSeqRef.current = nextCache.seq
					scannedMinSeqRef.current =
						nextCache.rows.length > 0 && Number.isFinite(nextCache.minSeq) && nextCache.minSeq !== 0
							? nextCache.minSeq
							: Number.MAX_SAFE_INTEGER
					completeRef.current = nextCache.complete === true
					setCompleteState(nextCache.complete === true)
					// Metadata is global (keyed by URL), so switching sessions must neither
					// drop it from memory nor overwrite the shared cache with an empty object.
					setProbes((current) => ({ ...loadProbes(), ...current }))
					setMenu(null)
					setProbeError('')
					setSessionEpoch((epoch) => epoch + 1)
					autoRefreshRef.current = { timer: null, at: 0 }
					setAutoProbing(new Set())
					setAutoTotal(0)
					setAutoDone(0)
					scanStoreRef.current = { cache: new Map(), callNames: new Map() }
				}
				// Rows = conversation items table (cached rows ∪ current window scan).
				const all = React.useMemo(() => {
					const store = scanStoreRef.current
					const scanned = aggregate(snapshot.entries, store.cache, store.callNames)
					let newest = scannedSeqRef.current
					let lowest = scannedMinSeqRef.current
					for (const entry of snapshot.entries || []) {
						const seq = entry && entry.event ? entry.event.seq : null
						if (typeof seq !== 'number') continue
						if (seq > newest) newest = seq
						if (seq < lowest) lowest = seq
					}
					scannedSeqRef.current = newest
					scannedMinSeqRef.current = lowest
					if (!snapshot.hasMore) return scanned
					if (linksCache.rows.length === 0) return scanned
					return mergeRows(linksCache.rows, scanned)
				}, [snapshot, linksCache])

				// Persist the favicon cache (debounced) and flush it when the panel unmounts, so
				// switching conversations never loses icons that were just fetched.
				const hostsTableRef = React.useRef(hostsTable)
				hostsTableRef.current = hostsTable
				React.useEffect(
					() => () => {
						saveHostsTable(hostsTableRef.current)
					},
					[],
				)
				const iconSaveRef = React.useRef(null)
				React.useEffect(() => {
					if (iconSaveRef.current !== null) clearTimeout(iconSaveRef.current)
					iconSaveRef.current = setTimeout(() => {
						iconSaveRef.current = null
						saveHostsTable(hostsTable)
					}, 250)
					return () => {
						if (iconSaveRef.current !== null) {
							clearTimeout(iconSaveRef.current)
							iconSaveRef.current = null
						}
					}
				}, [hostsTable])

				// Fetch missing favicons one at a time through the Host proxy, then cache bytes.
				const iconQueueRef = React.useRef(new Set())
				// host → timestamp of the last failed attempt; retried after a minute so a
				// restarted Host (which can now reach the network) recovers by itself.
				const iconFailedRef = React.useRef(new Map())
				React.useEffect(() => {
					if (typeof fetch !== 'function') return undefined
					let cancelled = false
					const targets = []
					for (const reference of all) {
						const host = reference.host.replace(/^www\./, '')
						const domain = rootDomain(reference.host)
						if (hostsTable[host] !== undefined || hostsTable[domain] !== undefined) continue
						const failedAt = iconFailedRef.current.get(host)
						if ((failedAt !== undefined && Date.now() - failedAt < 60000) || iconQueueRef.current.has(host)) continue
						iconQueueRef.current.add(host)
						targets.push({ host, domain })
						if (targets.length >= 6) break
					}
					if (targets.length === 0) return undefined
					const fetchIcon = async (iconUrl) => {
						try {
							const target = new URL(ICON_ROUTE, typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://127.0.0.1/')
							target.searchParams.set('url', iconUrl)
							const response = await fetch(target)
							if (!response || !response.ok) return ''
							const payload = await response.json()
							return payload && typeof payload.dataUrl === 'string' && payload.dataUrl.indexOf('data:') === 0
								? payload.dataUrl
								: ''
						} catch (error) {
							return ''
						}
					}
					const run = async () => {
						for (const item of targets) {
							if (cancelled) return
							// Prefer the icon URL the page itself declares (probed earlier): many
							// sites answer 404 on /favicon.ico while their real icon lives elsewhere.
							const hostCandidates = [`https://${item.host}/favicon.ico`]
							let cachedIn = ''
							let dataUrl = ''
							for (const candidate of hostCandidates) {
								if (cancelled) return
								dataUrl = await fetchIcon(candidate)
								if (dataUrl !== '') break
							}
							if (dataUrl !== '') {
								cachedIn = 'hosts'
							} else if (item.domain !== item.host) {
								const domainCandidates = [`https://${item.domain}/favicon.ico`]
								for (const candidate of domainCandidates) {
									if (cancelled) return
									dataUrl = await fetchIcon(candidate)
									if (dataUrl !== '') break
								}
								if (dataUrl !== '') cachedIn = 'domains'
							}
							const cacheKey = cachedIn === 'hosts' ? item.host : cachedIn === 'domains' ? item.domain : ''
							if (cacheKey !== '') {
								setHostsTable((current) =>
									current[cacheKey] ? current : { ...current, [cacheKey]: dataUrl },
								)
							} else {
								iconFailedRef.current.set(item.host, Date.now())
								await new Promise((resolve) => setTimeout(resolve, 300))
							}
						}
					}
					run()
					return () => {
						cancelled = true
					}
				}, [all, hostsTable])

				// Persist the collected list (debounced) so the next open starts from it.
				const linksSaveRef = React.useRef(null)
				React.useEffect(() => {
					if (all.length === 0) return undefined
					// Persist only an authoritative (fully scanned) list.
					if (snapshot.hasMore) return undefined
					if (linksSaveRef.current !== null) clearTimeout(linksSaveRef.current)
					linksSaveRef.current = setTimeout(() => {
						linksSaveRef.current = null
						saveLinksCache(sessionId, all, scannedSeqRef.current, scannedMinSeqRef.current, completeRef.current)
					}, 400)
					return () => {
						if (linksSaveRef.current !== null) {
							clearTimeout(linksSaveRef.current)
							linksSaveRef.current = null
						}
					}
				}, [all, sessionId, snapshot.hasMore])
				// Reachability never removes a row: only static validity rejects a URL.
				const live = all
				const unreachableRows = React.useMemo(
					() => all.filter((reference) => isUnavailableProbe(probes, reference.url)),
					[all, probes],
				)
				const active = React.useMemo(
					() => live.filter((reference) => !isRowHidden(reference)),
					[live, isRowHidden],
				)
				const ignoredRows = React.useMemo(
					() => live.filter((reference) => isRowHidden(reference)),
					[live, isRowHidden],
				)
				const visible = React.useMemo(() => {
					const needle = query.trim().toLowerCase()
					return active
						.filter((reference) => {
							if (needle === '') return true
							const haystack = `${reference.title} ${reference.host} ${reference.pathname} ${reference.url}`.toLowerCase()
							return haystack.indexOf(needle) >= 0
						})
						.sort((left, right) => turnCountOf(right) - turnCountOf(left) || right.lastSeq - left.lastSeq)
				}, [active, query])
				const rows = React.useMemo(() => orderByDomain(visible), [visible])
				const pinnedRows = React.useMemo(() => splitPinned(rows, pinned)[0], [rows, pinned])
				const restRows = React.useMemo(() => splitPinned(rows, pinned)[1], [rows, pinned])

				// The splash owns the panel until the first metadata pass settles: the search
				// box and the list render only afterwards.
				const allowSplash = !(props && props.initialLoading === false)
				const missingMetadata = React.useMemo(
					() =>
						visible.some((reference) => {
							const probe = probes[reference.url]
							return !probe || !probe.title
						}),
					[visible, probes],
				)
				const hasCachedRows = linksCache.rows.length > 0
				const showSplash =
					allowSplash && !splashDone && (missingMetadata || (!historyDone && snapshot.hasMore) || hasCachedRows)



				const savedProbesRef = React.useRef(null)
				React.useEffect(() => {
					const previous = savedProbesRef.current
					savedProbesRef.current = probes
					if (previous === null) return
					if (Object.keys(probes).length === 0) return
					saveProbes(probes)
				}, [probes])

				// Close the row menu on any outside press, Escape, or list scroll.
				const rowMenuRef = React.useRef(null)
				React.useEffect(() => {
					if (menu === null) return undefined
					const onPointerDown = (event) => {
						const root = rowMenuRef.current
						if (root && event.target instanceof Node && root.contains(event.target)) return
						setMenu(null)
					}
					const onKeyDown = (event) => {
						if (event.key === 'Escape') setMenu(null)
					}
					document.addEventListener('pointerdown', onPointerDown, true)
					document.addEventListener('keydown', onKeyDown)
					return () => {
						document.removeEventListener('pointerdown', onPointerDown, true)
						document.removeEventListener('keydown', onKeyDown)
					}
				}, [menu])

				// The panel has no toast surface: every status lives in the footer.
				const showNotice = React.useCallback(() => {}, [])

				/**
				 * Probe page metadata on demand (never in the background): the panel must
				 * not turn opening a tab into a burst of network fetches. Cached titles
				 * render immediately; this fills in and refreshes what is on screen.
				 * @returns {Promise<void>} completion of this refresh pass.
				 */
				/**
				 * Probe page metadata in small sequential batches. Auto-runs once when the
				 * tab first opens (rows whose metadata is missing, reusing the Host cache),
				 * and on demand from the footer button (re-reads everything on screen).
				 * @param {{limit?: number, refreshCache?: boolean}} options - batch budget and
				 *   whether to bypass the Host cache.
				 * @returns {Promise<void>} completion of this pass.
				 */
				const runProbePass = React.useCallback(async (options) => {
					const limit = options && typeof options.limit === 'number' ? options.limit : 16
					const refreshCache = !!(options && options.refreshCache)
					if (refreshing || typeof fetch !== 'function' || visible.length === 0) return
					const targets = Array.isArray(options && options.urls) ? options.urls.slice(0, limit) : []
					if (targets.length === 0) for (const reference of visible) {
						const probe = probes[reference.url]
						if (!refreshCache && probe) {
							if (probe.title) continue
							const age = Date.now() - (probe.at || 0)
							if (age < META_RETRY_MS) continue
						}
						targets.push(reference.url)
						if (targets.length >= limit) break
					}
					if (targets.length === 0) return
					setRefreshing(true)
					let updated = 0
					try {
						// Linear: one URL per request, one request at a time.
						for (const url of targets) {
							let answer = await fetchProbes([url], refreshCache)
							if (!answer) {
								// The Host route may still be registering during a cold start.
								await new Promise((resolve) => setTimeout(resolve, 1200))
								answer = await fetchProbes([url], refreshCache)
							}
							if (!answer || !answer.probes) {
								setProbeError(
									answer && answer.error ? `探测请求失败：${answer.error}` : META_UNAVAILABLE_NOTICE,
								)
								break
							}
							setProbeError('')
							if (answer.build) setHostBuild(answer.build)
							const result = answer.probes
							const now = Date.now()
							setProbes((current) => {
								const next = { ...current }
								for (const [probedUrl, probe] of Object.entries(result)) {
									const previous = next[probedUrl]
									next[probedUrl] = {
										title: probe.title || (previous && previous.title) || '',
										icon: probe.icon || (previous && previous.icon) || '',
										dead: probe.dead === true,
										ok: probe.ok !== false,
										reason: typeof probe.reason === 'string' ? probe.reason : previous ? previous.reason || '' : '',
										at: now,
									}
								}
								return next
							})
							updated += Object.keys(result).length
							await new Promise((resolve) => setTimeout(resolve, META_GAP_MS))
						}
						if (options && options.silent !== true) {
							if (updated > 0) showNotice(`已刷新 ${updated} 条链接的标题`)
						}
						return updated
					} finally {
						setRefreshing(false)
						setMetaEpoch((epoch) => epoch + 1)
					}
				}, [refreshing, visible, probes, showNotice])

				// Hard stop for the splash even if the pass never settles.
				React.useEffect(() => {
					if (!showSplash) return undefined
					const timer = setTimeout(() => setSplashDone(true), 8000)
					return () => clearTimeout(timer)
				}, [showSplash])

				// Reveal the list as soon as the conversation history is loaded.
				React.useEffect(() => {
					if (historyDone) setSplashDone(true)
				}, [historyDone])

				// Only refresh metadata while the panel is actually on screen.
				React.useEffect(() => {
					const node = rootRef.current
					if (!node || typeof IntersectionObserver !== 'function') return undefined
					const observer = new IntersectionObserver(
						(entries) => {
							const entry = entries[0]
							setPanelVisible(!!entry && entry.isIntersecting)
						},
						{ threshold: 0.05 },
					)
					observer.observe(node)
					return () => observer.disconnect()
				}, [])

				const openReference = React.useCallback((reference, event) => {
					const external = !!(event && (event.metaKey || event.ctrlKey || event.altKey))
					if (!external && tab && tab.actions && typeof tab.actions.openTab === 'function') {
						try {
							tab.actions.openTab(BROWSER_KIND, { params: { url: reference.url } })
							return
						} catch (error) {
							/* fall through to the system browser */
						}
					}
					try {
						const opened = window.open(reference.url, '_blank', 'noopener,noreferrer')
						if (opened === null || opened === undefined) showNotice('打开被拦截，试试 Cmd+点击')
					} catch (error) {
						showNotice('无法打开这个链接')
					}
				}, [tab, showNotice])

				const locateReference = React.useCallback((reference) => {
					if (locateUrl(reference.url)) return
					if (locateUrl(reference.url.replace(/^https?:\/\//i, ''))) return
					showNotice('没在当前视图里找到原文，它可能在上方未加载的历史中')
				}, [showNotice])

				// Batch hide is locked to the row's own host: hiding a.baidu.com never touches
				// b.baidu.com or baidu.com itself.
				const ignoreDomain = React.useCallback(
					(reference) => {
						const domain = reference.host.replace(/^www\./, '')
						setBlockedHosts((current) => {
							const next = new Set(current)
							for (const candidate of next) if (hostIgnored(reference.host, [candidate])) next.delete(candidate)
							next.add(domain)
							return next
						})
						showNotice(`已隐藏 ${domain} 及其所有子域名`, [
							{
								label: '撤销',
								run: () =>
									setBlockedHosts((current) => {
										const next = new Set(current)
										next.delete(domain)
										return next
									}),
							},
						])
					},
					[showNotice],
				)

				// Hide a single URL: only this exact link disappears, siblings stay visible.
				const hideLinkOnly = React.useCallback(
					(reference) => {
						setIgnored((current) => withIgnore(current, reference, 'link'))
						showNotice(`已隐藏 ${titleOf(reference)}`, [
							{ label: '撤销', run: () => setIgnored((current) => withoutIgnore(current, reference)) },
						])
					},
					[showNotice],
				)

				const restoreReference = React.useCallback(
					(reference) => {
						const domain = rootDomain(reference.host)
						const wasBlocked = hostIgnored(reference.host, Array.from(blockedHosts))
						setIgnored((current) => restoreOne(all, current, reference))
						if (wasBlocked) {
							setBlockedHosts((current) => {
								const next = new Set(current)
								for (const host of next) if (hostIgnored(reference.host, [host])) next.delete(host)
								return next
							})
							showNotice(`已恢复 ${domain}（解除了该域名的全局隐藏）`)
							return
						}
						showNotice(`已恢复 ${titleOf(reference)}`)
					},
					[all, blockedHosts, showNotice],
				)

				const togglePin = React.useCallback(
					(reference) => {
						setPinned((current) => {
							const next = new Set(current)
							if (next.has(reference.url)) {
								next.delete(reference.url)
								showNotice('已取消固定')
							} else {
								next.add(reference.url)
								showNotice('已固定到顶部')
							}
							return next
						})
					},
					[showNotice],
				)

				// Refresh the row's favicon: evict its host/domain entry, then let the icon queue
				// fetch it again. Titles come from the conversation, so nothing else is fetched.
				const refreshReference = React.useCallback(
					(reference) => {
						const host = reference.host.replace(/^www\./, '')
						const domain = rootDomain(reference.host)
						iconFailedRef.current.delete(host)
						iconQueueRef.current.delete(host)
						setHostsTable((current) => {
							if (current[host] === undefined && current[domain] === undefined) return current
							const next = { ...current }
							delete next[host]
							delete next[domain]
							return next
						})
					},
					[],
				)

				// Page-title fallback pass: only rows without a conversation title are probed,
				// one at a time, while the panel is visible. Results are cached and reused.
				const titleProbeRef = React.useRef({ epoch: -1, urls: new Set(), timer: null, at: 0 })
				const titleMissing = React.useMemo(
					() => visible.filter((reference) => titleOf(reference, {}) === reference.url),
					[visible],
				)
				React.useEffect(() => {
					if (!historyDone || !panelVisible || typeof fetch !== 'function') return undefined
					const state = titleProbeRef.current
					if (state.epoch !== sessionEpoch) {
						state.epoch = sessionEpoch
						state.urls = new Set()
					}
					const target = titleMissing.find((reference) => !state.urls.has(reference.url))
					if (target === undefined) return undefined
					if (state.timer !== null) clearTimeout(state.timer)
					state.timer = setTimeout(() => {
						state.timer = null
						if (Date.now() - state.at < 1200) return
						state.at = Date.now()
						state.urls.add(target.url)
						setAutoProbing((current) => new Set(current).add(target.url))
						Promise.resolve(runProbePass({ urls: [target.url], limit: 1, silent: true })).finally(() => {
							setAutoProbing((current) => {
								const next = new Set(current)
								next.delete(target.url)
								return next
							})
						})
					}, 800)
					return () => {
						if (state.timer !== null) {
							clearTimeout(state.timer)
							state.timer = null
						}
					}
				}, [titleMissing, historyDone, panelVisible, sessionEpoch, runProbePass])

				const probeSaveRef = React.useRef(null)
				React.useEffect(() => {
					if (probeSaveRef.current !== null) clearTimeout(probeSaveRef.current)
					probeSaveRef.current = setTimeout(() => {
						probeSaveRef.current = null
						if (Object.keys(probes).length > 0) saveProbes(probes)
					}, 300)
					return () => {
						if (probeSaveRef.current !== null) {
							clearTimeout(probeSaveRef.current)
							probeSaveRef.current = null
						}
					}
				}, [probes])

				const copyList = React.useCallback(() => {
					if (visible.length === 0) {
						showNotice('当前没有可复制的链接')
						return
					}
					const text = markdownOf(visible, probes)
					copyText(text).then((ok) => {
						showNotice(ok ? `已复制 ${visible.length} 条为 Markdown 引用清单` : '复制失败：浏览器没有授予剪贴板权限')
					})
				}, [visible, probes, showNotice])

				const copyReference = React.useCallback((reference) => {
					copyText(reference.url).then((ok) => {
						showNotice(ok ? '已复制链接' : '复制失败：浏览器没有授予剪贴板权限')
					})
				}, [showNotice])

				const [rescanning, setRescanning] = React.useState(false)
				const openTitleEditor = React.useCallback((reference) => {
					setMenu(null)
					setTitleEditor({ key: reference.key, url: reference.url, value: customTitles[reference.key] || '' })
				}, [customTitles])
				const commitTitleEditor = React.useCallback(() => {
					setTitleEditor((current) => {
						if (current === null) return null
						const next = { ...customTitles }
						const trimmed = current.value.trim()
						if (trimmed === '') delete next[current.key]
						else next[current.key] = trimmed
						setCustomTitles(next)
						return null
					})
				}, [customTitles])
				/**
				 * Global rescan: replay the whole conversation and refresh every URL's
				 * metadata (title, icon) while keeping pins.
				 * @returns {Promise<void>} completion.
				 */
				const rescanAll = React.useCallback(async () => {
					if (rescanning) return
					setRescanning(true)
					setProbeError('')
					try {
						const session = binding && binding.session
						if (session && typeof session.loadOlder === 'function') {
							for (let page = 0; page < 400; page += 1) {
								const source = binding.eventSource
								const current = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null
								if (!current || !current.hasMore) break
								try {
									await session.loadOlder()
								} catch (error) {
									await new Promise((resolve) => setTimeout(resolve, 400))
								}
							}
						}
						// Rebuild the conversation list; drop cached favicons so they refresh.
						setLinksCache({ rows: [], seq: 0, minSeq: 0, complete: false })
						clearLinksCache(sessionId)
						setHostsTable({})
						iconFailedRef.current.clear()
						iconQueueRef.current.clear()
					} finally {
						setRescanning(false)
					}
				}, [binding, rescanning, sessionId])

				const loadOlder = React.useCallback(async () => {
					const session = binding && binding.session
					if (!session || typeof session.loadOlder !== 'function' || loadingOlder) return
					setLoadingOlder(true)
					try {
						await session.loadOlder()
					} catch (error) {
						showNotice('加载更早的消息失败')
					} finally {
						setLoadingOlder(false)
					}
				}, [binding, loadingOlder, showNotice])

				React.useEffect(() => {
					if (!binding || historyDone) return undefined
					const session = binding.session
					if (!session || typeof session.loadOlder !== 'function') {
						setHistoryDone(true)
						return undefined
					}
					let cancelled = false
					let pages = 0
					const loadAll = async () => {
						let failures = 0
						while (!cancelled && pages < 400) {
							const source = binding.eventSource
							const current = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null
							if (!current || !current.hasMore) break
							pages += 1
							try {
								let settled = false
								await Promise.race([
									session.loadOlder().then(() => {
										settled = true
									}),
									new Promise((resolve) => setTimeout(resolve, 8000)),
								])
								if (!settled) break
								failures = 0
								// Yield between pages so the panel never competes with the chat
								// transport for the session store.
								await new Promise((resolve) => setTimeout(resolve, 60))
							} catch (error) {
								failures += 1
								if (failures >= 6) break
								await new Promise((resolve) => setTimeout(resolve, 600))
								continue
							}
						}
						if (!cancelled) {
							const source = binding.eventSource
							const current = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null
							if (current && !current.hasMore) {
								completeRef.current = true
								setCompleteState(true)
							}
							setHistoryDone(true)
						}
					}
					loadAll()
					return () => {
						cancelled = true
					}
				}, [binding, historyDone])

				if (!binding) {
					return h('div', { style: S.root }, h('div', { style: S.empty }, '正在等待会话就绪…'))
				}

				if (showSplash) {
					return h(
						'div',
						{ style: S.root },
						h('style', { key: 'dsh-links-css' }, ROW_CSS),
						h(
							'div',
							{ style: S.splash },
							h('span', { className: 'dsh-links-spinner dsh-links-spinner-lg', 'aria-hidden': 'true' }),
							h('div', { style: S.loadingText }, '正在读取链接…'),
						),
					)
				}



				let list
				if (all.length === 0) {
					list = h(
						'div',
						{ style: S.empty },
						'这个对话里还没有出现 URL。',
						h('br'),
						'贴一条链接、让 AI 联网搜索或抓取网页后，这里会自动汇总。',
					)
				} else if (visible.length === 0) {
					list = h(
						'div',
						{ style: S.empty },
						active.length === 0
							? `所有链接都被隐藏了（底部「已隐藏 ${ignoredRows.length}」可展开恢复）。`
							: '没有匹配的链接。',
					)
				} else {
					const renderRow = (reference, hidden) =>
						h(LinkRow, {
							key: reference.key,
							reference,
							ignored: hidden === true,
							title: customTitles[reference.key] || titleOf(reference, probes),
							iconSources: (() => {
								const hash = hashIconFor(reference.host)
								const host = reference.host.replace(/^www\./, '')
								const domain = rootDomain(reference.host)
								const cached = hostsTable[host] || hostsTable[domain] || ''
								return [cached !== '' ? cached : hash, hash]
							})(),
							iconEpoch: metaEpoch,
							onOpen: openReference,
							onToggleMenu: (next) => setMenu((current) => (current && current.key === next.key ? null : next)),
							onTooltip: setTooltip,
							onCountHover: (next) =>
								setCountTip((current) => (current !== null && next !== null && current.key === next.key ? null : next)),
							refreshing: refreshingUrls.has(reference.url) || autoProbing.has(reference.url),
							unreachable: isUnavailableProbe(probes, reference.url),
						})
					const sectionHeader = (key, label, count, open, toggle) =>
						h(
							'div',
							{ key, className: 'dsh-links-section', style: { ...S.groupHeader, cursor: 'pointer' }, onClick: toggle },
							h('span', null, `${label}(${count})`),
							h(
								'svg',
								{
									className: 'dsh-links-chevron',
									width: 14,
									height: 14,
									viewBox: '0 0 16 16',
									fill: 'none',
									stroke: 'currentColor',
									strokeWidth: 1.5,
									strokeLinecap: 'round',
									strokeLinejoin: 'round',
									style: { marginLeft: 'auto', marginRight: 8 },
									'aria-hidden': 'true',
								},
								open ? h('path', { d: 'M4 10L8 6L12 10' }) : h('path', { d: 'M4 6L8 10L12 6' }),
							),
						)
					const sections = []
					if (pinnedRows.length > 0) {
						sections.push(
							h(
								'div',
								{ key: 'pinned-group' },
								sectionHeader('pinned-head', '置顶链接', pinnedRows.length, pinnedOpen, () => setPinnedOpen((current) => !current)),
								pinnedOpen ? pinnedRows.map((reference) => renderRow(reference)) : null,
							),
						)
					}
					const searching = query.trim() !== ''
					if (searching) {
						const needle = query.trim().toLowerCase()
						const matches = all
							.filter((reference) => {
								const haystack = `${reference.title} ${reference.host} ${reference.pathname} ${reference.url}`.toLowerCase()
								return haystack.indexOf(needle) >= 0
							})
							.sort((left, right) => turnCountOf(right) - turnCountOf(left) || right.lastSeq - left.lastSeq)
						list = h(
							'div',
							{ key: 'search-group' },
							h('div', { style: S.groupHeader }, `搜索结果(${matches.length})`),
							orderByDomain(matches).map((reference) => renderRow(reference)),
						)
					} else {
					// Pinned rows are listed only in the pinned section; the full list is deduped.
					if (restRows.length > 0) {
						sections.push(
							h(
								'div',
								{ key: 'all-group' },
								sectionHeader('all-head', '全部链接', restRows.length, allOpen, () => setAllOpen((current) => !current)),
								allOpen ? restRows.map((reference) => renderRow(reference)) : null,
							),
						)
					}
					const hiddenCount = ignoredRows.length
					if (hiddenCount > 0) {
						sections.push(
							h(
								'div',
								{ key: 'hidden-group' },
								sectionHeader('hidden-head', '已隐藏', hiddenCount, hiddenOpen, () => setHiddenOpen((current) => !current)),
								hiddenOpen ? ignoredRows.map((reference) => renderRow(reference, true)) : null,
							),
						)
					}
					list = sections
					}
				}

				let tooltipNode = null
				if (tooltip !== null && typeof tooltip.text === 'string' && tooltip.text !== '') {
					const rect = tooltip.rect
					const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
					const lines = tooltip.text.split('\n')
					const longest = lines.reduce((max, line) => Math.max(max, line.length), 0)
					const width = Math.min(Math.max(80, 22 + longest * 7), Math.max(160, viewportWidth - 24))
					const height = 10 + lines.length * 16
					const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewportWidth - width - 8))
					const top = Math.max(8, rect.top - height - 6)
					tooltipNode = h(
						'div',
						{ style: { ...S.hoverTip, left, top, maxWidth: width, whiteSpace: 'normal' } },
						lines.map((line, index) => h('div', { key: index }, line)),
					)
				}

				let countTipNode = null
				if (countTip !== null) {
					const occurrences = countTip.reference.occurrences || []
					const turnNumbers =
						Array.isArray(countTip.reference.turns) && countTip.reference.turns.length > 0
							? countTip.reference.turns
							: []
					const items =
						turnNumbers.length > 0
							? turnNumbers.map((turnNumber) => {
									const matches = occurrences.filter((item) => item.turn === turnNumber)
									const first = matches[0] || { turn: turnNumber, source: '', snippet: '' }
									return { ...first, turn: turnNumber, extra: Math.max(matches.length - 1, 0) }
								})
							: occurrences.slice(0, 8)
					countTipNode = h(
						'div',
						{
							style: S.editorBackdrop,
							onClick: () => setCountTip(null),
							onKeyDown: (event) => {
								if (event.key === 'Escape') setCountTip(null)
							},
						},
						h(
							'div',
							{
								style: { ...S.editorCard, width: 420 },
								onClick: (event) => event.stopPropagation(),
							},
							h(
								'div',
								{
									style: {
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										fontSize: 12,
										color: COLOR_LABEL_SECONDARY,
										fontWeight: 500,
									},
								},
								h('span', { style: { flex: 1, minWidth: 0 } }, `在 ${turnCountOf(countTip.reference)} 轮对话中提及`),
								h(
									'button',
									{
										type: 'button',
										title: '关闭',
										'aria-label': '关闭',
										onClick: () => setCountTip(null),
										style: {
											flex: 'none',
											width: 22,
											height: 22,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											padding: 0,
											border: 'none',
											borderRadius: 6,
											background: 'transparent',
											color: COLOR_LABEL_SECONDARY,
											cursor: 'pointer',
										},
									},
									h(
										'svg',
										{
											width: 12,
											height: 12,
											viewBox: '0 0 16 16',
											fill: 'none',
											stroke: 'currentColor',
											strokeWidth: 1.5,
											strokeLinecap: 'round',
											'aria-hidden': 'true',
										},
										h('line', { x1: 4, y1: 4, x2: 12, y2: 12 }),
										h('line', { x1: 12, y1: 4, x2: 4, y2: 12 }),
									),
								),
							),
							h(
								'div',
								{
									style: {
										display: 'flex',
										flexDirection: 'column',
										gap: 2,
										maxHeight: 320,
										overflowY: 'auto',
										fontSize: 12,
										lineHeight: '18px',
										color: COLOR_LABEL_SECONDARY,
									},
								},
								items.map((item, index) =>
									h(
										'div',
										{
											key: `${item.seq}-${index}`,
											className: 'dsh-links-turn-item',
											title: `跳转到第 ${item.turn || '?'} 轮`,
											onClick: () => {
												const found = locateTurn(item.turn)
												if (found) {
													setCountTip(null)
													return
												}
												showNotice(`第 ${item.turn || '?'} 轮还没加载出来，先向上滚动加载更早的历史`)
											},
										},
										`第 ${item.turn || '?'} 轮 · ${SOURCE_LABEL[item.source] || item.source}${item.extra > 0 ? ` 等 ${item.extra + 1} 处` : ''}${item.snippet ? `：${item.snippet}` : ''}`,
									),
								),
							),
						),
					)
				}

				const menuRow = menu ? all.find((reference) => reference.key === menu.key) || null : null
				let rowMenu = null
				if (menuRow !== null) {
					const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
					const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768
					const left = Math.max(8, Math.min(menu.rect.right - 188, viewportWidth - 196))
					const top = Math.min(menu.rect.bottom + 4, Math.max(8, viewportHeight - 240))
					const closeThen = (action) => () => {
						setMenu(null)
						action(menuRow)
					}
					// Batch hide is locked to the row's own host (a.baidu.com), never the
					// registrable domain (baidu.com).
					const hostLabel = menuRow.host.replace(/^www\./, '')
					const domain = rootDomain(menuRow.host)
					const menuSeparator = (key) =>
						h('div', {
							key,
							style: {
								height: 1,
								margin: '4px 0',
								background: 'var(--dsw-alias-fill-l2, rgba(127,127,127,0.12))',
							},
						})
					const items = isRowHidden(menuRow)
						? [h(MenuItem, { key: 'restore', label: '恢复这个链接', onSelect: closeThen(restoreReference) })]
						: [
								h(MenuItem, { key: 'copy-link', label: '复制链接', onSelect: closeThen(copyReference) }),
								h(MenuItem, {
									key: 'pin',
									label: pinned.has(menuRow.url) ? '取消固定' : '固定到顶部',
									onSelect: closeThen(togglePin),
								}),
								h(MenuItem, { key: 'open', label: '内置浏览器打开', onSelect: closeThen((row) => openReference(row, {})) }),
								h(MenuItem, {
									key: 'browser',
									label: '系统浏览器打开',
									onSelect: closeThen((row) => openReference(row, { metaKey: true })),
								}),
								menuSeparator('sep-1'),
								h(MenuItem, { key: 'refresh', label: '刷新链接信息', onSelect: closeThen(refreshReference) }),
								h(MenuItem, { key: 'rename', label: '修改标题…', onSelect: closeThen(openTitleEditor) }),
								menuSeparator('sep-2'),
								h(MenuItem, { key: 'ignore-link', label: '隐藏这个链接', onSelect: closeThen(hideLinkOnly) }),
								h(MenuItem, {
									key: 'ignore-domain',
									label: `批量隐藏 ${hostLabel}`,
									onSelect: closeThen(ignoreDomain),
								}),
							]
					rowMenu = h(
						'div',
						{
							ref: rowMenuRef,
							className: 'dsh-links-menu',
							style: { ...S.menu, left, top },
							onPointerDown: (event) => event.stopPropagation(),
							onClick: (event) => event.stopPropagation(),
						},
						items,
					)
				}

				return h(
					'div',
					{ ref: rootRef, style: S.root },
					h('style', { key: 'dsh-links-css' }, ROW_CSS),
					all.length === 0
						? null
						: h(
						'div',
						{ style: S.searchWrap },
						h('input', {
							ref: searchInputRef,
							style: S.search,
							value: query,
							placeholder: '搜索标题，域名',
							onChange: (event) => setQuery(event.target.value),
							spellCheck: false,
						}),
						query === ''
							? h(
									'button',
									{
										type: 'button',
										style: S.searchButton,
										title: '搜索',
										'aria-label': '搜索',
										onClick: () => {
											const node = searchInputRef.current
											if (node) node.focus()
										},
									},
									h(
										'svg',
										{
											width: 12,
											height: 12,
											viewBox: '0 0 16 16',
											fill: 'none',
											stroke: 'currentColor',
											strokeWidth: 1.5,
											strokeLinecap: 'round',
											'aria-hidden': 'true',
										},
										h('circle', { cx: 7, cy: 7, r: 4.5 }),
										h('line', { x1: 10.4, y1: 10.4, x2: 14, y2: 14 }),
									),
								)
							: h(
									'button',
									{
										type: 'button',
										style: S.searchButton,
										title: '清除搜索',
										'aria-label': '清除搜索',
										onClick: () => {
											setQuery('')
											const node = searchInputRef.current
											if (node) node.focus()
										},
									},
									h(
										'svg',
										{
											width: 12,
											height: 12,
											viewBox: '0 0 16 16',
											fill: 'none',
											stroke: 'currentColor',
											strokeWidth: 1.5,
											strokeLinecap: 'round',
											'aria-hidden': 'true',
										},
										h('line', { x1: 4.5, y1: 4.5, x2: 11.5, y2: 11.5 }),
										h('line', { x1: 11.5, y1: 4.5, x2: 4.5, y2: 11.5 }),
									),
								),
					),
					tooltipNode,
					probeError ? h('div', { style: S.banner }, probeError) : null,
					titleEditor
						? h(
								'div',
								{
									style: S.editorBackdrop,
									onClick: () => setTitleEditor(null),
									onKeyDown: (event) => {
										if (event.key === 'Escape') setTitleEditor(null)
									},
								},
								h(
									'div',
									{ style: S.editorCard, onClick: (event) => event.stopPropagation() },
									h('div', { style: { fontSize: 12, color: COLOR_LABEL_SECONDARY } }, '修改标题'),
									h('input', {
										ref: titleEditorInputRef,
										style: S.editorInput,
										value: titleEditor.value,
										autoFocus: true,
										placeholder: '留空则恢复自动标题',
										spellCheck: false,
										onChange: (event) =>
											setTitleEditor((current) =>
												current === null ? null : { ...current, value: event.target.value },
											),
										onKeyDown: (event) => {
											if (event.key === 'Enter') {
												event.preventDefault()
												commitTitleEditor()
											} else if (event.key === 'Escape') {
												event.preventDefault()
												setTitleEditor(null)
											}
										},
									}),
									h(
										'div',
										{ style: S.editorActions },
										customTitles[titleEditor.key]
											? h(
													'button',
													{
														type: 'button',
														style: S.editorButton,
														onClick: () => {
															setCustomTitles((current) => {
																const next = { ...current }
																delete next[titleEditor.key]
																return next
															})
															setTitleEditor(null)
														},
													},
													'恢复自动',
												)
											: null,
										h('button', { type: 'button', style: S.editorButton, onClick: () => setTitleEditor(null) }, '取消'),
										h('button', { type: 'button', style: S.editorButton, onClick: commitTitleEditor }, '保存'),
									),
								),
							)
						: null,
					h(
						'div',
						{
							style: S.scroll,
							onScroll: () => {
								if (menu !== null) setMenu(null)
								if (countTip !== null) setCountTip(null)
							},
						},
						list,
					),
					h(
						'div',
						{ style: S.footer },
						h(
							'span',
							{ style: S.footerGrow },
							historyDone
								? `已收录 ${all.length} 条链接`
								: snapshot.hasMore
									? '正在加载历史…'
									: `已统计 ${snapshot.entries.length} 条事件`,
						),
						h(
							'button',
							{
								type: 'button',
								style: S.footerButton,
								title: '重新扫描整个对话，并刷新所有链接的标题与图标（保留置顶）',
								onClick: rescanAll,
								disabled: rescanning,
							},
							rescanning ? '正在重新扫描…' : '重新扫描',
						),
						h('span', { style: { fontSize: 10, color: COLOR_LABEL_TERTIARY, flex: 'none' }, title: '插件版本' }, BUILD),
					),
					countTipNode,
					rowMenu,
				)
			}
		}

		/** Hook fallback that keeps the hook call unconditional without a session kit. */
		function useNoSession() {
			return undefined
		}

		// ------------------------------------------------------------------
		// Plugin body
		// ------------------------------------------------------------------

		/** Required browser services: the tab registry and the keyed seat. */
		const inject = ['slots', 'sidebarRightTabs', 'sessions', 'locale']

		/** Build stamp shown in the footer, so a stale bundle is visible at a glance. */
		const BUILD = 'v0.63.0'
		/** Client locale namespace owned by this plugin. */
		const NS = 'dshLinks'
		const LOCALE_ZH = {
			'tab.title': '应用链接',
			'guide.description': '本对话里出现过的全部网址',
			'shortcut.open': '打开参考链接',
			'shortcut.noSession': '请先选择一个会话',
		}
		const LOCALE_EN = {
			'tab.title': 'Reference Links',
			'guide.description': 'Every URL that appeared in this conversation',
			'shortcut.open': 'Open reference links',
			'shortcut.noSession': 'Select a session first',
		}

		/**
		 * The plugin's link glyph, used by the tab strip chip and the add-tab guide.
		 * @param {{size?: number}} props - rendered size in pixels.
		 * @returns {object} React element.
		 */
		function LinkGlyph({ size }) {
			// The guide asks for 26px; cap it at 24px so the card icon stays compact.
			const edge = typeof size === 'number' ? Math.min(size, 24) : 24
			return h(
				'svg',
				{
					xmlns: 'http://www.w3.org/2000/svg',
					width: edge,
					height: edge,
					viewBox: '0 0 48 48',
					'aria-hidden': 'true',
				},
				h('path', { d: 'M0 0h48v48H0z', fill: 'none' }),
				h('path', {
					fill: '#1976D2',
					d: 'M38 13h-3c-5.5 0-10 4.5-10 10s4.5 10 10 10h3c5.5 0 10-4.5 10-10s-4.5-10-10-10m0 16h-3c-3.3 0-6-2.7-6-6s2.7-6 6-6h3c3.3 0 6 2.7 6 6s-2.7 6-6 6M13 13h-3C4.5 13 0 17.5 0 23s4.5 10 10 10h3c5.5 0 10-4.5 10-10s-4.5-10-10-10m0 16h-3c-3.3 0-6-2.7-6-6s2.7-6 6-6h3c3.3 0 6 2.7 6 6s-2.7 6-6 6',
				}),
				h('path', { fill: '#42A5F5', d: 'M33 21H15c-1.1 0-2 .9-2 2s.9 2 2 2h18c1.1 0 2-.9 2-2s-.9-2-2-2' }),
			)
		}

		/**
		 * Tab strip title: the link glyph followed by the localized tab title.
		 * @param {{useTabInfo?: Function}} props - slot-owned tab information hook.
		 * @returns {object} React element.
		 */
		function LinksTitle({ useTabInfo }) {
			const tab = typeof useTabInfo === 'function' ? useTabInfo().tab : null
			return h(
				'span',
				{ style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
				h(LinkGlyph, { size: 14 }),
				h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tab ? tab.title : ''),
			)
		}

		/**
		 * Client plugin body: register the tab type and its body seat.
		 * @param {object} ctx - client root context.
		 */
		function apply(ctx) {
			const t = ctx.locale.bind(NS)
			ctx.effect(
				() =>
					ctx.sidebarRightTabs.register({
						id: ID,
						kind: KIND,
						priority: 'extension',
						keepMounted: true,
						title: () => t('tab.title'),
						guide: [
							{
								id: 'conversation-links',
								title: () => t('tab.title'),
								description: () => t('guide.description'),
								icon: LinkGlyph,
								order: 20,
							},
						],
					}),
				'dsh-links: tab type',
			)
			ctx.effect(() => ctx.locale.register(NS, { zh: LOCALE_ZH, en: LOCALE_EN }), 'dsh-links: dictionaries')
			const Body = makeBody(ctx)
			ctx.effect(
				() =>
					ctx.slots.inject('sidebar.right.pane.tab', () =>
						ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID, locale: NS }, Body),
					),
				'dsh-links: tab body',
			)
			ctx.effect(
				() =>
					ctx.slots.inject('sidebar.right.pane.tab.title', () =>
						ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID, locale: NS }, LinksTitle),
					),
				'dsh-links: tab title',
			)
			// Direct accelerator as well as the shortcut registry: the registry entry
			// shows up in Settings, while this listener guarantees the chord works even
			// when the registry service is absent or its target resolution declines.
			ctx.effect(() => {
				if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
				const onKeyDown = (event) => {
					if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
					if (event.key !== 'l' && event.key !== 'L') return
					let sidebar
					try {
						sidebar = ctx.sidebarRight || (typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined)
					} catch (error) {
						sidebar = undefined
					}
					if (!sidebar || typeof sidebar.openTab !== 'function') return
					event.preventDefault()
					event.stopPropagation()
					try {
						sidebar.openTab(KIND, {})
					} catch (error) {
						/* no session yet: nothing to open */
					}
				}
				window.addEventListener('keydown', onKeyDown, true)
				return () => window.removeEventListener('keydown', onKeyDown, true)
			}, 'dsh-links: shortcut listener')
			ctx.inject(['shortcuts', 'sidebarRight'], (scoped) => {
				// Cmd+Shift+L on macOS, Ctrl+Shift+L elsewhere: `primary` is the platform
				// accelerator, and the explicit shift keeps typing a capital L harmless.
				const shortcutL = { code: 'KeyL', modifiers: ['primary', 'shift'] }
				scoped.effect(
					() =>
						scoped.shortcuts.register({
							id: 'dsh-links.open',
							label: () => t('shortcut.open'),
							aliases: ['reference links', 'links', '参考链接', '应用链接'],
							defaults: {
								'desktop:macos': shortcutL,
								'web:macos': shortcutL,
								'desktop:windows': shortcutL,
								'web:windows': shortcutL,
								'desktop:linux': shortcutL,
								'web:linux': shortcutL,
							},
							regions: ['page', 'editable', 'terminal'],
							modals: [],
							resolve: () => {
								const sidebar = scoped.sidebarRight || (ctx && ctx.sidebarRight)
								if (!sidebar || typeof sidebar.commandTarget !== 'function') {
									return { status: 'blocked', reason: t('shortcut.noSession') }
								}
								if (sidebar.commandTarget(null) === undefined) {
									return { status: 'blocked', reason: t('shortcut.noSession') }
								}
								return {
									status: 'handled',
									run: () => {
										try {
											sidebar.openTab(KIND, {})
										} catch (error) {
											/* session disappeared between resolve and run */
										}
									},
								}
							},
						}),
					'dsh-links: shortcut',
				)
			})
		}

		exports.apply = apply
		exports.inject = inject
		exports.__test = {
			trimTrailing,
			middleEllipsis,
			normalizeUrl,
			inspectUrl,
			turnCountOf,
			hashIconFor,
			classify,
			primaryTag,
			TAG_LABEL,
			splitFences,
			scanText,
			scanSearchResult,
			scanFetchResult,
			extractEvent,
			aggregate,
			makeBody,
			LinkRow,
			toolResultCallId,
			cacheableEvent,
			isUsableTitle,
			rootDomain,
			orderByDomain,
			looksLikeApiEndpoint,
			isUnavailableProbe,
			splitPinned,
			hostIconMap,
			restoreOne,
			escapeLabel,
			titleOf,
			markdownOf,
			hostIgnored,
			isIgnored,
			withIgnore,
			withoutIgnore,
			loadIgnores,
			ID,
			KIND,
		}
		return module.exports
	},
})
