#!/usr/bin/env node
/**
 * Pick the version for an automatic release.
 *
 * - If the repository is already ahead of npm (a manual version bump), keep it.
 * - Otherwise bump the patch number of the npm `latest` version, so every
 *   commit that touches the plugin can publish a fresh immutable version.
 *
 * Usage: NPM_LATEST=$(npm view dsh-english-dictation version) node scripts/bump-version.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(root, 'package.json')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const current = String(packageJson.version || '0.0.0')

function parse(value) {
	const match = String(value || '')
		.trim()
		.replace(/^v/, '')
		.match(/^(\d+)\.(\d+)\.(\d+)/)
	if (!match) return null
	return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(left, right) {
	const a = parse(left)
	const b = parse(right)
	if (!a || !b) return 0
	for (let index = 0; index < 3; index += 1) {
		if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
	}
	return 0
}

const latest = process.env.NPM_LATEST || '0.0.0'
const next =
	compare(current, latest) > 0
		? current
		: (() => {
				const base = parse(latest) || [0, 0, 0]
				return `${base[0]}.${base[1]}.${base[2] + 1}`
			})()

if (next !== current) {
	packageJson.version = next
	fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, '\t')}\n`)
	for (const [file, pattern] of [
		['lib/client.js', /(const VERSION = 'v)([^']+)(')/],
		['lib/index.js', /(export const BUILD = 'v)([^']+)(')/],
	]) {
		const target = path.join(root, file)
		const source = fs.readFileSync(target, 'utf8')
		const replaced = source.replace(pattern, (match, before, current, after) => `${before}${next}${after}`)
		if (replaced === source) throw new Error(`could not update the version in ${file}`)
		fs.writeFileSync(target, replaced)
	}
	console.log(`version ${current} → ${next}`)
} else {
	console.log(`version ${current} is already ahead of npm ${latest}; publishing it as-is`)
}
console.log(next)
