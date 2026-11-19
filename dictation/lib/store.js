/**
 * Profile storage for dsh-english-dictation.
 *
 * One JSON file under the DSH storage root:
 *
 *   ~/.dsh/storages/dsh-english-dictation/profile.json
 *
 * Writes are atomic (temp file + rename) and serialized, so killing the process
 * mid-sentence cannot leave a half-written profile. A corrupt file is copied
 * aside and replaced by an empty profile instead of crashing the Host.
 *
 * The store deliberately knows nothing about scoring or HTTP: it reads, shapes,
 * writes and hands back plain data.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyProfile, normalizeProfile, STORAGE_NAMESPACE } from './rules.js'

/** Filesystem name of the profile. */
export const PROFILE_FILE = 'profile.json'

/**
 * The directory the profile lives in.
 *
 * `DSH_DICTATION_STORAGE` exists so the tests can use a temp directory; normal
 * runs follow the DSH convention of `~/.dsh/storages/<package>/`.
 * @returns {string} absolute directory.
 */
export function storageRoot() {
	const override = process.env.DSH_DICTATION_STORAGE
	if (typeof override === 'string' && override !== '') return path.resolve(override)
	return path.join(os.homedir(), '.dsh', 'storages', STORAGE_NAMESPACE)
}

/**
 * @typedef {object} Store
 * @property {string} dir - storage directory.
 * @property {string} file - profile path.
 * @property {() => object} read - current in-memory profile.
 * @property {() => Promise<void>} save - persist the in-memory profile.
 * @property {(mutator: (profile: object) => void) => Promise<object>} update - mutate and persist.
 * @property {() => void} reload - drop the cache (next read hits disk).
 * @property {() => string[]} listBackups - corrupt copies kept on disk.
 */

/**
 * Create the profile store.
 * @param {{dir?: string, now?: () => Date}} [options] - overrides.
 * @returns {Store} store.
 */
export function createStore(options = {}) {
	const dir = options.dir ? path.resolve(options.dir) : storageRoot()
	const file = path.join(dir, PROFILE_FILE)
	const now = typeof options.now === 'function' ? options.now : () => new Date()
	let cached = null
	let chain = Promise.resolve()

	const backupName = () => path.join(dir, `${PROFILE_FILE}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}`)

	/**
	 * Read the profile from disk, backing up an unreadable file.
	 * @returns {object} profile.
	 */
	function load() {
		let text = ''
		try {
			text = fs.readFileSync(file, 'utf8')
		} catch (error) {
			const code = error && typeof error === 'object' ? error.code : ''
			if (code === 'ENOENT') {
				cached = emptyProfile()
				return cached
			}
			throw error
		}
		try {
			cached = normalizeProfile(JSON.parse(text))
			return cached
		} catch (error) {
			// Never let a damaged profile own the plugin: keep a copy for support,
			// then start clean.
			try {
				fs.mkdirSync(dir, { recursive: true })
				fs.copyFileSync(file, backupName())
			} catch (backupError) {
				/* the copy is a courtesy; losing it must not block recovery */
			}
			cached = emptyProfile()
			return cached
		}
	}

	/**
	 * Persist the cached profile atomically.
	 * @returns {void}
	 */
	function saveSync() {
		const profile = cached ?? load()
		fs.mkdirSync(dir, { recursive: true })
		const temp = path.join(dir, `${PROFILE_FILE}.${process.pid}.${Date.now()}.tmp`)
		const text = `${JSON.stringify(profile, null, 2)}\n`
		fs.writeFileSync(temp, text, 'utf8')
		fs.renameSync(temp, file)
	}

	return {
		dir,
		file,
		read() {
			if (cached === null) load()
			return cached
		},
		save() {
			chain = chain.then(
				() => saveSync(),
				() => saveSync(),
			)
			return chain
		},
		update(mutator) {
			chain = chain.then(() => {
				const profile = cached ?? load()
				mutator(profile)
				saveSync()
				return profile
			})
			return chain
		},
		reload() {
			cached = null
		},
		listBackups() {
			try {
				return fs
					.readdirSync(dir)
					.filter((entry) => entry.startsWith(`${PROFILE_FILE}.corrupt-`))
					.sort()
			} catch (error) {
				return []
			}
		},
	}
}
