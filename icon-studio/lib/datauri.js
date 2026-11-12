/**
 * Inline `data:` images — base64 and percent-encoded.
 *
 * A data URI is not a second kind of icon: it is the same drawing behind a
 * decoder. Base64 keeps the geometry byte-for-byte, so an SVG blob is exactly
 * as recognisable as an inline `<svg>` once it is decoded. Raster formats are
 * the opposite — a PNG has no geometry left to compare — and must be *reported*
 * as unreadable instead of being silently skipped, or a project looks clean
 * while half its icons are invisible to the library.
 *
 * Three levels, kept apart on purpose:
 *
 *   decode    a blob → SVG text              (this module)
 *   identity  decoded → signature match      (sync.js, after `normalizeSvg`)
 *   rewrite   blob → the library's artwork   (sync.js, single-use sites only)
 *
 * Decoding alone never proves identity: the blob may be un-normalised (a
 * `class` attribute, a bounding-box path, `fill="#000"` from a mask pipeline).
 * Normalising both sides first is what makes the signature comparable.
 */

/** `data:image/<mime><params>,<payload>` — params are `;k=v` or `;k`. */
const START = /data:image\/([a-z0-9.+-]+)((?:;[^,;"'`)\s>]*)*),/giu

/** Where a blob ends: a quote, a `url(…)` close, a tag close, or whitespace. */
const TERMINATORS = new Set(['"', "'", '`', ')', '>', ' ', '\t', '\n', '\r', '<'])

/** Formats whose geometry is gone: the only honest answer is "unreadable". */
export const RASTER_MIME = new Set(['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic'])

/** MIME subtypes that still carry vector geometry. */
export function isVectorMime(mime) {
	const value = String(mime || '').toLowerCase()
	return value === 'svg+xml' || value === 'svg'
}

function decodePayload(payload, base64) {
	if (base64) {
		try {
			// Whitespace is legal inside a base64 literal (line-wrapped blobs).
			return Buffer.from(payload.replace(/\s+/gu, ''), 'base64').toString('utf8')
		} catch (_error) {
			return ''
		}
	}
	try {
		return decodeURIComponent(payload)
	} catch (_error) {
		// A hand-written blob may leave `#` or spaces unescaped; decode what we can.
		return payload
	}
}

/**
 * Every `data:image/…` occurrence in a text, decoded when it is vector.
 *
 * `head` is the prefix up to the payload, so a rewrite can keep the original
 * encoding flavour (`;base64` vs `;charset=utf-8`) instead of re-inventing it.
 */
export function dataUriBlocks(text) {
	const source = String(text || '')
	if (!source.includes('data:image/')) return []
	const out = []
	START.lastIndex = 0
	let match
	while ((match = START.exec(source)) !== null) {
		const mime = match[1].toLowerCase()
		const params = match[2] || ''
		const base64 = /;base64$/iu.test(params)
		const headStart = match.index
		const payloadStart = match.index + match[0].length
		let end = payloadStart
		while (end < source.length && !TERMINATORS.has(source[end])) end += 1
		const blob = source.slice(payloadStart, end)
		if (blob === '') continue
		const vector = isVectorMime(mime)
		out.push({
			start: headStart,
			end,
			mime,
			base64,
			head: source.slice(headStart, payloadStart),
			blob,
			vector,
			raster: RASTER_MIME.has(mime),
			text: vector ? decodePayload(blob, base64) : '',
		})
	}
	return out
}

/**
 * Re-encode artwork into the same flavour as the URI it replaces, so prose,
 * quotes, `url()` wrappers and CSP hashes keep the shape they had.
 */
export function encodeLike(uri, svg) {
	const value = String(svg || '')
	const payload = uri && uri.base64
		? Buffer.from(value, 'utf8').toString('base64')
		: encodeURIComponent(value)
	return `${uri && typeof uri.head === 'string' ? uri.head : 'data:image/svg+xml;base64,'}${payload}`
}

/** How many times this exact blob appears — a rewritten shared constant is a surprise. */
export function countBlob(text, blob) {
	const source = String(text || '')
	if (blob === '') return 0
	let count = 0
	let at = source.indexOf(blob)
	while (at !== -1) {
		count += 1
		at = source.indexOf(blob, at + blob.length)
	}
	return count
}
