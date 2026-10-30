/**
 * Install this plugin (references/ → its package name) into the Desktop profile
 * as a local development link.
 *
 * The profile is an application-owned pnpm project at ~/.dsh/profiles/desktop.
 * Instead of going through the plugin manager (which installs registry packages
 * or dev-checkout `link:` specs), this script performs the same three writes the
 * manager would make, against this in-repo plugin directory:
 *
 *   1. node_modules/<scope>/<name> → symlink to this package
 *   2. package.json dependencies[<name>] = "file:<plugin>"
 *   3. package.json dsh.profile.bundles += <name>
 *
 * Every touched profile file is backed up once per plugin before the first
 * install and restored by --uninstall.
 *
 * Usage (run from anywhere):
 *   node references/scripts/install.mjs              # install
 *   node references/scripts/install.mjs --uninstall  # restore previous state
 *
 * Options:
 *   --plugin <dir>    plugin package dir relative to repo root (default: references)
 *   --profile <name>  profile name under ~/.dsh/profiles (default: desktop)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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
const pluginManifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'))
/** Package name declared by the plugin manifest (also the profile dependency name). */
const PACKAGE_NAME = pluginManifest.name
/** Names used by earlier versions of this plugin, cleaned up on install. */
const LEGACY_NAMES = ['@local/dsh-links']
const profileName = flagValue('--profile', 'desktop')
const profileDir = path.join(os.homedir(), '.dsh', 'profiles', profileName)
const manifestPath = path.join(profileDir, 'package.json')
const uninstall = flags.includes('--uninstall')

if (!fs.existsSync(path.join(pluginDir, 'package.json'))) {
	console.error(`plugin package not found: ${pluginDir}/package.json`)
	process.exit(1)
}

const NAME = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')).name
const shortName = NAME.split('/').pop()
const scope = NAME.includes('/') ? NAME.split('/')[0] : ''
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
	}
	if (fs.existsSync(linkPath) || isSymlink(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true })
	console.log(`uninstalled ${NAME}`)
	process.exit(0)
}

// ---- back up the profile files once, before the very first install ---------
// Existing backups are never overwritten: they hold the profile as it was
// before this plugin was ever installed, which is what --uninstall restores.
fs.mkdirSync(backupDir, { recursive: true })
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
	const source = path.join(profileDir, file)
	const target = path.join(backupDir, file)
	if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target)
}

// ---- 1. local package link -------------------------------------------------
// Re-running is a no-op when the link already resolves here, so an install from
// a read-only or sandboxed shell does not fail on an unchanged profile.
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
// Drop dependencies, bundle entries and links left by earlier package names.
for (const legacy of LEGACY_NAMES) {
	if (legacy === NAME) continue
	if (manifest.dependencies && legacy in manifest.dependencies) delete manifest.dependencies[legacy]
	const legacyBundles = manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles
	if (Array.isArray(legacyBundles)) {
		const index = legacyBundles.indexOf(legacy)
		if (index >= 0) legacyBundles.splice(index, 1)
	}
	const legacyScope = legacy.includes('/') ? legacy.split('/')[0] : ''
	const legacyPath = path.join(profileDir, 'node_modules', ...(legacyScope ? [legacyScope] : []), legacy.split('/').pop())
	if (fs.existsSync(legacyPath) || isSymlink(legacyPath)) fs.rmSync(legacyPath, { recursive: true, force: true })
}
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
