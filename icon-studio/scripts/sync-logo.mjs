#!/usr/bin/env node
/**
 * Sync the plugin mark from an icon in the project library.
 *
 *   node scripts/sync-logo.mjs                 # plugin logo  <- .icon-studio/icon-10.svg
 *   node scripts/sync-logo.mjs --tab           # tab mark     <- .icon-studio/icon-9.svg
 *   node scripts/sync-logo.mjs .icon-studio/close.svg
 *
 * The library file is the source of truth: this rewrites the LOGO block in
 * lib/client.js (viewBox, stroke width, path data), so the sidebar chip and the
 * guide-card mark follow whatever you drew in the Icons panel.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const args = process.argv.slice(2)
const tabMode = args.includes('--tab')
const guideMode = args.includes('--guide')
const constant = guideMode ? 'GUIDE_MARK' : tabMode ? 'TAB_MARK' : 'LOGO'
const positional = args.filter((arg) => !arg.startsWith('--'))
/** Default source: the binding recorded in the library manifest. */
const boundName = (() => {
	try {
		const manifest = JSON.parse(readFileSync(resolve(root, '../.icons.json'), 'utf8'))
		return guideMode ? null : tabMode ? manifest.tabLogo : manifest.logo
	} catch (_error) {
		return null
	}
})()
const boundSvg = (() => {
	if (boundName === null) return null
	try {
		const manifest = JSON.parse(readFileSync(resolve(root, '../.icons.json'), 'utf8'))
		const entry = manifest.graphics.find((item) => item.name === boundName)
		if (!entry || typeof entry.body !== 'string') return null
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.viewBox}">${entry.body}</svg>`
	} catch (_error) {
		return null
	}
})()
const source = positional[0] ? resolve(root, positional[0]) : null
const svg = source ? readFileSync(source, 'utf8') : boundSvg
if (!svg) {
  console.error('sync-logo: no icon file given and the manifest has no bound icon')
  process.exit(1)
}
const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] || '0 0 24 24'
const strokeWidth = Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1] || 1.75)

/**
 * The whole drawing is carried over, so fills and stroke widths ship exactly as
 * drawn; sizing and colour inheritance stay in code.
 */
const open = svg.indexOf('>', svg.indexOf('<svg'))
const close = svg.lastIndexOf('</svg>')
const markup = (open >= 0 && close > open ? svg.slice(open + 1, close) : '').trim().replace(/\s*\n\s*/g, '').replace(/\s{2,}/g, ' ')
if (markup === '') {
  console.error(`sync-logo: ${source} has no drawing content`)
  process.exit(1)
}

const quote = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const block = guideMode
	? `    const ${constant} = {
      viewBox: ${quote(viewBox)},
      markup: ${quote(markup)},
      document: ${quote(svg.trim().replace(/\s*\n\s*/g, ''))},
    }`
	: `    const ${constant} = {
      viewBox: ${quote(viewBox)},
      markup: ${quote(markup)},
    }`

const clientPath = resolve(root, 'lib/client.js')
const client = readFileSync(clientPath, 'utf8')
const start = client.indexOf(`    const ${constant} = {`)
const endMarker = '\n    }\n'
if (start < 0) {
  console.error(`sync-logo: lib/client.js has no ${constant} block — was the mark hand-edited?`)
  process.exit(1)
}
const end = client.indexOf(endMarker, start)
if (end < 0) {
  console.error('sync-logo: malformed LOGO block in lib/client.js')
  process.exit(1)
}

const next = client.slice(0, start) + block + client.slice(end + endMarker.length - 1)
writeFileSync(clientPath, next)
console.log(`sync-logo: ${[...markup.matchAll(/<path\b/g)].length} paths, viewBox ${viewBox} → lib/client.js`)
