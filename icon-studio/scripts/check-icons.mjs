#!/usr/bin/env node
/**
 * Audit a workspace against its icon library.
 *
 *   node scripts/check-icons.mjs [--root=DIR] [--max-sites=N] [--strict] [--json]
 *
 * Read-only: it counts, it never rewrites. Exit codes are for CI —
 *
 *   0  report only (or clean)
 *   1  --strict and the library has drift or a site budget is exceeded
 *   2  no library / unreadable manifest
 *
 * The interesting number is not "how many icons": it is how many copies of each
 * drawing exist outside the library, and how many drawings the scanner cannot
 * read at all (a raster data URI has no geometry left to compare).
 */
import { realpathSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, MANIFEST_FILE, readEntrySvg } from '../lib/store.js'
import { audit, violations, SITE_KINDS } from '../lib/report.js'

export function parseArgs(argv) {
	const options = { root: process.cwd(), maxSites: 0, strict: false, json: false }
	for (const arg of argv) {
		if (arg === '--strict') options.strict = true
		else if (arg === '--json') options.json = true
		else if (arg.startsWith('--root=')) options.root = resolve(arg.slice('--root='.length))
		else if (arg.startsWith('--max-sites=')) {
			const value = Number(arg.slice('--max-sites='.length))
			if (!Number.isFinite(value) || value < 0) throw new Error('--max-sites needs a number')
			options.maxSites = Math.floor(value)
		} else if (arg === '--help' || arg === '-h') options.help = true
		else throw new Error(`unknown argument: ${arg}`)
	}
	return options
}

/** A filesystem port shaped like the Host's, rooted at one project directory. */
function nodeIo(root) {
	const full = (rel) => (rel === '' || rel === '.' ? root : join(root, rel))
	return {
		async readText(rel) {
			try {
				return await readFile(full(rel), 'utf8')
			} catch (_error) {
				return null
			}
		},
		async writeText(rel, text) {
			await writeFile(full(rel), text, 'utf8')
		},
		async listDir(rel) {
			let entries
			try {
				entries = await readdir(full(rel), { withFileTypes: true })
			} catch (_error) {
				return []
			}
			return entries.map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file',
			}))
		},
	}
}

function pad(value, width) {
	const text = String(value)
	return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function print(result, options) {
	const { over, stale } = violations(result, { maxSites: options.maxSites })
	const scanned = result.scanned
	console.log(`dsh-icon-library check · ${options.root}`)
	console.log('')
	console.log(`${pad('library', 12)}${result.total} icons in ${MANIFEST_FILE}`)
	console.log(`${pad('scanned', 12)}${scanned.total} files (${scanned.ui} ui, ${scanned.style} style)`)
	console.log('')
	const parts = SITE_KINDS.map((kind) => `${kind} ${result.counts[kind] || 0}`)
	console.log(`${pad('copies', 12)}${parts.join(' · ')}`)
	console.log(`${pad('stale', 12)}${result.stale.length}${result.stale.length === 0 ? '' : '  pointers recorded earlier that no longer draw their icon'}`)
	console.log(`${pad('unowned', 12)}${result.unregistered.length}${result.unregistered.length === 0 ? '' : '  icon-like drawings the library does not have'}`)
	console.log(`${pad('unreadable', 12)}${result.raster.length}${result.raster.length === 0 ? '' : '  raster data URIs — no geometry left to compare'}`)
	if (over.length > 0) {
		console.log('')
		console.log(`over budget (> ${options.maxSites} copies)`)
		for (const icon of over) {
			console.log(`  ${pad(icon.name, 18)}${icon.sites}`)
			for (const site of icon.list.slice(0, 4)) console.log(`    ${pad(site.kind, 9)}${site.file}:${site.line}`)
			if (icon.list.length > 4) console.log(`    … ${icon.list.length - 4} more`)
		}
	}
	if (result.stale.length > 0) {
		console.log('')
		console.log('stale pointers')
		for (const pointer of result.stale.slice(0, 10)) console.log(`  ${pad(pointer.name, 18)}${pointer.kind} ${pointer.file}:${pointer.line || '?'}`)
		if (result.stale.length > 10) console.log(`  … ${result.stale.length - 10} more`)
	}
	console.log('')
	console.log(over.length === 0 && stale.length === 0
		? 'result: clean'
		: `result: ${over.length} over budget, ${stale.length} stale${options.strict ? '' : ' (report only)'}`)
}

async function main() {
	let options
	try {
		options = parseArgs(process.argv.slice(2))
	} catch (error) {
		console.error(error.message)
		process.exitCode = 2
		return
	}
	if (options.help) {
		console.log('usage: check-icons [--root=DIR] [--max-sites=N] [--strict] [--json]')
		return
	}
	const io = nodeIo(options.root)
	const store = createStore(io)
	let entries
	try {
		const listed = await store.list()
		if (!listed.exists) {
			console.error(`no ${MANIFEST_FILE} in ${options.root}`)
			process.exitCode = 2
			return
		}
		entries = []
		for (const entry of listed.entries) {
			const svg = await readEntrySvg(io, entry)
			if (svg === null) continue
			entries.push({ name: entry.name, svg, pointers: entry.pointers || [] })
		}
	} catch (error) {
		console.error(`${MANIFEST_FILE}: ${error.message}`)
		process.exitCode = 2
		return
	}
	const result = await audit(io, entries, {})
	if (options.json) console.log(JSON.stringify({ ...result, violations: violations(result, { maxSites: options.maxSites }) }, null, 2))
	else print(result, options)
	if (options.strict) {
		const { clear } = violations(result, { maxSites: options.maxSites })
		if (!clear) process.exitCode = 1
	}
}

/** Run only when executed as a program — tests import this module for `parseArgs`. */
function invokedAsScript() {
	const entry = process.argv[1]
	if (!entry) return false
	try {
		// Compare real paths: a repository linked into a profile reaches this file
		// through a symlink, and `import.meta.url` already names the real one.
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
	} catch (_error) {
		return false
	}
}

if (invokedAsScript()) await main()
