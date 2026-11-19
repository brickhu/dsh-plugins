/**
 * Local TTS: the Host runs macOS `say`, one WAV per phrase, cached on disk.
 *
 * No cloud key, no network: the voice comes from the operating system. The
 * client maps its two host-voice slots (stella/tide) onto Samantha/Daniel when
 * those voices are installed; the system/browser voice remains the fallback on
 * machines without `say`.
 *
 * @see lib/index.js (the /audio route)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

/** Keep phrases short; this mirrors the old endpoint limit. */
const MAX_TEXT = 400
/** One local phrase is usually well under a second. */
const TIMEOUT_MS = 10000
/** Keep the cache small. */
const MAX_CACHE_FILES = 400
const KEEP_CACHE_FILES = 300

/** Host voice slot → macOS `say` voice. */
export const SAY_VOICES = {
	stella: 'Samantha',
	tide: 'Daniel',
}

const SAY_PATH = process.env.DSH_DICTATION_SAY || '/usr/bin/say'

/**
 * @typedef {{bytes: Buffer, format: string}} SynthesizedAudio
 */

/**
 * Create the local audio service.
 * @param {{dir: string, execFileImpl?: Function, sayPath?: string}} options - cache dir and injectable runner.
 * @returns {{synthesize: Function, status: Function, cacheDir: string}} service.
 */
export function createLocalTts(options) {
	const dir = options.dir
	const cacheDir = path.join(dir, 'audio-local')
	fs.mkdirSync(cacheDir, { recursive: true })
	const execFileImpl = options.execFileImpl || execFile
	const sayPath = options.sayPath || SAY_PATH
	const inflight = new Map()

	/** Cache name for one phrase and host voice slot. */
	function cacheFile(text, voice) {
		const hash = crypto.createHash('sha256').update(`${voice}|${text}`).digest('hex').slice(0, 32)
		return path.join(cacheDir, `${hash}.wav`)
	}

	/** Drop the oldest entries once the cache outgrows its bound. */
	function prune() {
		try {
			const entries = fs
				.readdirSync(cacheDir)
				.filter((name) => name.endsWith('.wav'))
				.map((name) => {
					const file = path.join(cacheDir, name)
					try {
						return { file, at: fs.statSync(file).mtimeMs }
					} catch (error) {
						return null
					}
				})
				.filter(Boolean)
			if (entries.length <= MAX_CACHE_FILES) return
			entries.sort((left, right) => left.at - right.at)
			for (const entry of entries.slice(0, entries.length - KEEP_CACHE_FILES)) {
				try {
					fs.unlinkSync(entry.file)
				} catch (error) {
					/* a file another request still reads may survive one sweep */
				}
			}
		} catch (error) {
			/* pruning is housekeeping, never a reason to fail a phrase */
		}
	}

	/**
	 * Run `say` once and return the WAV it wrote.
	 * @param {string} content - phrase.
	 * @param {string} voice - host voice slot.
	 * @returns {Promise<Buffer|null>} bytes, or null.
	 */
	function runSay(content, voice) {
		const mapped = SAY_VOICES[voice] || SAY_VOICES.stella
		const target = path.join(cacheDir, `tmp-${crypto.randomBytes(8).toString('hex')}.wav`)
		return new Promise((resolve) => {
			const args = ['-v', mapped, '--data-format=LEI16@22050', '-o', target, '--', content]
			const done = (error) => {
				try {
					if (error) {
						resolve(null)
						return
					}
					const bytes = fs.readFileSync(target)
					if (bytes.length <= 44) {
						resolve(null)
						return
					}
					resolve(bytes)
				} catch (readError) {
					resolve(null)
				} finally {
					try {
						fs.unlinkSync(target)
					} catch (error) {
						/* best effort temp cleanup */
					}
				}
			}
			try {
				execFileImpl(sayPath, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, done)
			} catch (error) {
				done(error)
			}
		})
	}

	/**
	 * WAV bytes for one phrase, from cache or macOS `say`.
	 * @param {string} text - phrase.
	 * @param {string} [voice] - `stella` (default) or `tide`.
	 * @returns {Promise<SynthesizedAudio|null>} audio, or null.
	 */
	async function synthesize(text, voice) {
		const content = String(text ?? '').trim()
		if (content === '' || content.length > MAX_TEXT) return null
		const id = SAY_VOICES[voice] ? voice : 'stella'
		const name = cacheFile(content, id)
		try {
			const cached = fs.readFileSync(name)
			if (cached.length > 44) return { bytes: cached, format: 'wav' }
		} catch (error) {
			/* cache miss */
		}
		if (inflight.has(name)) return inflight.get(name)
		const task = (async () => {
			const bytes = await runSay(content, id)
			if (bytes === null) return null
			try {
				fs.writeFileSync(name, bytes)
				prune()
			} catch (error) {
				/* the cache is best effort; the bytes are still playable */
			}
			return { bytes, format: 'wav' }
		})()
		inflight.set(name, task)
		try {
			return await task
		} finally {
			inflight.delete(name)
		}
	}

	/**
	 * Whether the Host can synthesize local audio, and which slots it maps to.
	 * @returns {Promise<{ready: boolean, engine: string, voices: Array<object>}>} status.
	 */
	/**
	 * Remove one cached phrase. In-flight synthesis is awaited first so it cannot
	 * re-create the file after the delete.
	 * @param {string} text - phrase.
	 * @param {string} voice - host voice slot.
	 * @returns {Promise<void>} resolves when done.
	 */
	async function remove(text, voice) {
		const content = String(text ?? '').trim()
		if (content === '' || content.length > MAX_TEXT) return
		const id = SAY_VOICES[voice] ? voice : 'stella'
		const name = cacheFile(content, id)
		const task = inflight.get(name)
		if (task) {
			try {
				await task
			} catch (error) {
				/* a failed synth leaves no file */
			}
		}
		try {
			fs.unlinkSync(name)
		} catch (error) {
			/* already gone */
		}
	}

	async function status() {
		let ready = false
		try {
			ready = fs.existsSync(sayPath)
		} catch (error) {
			ready = false
		}
		return {
			ready,
			engine: 'local',
			voices: ready
				? [
						{ id: 'stella', name: SAY_VOICES.stella, lang: 'en-US' },
						{ id: 'tide', name: SAY_VOICES.tide, lang: 'en-GB' },
					]
				: [],
		}
	}

	return { synthesize, remove, status, cacheDir }
}
