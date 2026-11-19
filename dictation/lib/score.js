/**
 * Dictation scoring, shared by the browser copy and the Host's fallback for
 * completed exercises written before scores existed.
 *
 * Keep this file in sync with `dictationScore` / `scoreBand` / `referencePaceOf`
 * in lib/client.js. The Host only uses it to fill a missing score in the saved
 * library; the client is still the source of the score saved at completion.
 *
 * @module dsh-english-dictation/score
 */

/** Score bands used by the summary and the home badge. */
export function scoreBand(value) {
	const number = Number(value) || 0
	if (number >= 90) return 'excellent'
	if (number >= 75) return 'good'
	if (number >= 60) return 'pass'
	if (number >= 40) return 'weak'
	return 'retry'
}

/**
 * The article's dictation score.
 * @param {object[]} records - completed sentence records.
 * @param {object} [options] - elapsedMs and referencePace.
 * @returns {object} score breakdown.
 */
export function dictationScore(records, options = {}) {
	const list = Array.isArray(records) ? records.filter(Boolean) : []
	const words = list.flatMap((record) => (Array.isArray(record.words) ? record.words : []))
	let credit = 0
	let total = 0
	let firstTry = 0
	let hints = 0
	for (const word of words) {
		if (!word || word.given === true) continue
		total += 1
		const attempts = Math.max(1, Number(word.attempts) || 1)
		const base = attempts <= 1 ? 1 : attempts === 2 ? 0.6 : attempts === 3 ? 0.3 : 0.1
		const before = Math.max(0, Number(word.peekBeforeInput) || 0)
		const after = Math.max(0, Number(word.peekAfterWrong) || 0)
		const onCorrect = Math.max(0, Number(word.peekOnCorrect) || 0)
		const peeks = Math.max(0, Number(word.peeks) || 0)
		let hint = 1
		if (before > 0 && after === 0) hint = 0.25
		else if (after > 0) hint = 0.6
		else if (before > 0) hint = 0.6
		else if (peeks > onCorrect) hint = 0.8
		credit += base * hint
		if (attempts <= 1) firstTry += 1
		hints += Math.max(0, peeks - onCorrect)
	}
	const raw = total === 0 ? 0 : (100 * credit) / total
	const replays = list.reduce((sum, record) => sum + Math.max(0, Number(record.replays) || 0), 0)
	const sentences = list.length
	const avgReplay = sentences === 0 ? 0 : replays / sentences
	const listenFactor = Math.min(1, Math.max(0.8, 1 - 0.04 * Math.max(0, avgReplay - 1)))
	const inferredMs = list.reduce((sum, record) => sum + Math.max(0, Number(record.timeMs) || 0), 0)
	const elapsedMs = Math.max(0, Number(options.elapsedMs) || inferredMs)
	const pace = total > 0 && elapsedMs > 0 ? elapsedMs / 1000 / total : 0
	const referencePace = Math.max(0, Number(options.referencePace) || 0)
	const timeRatio = referencePace > 0 && pace > 0 ? pace / referencePace : 1
	const efficiencyFactor =
		referencePace > 0 ? Math.min(1, Math.max(0.85, 1 - 0.15 * Math.max(0, timeRatio - 1))) : 1
	const comprehension = 100 * listenFactor * efficiencyFactor
	const value = Math.max(0, Math.min(100, Math.round((raw * comprehension) / 100)))
	return {
		value,
		raw: Math.round(raw * 10) / 10,
		comprehension: Math.round(comprehension),
		spelling: Math.round(raw * 10) / 10,
		listenFactor: Math.round(listenFactor * 100) / 100,
		efficiencyFactor: Math.round(efficiencyFactor * 100) / 100,
		timeRatio: Math.round(timeRatio * 100) / 100,
		pace: Math.round(pace * 10) / 10,
		referencePace: Math.round(referencePace * 10) / 10,
		avgReplay: Math.round(avgReplay * 10) / 10,
		firstTry,
		words: total,
		hints,
		replays,
		sentences,
		band: scoreBand(value),
	}
}

/**
 * The median seconds-per-word of completed articles at one level.
 * @param {object[]} items - saved-library rows.
 * @param {string} cefr - level.
 * @param {string} excludeId - current article id.
 * @returns {number} reference pace, or 0 when there are fewer than 3 samples.
 */
export function referencePaceOf(items, cefr, excludeId) {
	const paces = (Array.isArray(items) ? items : [])
		.filter(
			(item) =>
				item &&
				item.id !== excludeId &&
				item.phase === 'done' &&
				item.cefr === cefr &&
				Number(item.words) > 0 &&
				Number(item.elapsedMs) > 0,
		)
		.map((item) => Number(item.elapsedMs) / 1000 / Number(item.words))
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((left, right) => left - right)
	if (paces.length < 3) return 0
	return paces[Math.floor(paces.length / 2)]
}
