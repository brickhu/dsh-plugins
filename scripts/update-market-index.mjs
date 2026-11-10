/**
 * Keep market/index.json in sync with the published plugin version.
 *
 * Run after a successful `npm publish` (the publish workflow does this): it reads
 * references/package.json, asks the registry for that version's real publish
 * timestamp, and prepends the version entry to the market index.
 *
 *   node scripts/update-market-index.mjs            # use references/package.json version
 *   node scripts/update-market-index.mjs --version 0.82.0
 *   node scripts/update-market-index.mjs --check     # exit 1 when the index is stale
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flags = process.argv.slice(2)
const versionFlag = flags.indexOf('--version')
const checkOnly = flags.includes('--check')

const pluginFlag = flags.indexOf('--plugin')
const pluginDir = pluginFlag >= 0 && flags[pluginFlag + 1] ? flags[pluginFlag + 1] : 'references'
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, pluginDir, 'package.json'), 'utf8'))
const version = versionFlag >= 0 ? flags[versionFlag + 1] : manifest.version
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`not a concrete version: ${version}`)
	process.exit(1)
}

const response = await fetch(`https://registry.npmjs.org/${manifest.name}/${version}`, {
	headers: { accept: 'application/json' },
})
if (!response.ok) {
	console.error(`registry has no ${manifest.name}@${version} (HTTP ${response.status})`)
	process.exit(1)
}
const meta = await response.json()
const published = await fetch(`https://registry.npmjs.org/${manifest.name}?write=true`, {
	headers: { accept: 'application/json' },
})
const registry = published.ok ? await published.json() : {}
const iso = registry.time ? registry.time[version] : undefined
const publishTimestamp = iso ? Math.floor(new Date(iso).getTime() / 1000) : Math.floor(Date.now() / 1000)

const indexPath = path.join(repoRoot, 'market', 'index.json')
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
let plugin = index.plugins.find((entry) => entry.name === manifest.name)
if (!plugin) {
	// First release of a new plugin: add its market entry from package + locale copy.
	const readLocale = (lang) => {
		try {
			return JSON.parse(fs.readFileSync(path.join(repoRoot, pluginDir, 'locale', `${lang}.json`), 'utf8')).meta || {}
		} catch (_error) {
			return {}
		}
	}
	const en = readLocale('en')
	const zh = readLocale('zh')
	plugin = {
		name: manifest.name,
		title: { en: en.title || manifest.name, zh: zh.title || en.title || manifest.name },
		description: { en: en.description || '', zh: zh.description || en.description || '' },
		icon: `https://raw.githubusercontent.com/brickhu/dsh-plugins/main/${pluginDir}/icon.svg`,
		author: 'brickhu',
		...(manifest.homepage ? { homepage: manifest.homepage } : {}),
		...(manifest.repository ? { repository: manifest.repository } : {}),
		metadata: { category: 'tools' },
		versions: [],
	}
	index.plugins.push(plugin)
}
const versions = Array.isArray(plugin.versions) ? plugin.versions : []
const existing = versions.find((entry) => entry.version === version)
if (existing && existing.publishTimestamp === publishTimestamp) {
	if (checkOnly) process.exit(0)
	console.log(`market/index.json already lists ${version}`)
	process.exit(0)
}
const engines = meta.engines && meta.engines.dsh ? { dsh: meta.engines.dsh } : plugin.versions[0]?.engines
const entry = { version, publishTimestamp, source: { type: 'npm' }, ...engines ? { engines } : {} }
plugin.versions = [entry, ...versions.filter((candidate) => candidate.version !== version)]
	.sort((left, right) => right.publishTimestamp - left.publishTimestamp)
	.sort((left, right) => {
		const leftParts = left.version.split('.').map(Number)
		const rightParts = right.version.split('.').map(Number)
		for (let indexPart = 0; indexPart < 3; indexPart += 1) {
			if (leftParts[indexPart] !== rightParts[indexPart]) return rightParts[indexPart] - leftParts[indexPart]
		}
		return 0
	})
if (checkOnly) {
	console.error(`market/index.json is stale: ${version} is missing`)
	process.exit(1)
}
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
console.log(`market/index.json lists ${manifest.name}@${version} (${plugin.versions.map((entry) => entry.version).join(', ')})`)
