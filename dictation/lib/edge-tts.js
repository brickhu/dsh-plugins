/**
 * Edge TTS: Microsoft Edge's neural voices, synthesised through the `edge-tts`
 * Python package. No API key; the Host caches each MP3 on disk.
 *
 * The local macOS `say` service remains the fallback (and the status route
 * reports it when Edge is not installed), so a machine without Python still
 * has speech.
 *
 * @see lib/index.js (the /audio route)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const MAX_TEXT = 400
const TIMEOUT_MS = 15000
const MAX_CACHE_FILES = 600
const KEEP_CACHE_FILES = 500

/** Host voice slot → Edge neural voice. */
export const EDGE_VOICES = {
	stella: 'en-US-AriaNeural',
	tide: 'en-US-GuyNeural',
}

/** The venv the plugin installed, or an explicit override. */
function defaultBin(dir) {
	if (process.env.DSH_EDGE_TTS_BIN) return process.env.DSH_EDGE_TTS_BIN
	return path.join(dir, 'edge-tts-venv', 'bin', 'edge-tts')
}

/**
 * @typedef {{bytes: Buffer, format: string}} SynthesizedAudio
 */

/**
 * Create the Edge TTS service.
 * @param {{dir: string, execFileImpl?: Function, bin?: string}} options - cache dir and injectable runner.
 * @returns {{synthesize: Function, status: Function, cacheDir: string}} service.
 */
export function createEdgeTts(options) {
	const dir = options.dir
	const cacheDir = path.join(dir, 'audio-edge')
	fs.mkdirSync(cacheDir, { recursive: true })
	const execFileImpl = options.execFileImpl || execFile
	const bin = options.bin || defaultBin(dir)
	const inflight = new Map()

	function cacheFile(text, voice) {
		const hash = crypto.createHash('sha256').update(`edge|${voice}|${text}`).digest('hex').slice(0, 32)
		return path.join(cacheDir, `${hash}.mp3`)
	}

	function prune() {
		try {
			const entries = fs
				.readdirSync(cacheDir)
				.filter((name) => name.endsWith('.mp3'))
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
			/* pruning is housekeeping */
		}
	}

	function runEdge(content, voice) {
		const mapped = EDGE_VOICES[voice] || EDGE_VOICES.stella
		const target = path.join(cacheDir, `tmp-${crypto.randomBytes(8).toString('hex')}.mp3`)
		return new Promise((resolve) => {
			const args = ['--voice', mapped, '--text', content, '--write-media', target]
			const done = (error) => {
				try {
					if (error) {
						resolve(null)
						return
					}
					const bytes = fs.readFileSync(target)
					resolve(bytes.length > 0 ? bytes : null)
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
				execFileImpl(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, done)
			} catch (error) {
				done(error)
			}
		})
	}

	async function synthesize(text, voice) {
		const content = String(text ?? '').trim()
		if (content === '' || content.length > MAX_TEXT) return null
		const id = EDGE_VOICES[voice] ? voice : 'stella'
		const name = cacheFile(content, id)
		try {
			const cached = fs.readFileSync(name)
			if (cached.length > 0) return { bytes: cached, format: 'mp3' }
		} catch (error) {
			/* cache miss */
		}
		if (inflight.has(name)) return inflight.get(name)
		const task = (async () => {
			const bytes = await runEdge(content, id)
			if (bytes === null) return null
			try {
				fs.writeFileSync(name, bytes)
				prune()
			} catch (error) {
				/* best effort cache */
			}
			return { bytes, format: 'mp3' }
		})()
		inflight.set(name, task)
		try {
			return await task
		} finally {
			inflight.delete(name)
		}
	}

	/**
	 * Remove one cached phrase (used when the learner leaves a finished
	 * article). In-flight synthesis is awaited first so it cannot re-create the
	 * file after the delete.
	 * @param {string} text - phrase.
	 * @param {string} voice - host voice slot.
	 * @returns {Promise<void>} resolves when done.
	 */
	async function remove(text, voice) {
		const content = String(text ?? '').trim()
		if (content === '' || content.length > MAX_TEXT) return
		const id = EDGE_VOICES[voice] ? voice : 'stella'
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
			ready = fs.existsSync(bin)
		} catch (error) {
			ready = false
		}
		return {
			ready,
			engine: 'edge',
			voices: ready
				? [
						{ id: 'stella', name: 'Aria', lang: 'en-US' },
						{ id: 'tide', name: 'Guy', lang: 'en-US' },
					]
				: [],
		}
	}

	return { synthesize, remove, status, cacheDir }
}
