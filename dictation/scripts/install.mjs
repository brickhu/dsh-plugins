/**
 * Install this plugin into a DSH profile as a local development link.
 *
 * The supported path is still the plugin manager — `plugin_manager` with
 * `action: install_bundle` and this directory as target. This script performs
 * the same three writes that path does, for a terminal workflow:
 *
 *   1. node_modules/<name> → symlink to this package
 *   2. package.json dependencies[<name>] = "file:<plugin>"
 *   3. package.json dsh.profile.bundles += <name>
 *
 * Every touched profile file is backed up once per plugin before the first
 * install and restored by `--uninstall`.
 *
 * Usage (run from anywhere):
 *   node dictation/scripts/install.mjs              # install / refresh the link
 *   node dictation/scripts/install.mjs --uninstall  # restore the previous state
 *
 * Options:
 *   --profile <name>  profile name under ~/.dsh/profiles (default: desktop)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(scriptDir, '..')
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

const manifestSource = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'))
const NAME = manifestSource.name
const shortName = NAME.split('/').pop()
const scope = NAME.includes('/') ? NAME.split('/')[0] : ''
const profileName = flagValue('--profile', process.env.DSH_PROFILE || 'desktop')
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profileName)
const manifestPath = path.join(profileDir, 'package.json')
const uninstall = flags.includes('--uninstall')

const linkDir = path.join(profileDir, 'node_modules', ...(scope ? [scope] : []))
const linkPath = path.join(linkDir, shortName)
const backupDir = path.join(profileDir, `.${shortName}-backup`)

if (!fs.existsSync(manifestPath)) {
	console.error(`profile manifest not found: ${manifestPath}`)
	process.exit(1)
}

function isSymlink(target) {
	try {
		return fs.lstatSync(target).isSymbolicLink()
	} catch {
		return false
	}
}

if (uninstall) {
	if (fs.existsSync(backupDir)) {
		for (const file of fs.readdirSync(backupDir)) {
			fs.copyFileSync(path.join(backupDir, file), path.join(profileDir, file))
		}
		console.log(`restored profile files from ${backupDir}`)
	} else {
		// No backup (the profile was installed through the plugin manager): undo the
		// two manifest entries by hand so this script still uninstalls cleanly.
		const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		if (manifest.dependencies) delete manifest.dependencies[NAME]
		const bundles = manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles
		if (Array.isArray(bundles)) manifest.dsh.profile.bundles = bundles.filter((entry) => entry !== NAME)
		fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
		console.log('removed the dependency and bundle entries (no backup found)')
	}
	if (fs.existsSync(linkPath) || isSymlink(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true })
	console.log(`uninstalled ${NAME}`)
	process.exit(0)
}

// ---- back up the profile files once, before the very first install ---------
fs.mkdirSync(backupDir, { recursive: true })
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
	const source = path.join(profileDir, file)
	const target = path.join(backupDir, file)
	if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target)
}

// ---- 1. local package link -------------------------------------------------
fs.mkdirSync(linkDir, { recursive: true })
let linkIsCurrent = false
try {
	linkIsCurrent = isSymlink(linkPath) && fs.realpathSync(linkPath) === fs.realpathSync(pluginDir)
} catch (error) {
	linkIsCurrent = false
}
if (linkIsCurrent) {
	console.log(`link already points here: ${linkPath}`)
} else {
	if (fs.existsSync(linkPath) || isSymlink(linkPath)) fs.rmSync(linkPath, { force: true })
	fs.symlinkSync(pluginDir, linkPath, 'dir')
	console.log(`linked ${linkPath} → ${pluginDir}`)
}

// ---- 2 + 3. dependency and bundle selection --------------------------------
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const before = JSON.stringify(manifest)
manifest.dependencies = { ...(manifest.dependencies ?? {}), [NAME]: `file:${pluginDir}` }
manifest.dsh = manifest.dsh ?? {}
manifest.dsh.profile = manifest.dsh.profile ?? {}
const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
if (!bundles.includes(NAME)) bundles.push(NAME)
manifest.dsh.profile.bundles = bundles
if (JSON.stringify(manifest) === before) {
	console.log(`manifest already up to date: ${NAME}`)
} else {
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
	console.log(`manifest updated: dependency + bundle ${NAME}`)
}

console.log(`\n${NAME} installed into profile "${profileName}".`)
console.log('Restart DeepSeek Harness (Cmd+Q, then open again) to load it.')
