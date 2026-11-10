#!/usr/bin/env node
/**
 * Derive a mask-safe app icon from a library icon.
 *
 *   node scripts/build-mask-icon.mjs [name]
 *
 * The host renders a plugin's entry icon as a CSS mask (alpha only). A solid
 * outer contour therefore collapses into a black blob. This script punches the
 * inner contour out with `fill-rule="evenodd"` and writes the result to
 * `icon.mask.svg` — a build artefact, never a hand edit of the source icon.
 * The plain `icon.svg` stays byte-identical to the library file so that copy
 * pointers and diffs keep matching.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const name = process.argv[2] || 'icon-10'
const manifest = JSON.parse(readFileSync(resolve(root, '../.icons.json'), 'utf8'))
const entry = manifest.graphics.find((item) => item.name === name)
if (!entry || typeof entry.body !== 'string') {
  console.error(`build-mask-icon: no icon named "${name}" in .icons.json`)
  process.exit(1)
}
const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.viewBox}">${entry.body}</svg>`
const defs = /<defs>[\s\S]*?<\/defs>/.exec(source)?.[0] ?? ''
const paths = [...source.matchAll(/<path[^>]*\/>/g)].map((match) => match[0])
if (paths.length < 2) {
  console.error('build-mask-icon: the icon needs an outer and an inner contour')
  process.exit(1)
}
const d = paths.map((path) => /d="([^"]+)"/.exec(path)[1]).join(' ')
const fill = /fill="url\([^)]+\)"/.exec(source)?.[0] ?? 'fill="currentColor"'
const viewBox = /viewBox="([^"]+)"/.exec(source)[1]
const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="16" height="16" fill="none">
  ${defs}
  <path fill-rule="evenodd" clip-rule="evenodd" ${fill} d="${d}"/>
</svg>
`
writeFileSync(resolve(root, 'icon.mask.svg'), out)
console.log(`build-mask-icon: icon.mask.svg ← ${name}`)
