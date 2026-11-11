/**
 * "Is there a newer published version?" — one registry read plus a pure
 * comparison, so the panel can show an update hint next to its own version
 * without depending on the host's plugin manager internals.
 *
 * The check is best-effort: an offline machine, a registry outage or a package
 * that only exists locally all mean "nothing newer we can prove", never an
 * error in the panel.
 */

const DEFAULT_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** `1.2.3-rc.1` -> { parts: [1, 2, 3], pre: 'rc.1' }; null when unparsable. */
export function parseVersion(text) {
	const match = VERSION.exec(String(text ?? '').trim())
	if (!match) return null
	return {
		parts: [Number(match[1]), Number(match[2]), Number(match[3])],
		pre: match[4] ?? '',
	}
}

/**
 * Semver precedence for two prerelease strings: numeric identifiers compare
 * numerically and rank below alphanumeric ones, and a longer chain wins only
 * after its prefix is equal (rc.1 < rc.2 < rc.2.1).
 */
function comparePrerelease(left, right) {
	const a = left.split('.')
	const b = right.split('.')
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const x = a[index]
		const y = b[index]
		if (x === undefined) return -1
		if (y === undefined) return 1
		const xNumeric = /^\d+$/u.test(x)
		const yNumeric = /^\d+$/u.test(y)
		if (xNumeric && yNumeric) {
			if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1
			continue
		}
		if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
		if (x !== y) return x > y ? 1 : -1
	}
	return 0
}

/** True when `candidate` is a strictly newer release than `current`. */
export function isNewer(candidate, current) {
	const next = parseVersion(candidate)
	const now = parseVersion(current)
	if (!next || !now) return false
	for (let index = 0; index < 3; index += 1) {
		if (next.parts[index] !== now.parts[index]) return next.parts[index] > now.parts[index]
	}
	// Same core version: a prerelease is older than the plain release.
	if (next.pre === now.pre) return false
	if (next.pre === '') return true
	if (now.pre === '') return false
	return comparePrerelease(next.pre, now.pre) > 0
}

/**
 * The `latest` dist-tag of `name`, asked from the first registry that answers.
 * Returns `{ version, registry }` or null; never throws.
 */
export async function latestPublished({ name, registries = DEFAULT_REGISTRIES, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
	if (typeof name !== 'string' || name.trim() === '' || typeof fetchImpl !== 'function') return null
	for (const registry of registries) {
		try {
			const response = await fetchImpl(`${registry}/${encodeURIComponent(name.trim())}/latest`, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(timeoutMs),
			})
			if (!response || response.ok !== true) continue
			const data = await response.json()
			if (data && typeof data.version === 'string' && parseVersion(data.version)) {
				return { version: data.version, registry }
			}
		} catch (_error) {
			/* try the next registry */
		}
	}
	return null
}
