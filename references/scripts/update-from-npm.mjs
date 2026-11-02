/**
 * Install or update this plugin from the npm registry into a DSH profile.
 *
 * The plugin manager offers no "Update" action for third-party bundles (only
 * on-demand official catalog entries get an installTarget), so this script does
 * what the manager would do for an exact registry version:
 *
 *   1. dependencies[<name>] = "<exact version>"
 *   2. dsh.profile.bundles includes <name>
 *   3. pnpm-workspace.yaml minimumReleaseAgeExclude includes <name>@<version>
 *   4. runs the bundled pnpm to install it
 *
 * Usage (from the repository root):
 *   node references/scripts/update-from-npm.mjs                 # install npm latest
 *   node references/scripts/update-from-npm.mjs --version 0.82.0
 *   node references/scripts/update-from-npm.mjs --dry-run
 *   node references/scripts/update-from-npm.mjs --profile web --plugin references
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const flags = process.argv.slice(2)

function flagValue(name, fallback) {
	const index = flags.indexOf(name)
	if (index === -1) return fallback
	const value = flags[index + 1]
	if (!value || value.startsWith('--')) {
		console.error(`missing value for ${name}`)
		process.exit(1)
	}
	return value
}

const pluginDir = path.resolve(repoRoot, flagValue('--plugin', 'references'))
const profileName = flagValue('--profile', 'desktop')
const requested = flagValue('--version', '')
const dryRun = flags.includes('--dry-run')
const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'))
const NAME = pluginManifest.name
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profileName)
const profileManifestPath = path.join(profileDir, 'package.json')

if (!fs.existsSync(profileManifestPath)) {
	console.error(`profile manifest not found: ${profileManifestPath}`)
	process.exit(1)
}

/** Read the desktop system proxy so registry requests work behind it. */
function systemProxy() {
	const fromEnv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
	if (fromEnv) return fromEnv
	try {
		const raw = execFileSync('scutil', ['--proxy'], { encoding: 'utf8' })
		const type = /SOCKSEnable\s*:\s*1/i.test(raw) ? 'socks5h' : /HTTPSEnable\s*:\s*1/i.test(raw) ? 'http' : ''
		if (type === '') return ''
		const host = /(?:SOCKSPort|HTTPSPort)\s*:\s*(\d+)/.exec(raw)?.[1] ?? ''
		const server = /(?:SOCKSProxy|HTTPSProxy)\s*:\s*(\S+)/.exec(raw)?.[1] ?? ''
		return host !== '' && server !== '' ? `${type}://${server}:${host}` : ''
	} catch {
		return ''
	}
}

function registryVersion(version) {
	const proxy = systemProxy()
	const args = ['-sS', '-L', '--max-time', '20', '-H', 'accept: application/json', `https://registry.npmjs.org/${NAME}/${version === '' ? 'latest' : version}`]
	if (proxy !== '') args.unshift('-x', proxy)
	const body = execFileSync('curl', args, { encoding: 'utf8' })
	const parsed = JSON.parse(body)
	if (!parsed || typeof parsed.version !== 'string') throw new Error(`no version in registry response for ${NAME}`)
	return parsed.version
}

let version = requested
if (version === '') {
	try {
		version = registryVersion('')
	} catch (error) {
		console.error(`cannot resolve the latest npm version of ${NAME}: ${error.message}`)
		process.exit(1)
	}
}
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`not a concrete version: ${version}`)
	process.exit(1)
}

const profileManifest = JSON.parse(fs.readFileSync(profileManifestPath, 'utf8'))
profileManifest.dependencies = { ...(profileManifest.dependencies ?? {}), [NAME]: version }
profileManifest.dsh = profileManifest.dsh ?? {}
profileManifest.dsh.profile = profileManifest.dsh.profile ?? {}
const bundles = Array.isArray(profileManifest.dsh.profile.bundles) ? profileManifest.dsh.profile.bundles : []
if (!bundles.includes(NAME)) bundles.push(NAME)
profileManifest.dsh.profile.bundles = bundles

const workspacePath = path.join(profileDir, 'pnpm-workspace.yaml')
let workspace = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, 'utf8') : ''
const exemptionLine = `  - ${NAME}@${version}`
if (!workspace.includes(exemptionLine.trim())) {
	if (/minimumReleaseAgeExclude:\s*\n/.test(workspace)) {
		workspace = workspace.replace(/minimumReleaseAgeExclude:\s*\n/, (match) => `${match}${exemptionLine}\n`)
	} else {
		workspace += `${workspace.endsWith('\n') || workspace === '' ? '' : '\n'}minimumReleaseAgeExclude:\n${exemptionLine}\n`
	}
}

if (dryRun) {
	console.log(JSON.stringify({ name: NAME, version, profileDir, bundles }, null, 2))
	process.exit(0)
}

fs.writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)
fs.writeFileSync(workspacePath, workspace)

const runtime = path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies')
const nodeBin = path.join(runtime, 'node', 'bin', 'node')
const pnpmCli = path.join(runtime, 'pnpm', 'bin', 'pnpm.cjs')
if (!fs.existsSync(nodeBin) || !fs.existsSync(pnpmCli)) {
	console.error(`bundled pnpm runtime not found under ${runtime}; run "pnpm install" in ${profileDir} manually`)
	process.exit(1)
}
// Do not smuggle the macOS SOCKS proxy into pnpm: pnpm's fetch (undici) cannot use
// SOCKS URLs and would fail even when the registry is reachable directly. Try the
// default registry first, then the mainland mirror that pnpm/npm users in CN rely on.
const attempts = [[], ['--config.registry=https://registry.npmmirror.com']]
let lastError = null
for (const extra of attempts) {
	try {
		execFileSync(nodeBin, [pnpmCli, 'install', '--dir', profileDir, '--prefer-offline', '--reporter', 'append-only', ...extra], {
			stdio: 'inherit',
			env: process.env,
		})
		lastError = null
		break
	} catch (error) {
		lastError = error
		console.error(`pnpm install failed${extra.length > 0 ? ' (mirror)' : ''}: ${error.message}`)
	}
}
if (lastError !== null) {
	console.error(`cannot install ${NAME}@${version} from the registry`)
	process.exit(1)
}

const installedManifest = path.join(profileDir, 'node_modules', ...NAME.split('/'), 'package.json')
if (fs.existsSync(installedManifest)) {
	const installed = JSON.parse(fs.readFileSync(installedManifest, 'utf8'))
	console.log(`\n${NAME}@${installed.version} installed into ${profileName}.`)
	console.log('Quit DSH completely (Cmd+Q) and start it again; the footer should show the new build.')
} else {
	console.log(`\n${NAME}@${version} requested. Quit DSH completely (Cmd+Q) and start it again.`)
}
