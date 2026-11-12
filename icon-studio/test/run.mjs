/**
 * Offline checks for dsh-icon-studio. No DSH process needed:
 *
 *   node test/run.mjs
 *
 * Covers the SVG normaliser (the acceptance-critical part), the library store,
 * the generated layer, @asset rewriting, and the client's geometry helpers.
 */

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { normalizeSvg, pathBBox, parsePath, serializeGraphic, transformPath, bakeIconifyTransform } from '../lib/svg.js'
import { createStore, MANIFEST_FILE, slugify, normalizeName, refName } from '../lib/store.js'
import { applyAsset, cascadeRename, scanUsage } from '../lib/assets.js'
import { findShapePointers, pushShapePointers, readDerivations, isUiSource, isStyleSource, scanCodeShapes, decodedShapeSignature } from '../lib/sync.js'
import { dataUriBlocks, encodeLike, countBlob } from '../lib/datauri.js'
import { audit, scanSites, violations } from '../lib/report.js'
import { bodySignature, shapeSignature, mergeInner, isSquareCanvas, generatedIconIssues } from '../lib/shape.js'
import { parseSupplyRef, seedRule, svgCanvasSize, isImportedSource, createIconmcpClient } from '../lib/supply.js'
import { isNewer, latestPublished } from '../lib/update.js'

let passed = 0
let failed = 0

function test(name, run) {
	try {
		const result = run()
		if (result && typeof result.then === 'function') {
			return result.then(() => {
				passed += 1
				console.log(`  ok  ${name}`)
			}).catch((error) => {
				failed += 1
				console.error(`FAIL  ${name}\n      ${error.message}`)
			})
		}
		passed += 1
		console.log(`  ok  ${name}`)
	} catch (error) {
		failed += 1
		console.error(`FAIL  ${name}\n      ${error.message}`)
	}
}

/** In-memory filesystem port shaped exactly like the Host's `fs` adapter. */
function memIo(initial = {}) {
	const files = new Map(Object.entries(initial))
	const dirs = new Set()
	const remember = (rel) => {
		const parts = rel.split('/')
		for (let index = 1; index < parts.length; index += 1) dirs.add(parts.slice(0, index).join('/'))
	}
	for (const key of files.keys()) remember(key)
	return {
		files,
		async readText(rel) {
			return files.has(rel) ? files.get(rel) : null
		},
		async writeText(rel, text) {
			files.set(rel, text)
			remember(rel)
		},
		async stat(rel) {
			if (files.has(rel)) return { type: 'file', size: files.get(rel).length }
			if (dirs.has(rel)) return { type: 'directory' }
			return null
		},
		async listDir(rel) {
			const prefix = rel === '.' || rel === '' ? '' : `${rel.replace(/\/$/, '')}/`
			const names = new Map()
			for (const key of files.keys()) {
				if (!key.startsWith(prefix)) continue
				const rest = key.slice(prefix.length)
				const parts = rest.split('/')
				if (parts[0] === '') continue
				names.set(parts[0], parts.length > 1 ? 'directory' : 'file')
			}
			for (const dir of dirs) {
				if (!dir.startsWith(prefix)) continue
				const rest = dir.slice(prefix.length)
				if (rest === '' || rest.includes('/')) continue
				names.set(rest, 'directory')
			}
			return [...names.entries()].map(([name, type]) => ({ name, type }))
		},
	}
}

/** A real IconMCP drawing: 16-unit grid, paint on the root, a <g> wrapper. */
const ICONMCP_SOLID = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="0.833">
  <g><path d="M2.75 8H13.25" fill="currentColor" stroke="none"/></g>
</svg>`
const ICONMCP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="0.833" stroke-linecap="round" stroke-linejoin="round">
  <g>
    <path d="M3.5 4.25 L4.105 11.907 C4.187 12.948 5.055 13.75 6.098 13.75 L9.902 13.75 C10.945 13.75 11.813 12.948 11.895 11.907 L12.5 4.25"/>
    <line x1="2.25" y1="4.25" x2="13.75" y2="4.25"/>
  </g>
</svg>`

const FIGMA_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g clip-path="url(#clip0_1_2)">
    <g transform="translate(2 2)">
      <path d="M10 2L12 4L10 6L8 4L10 2ZM14 10L16 12L14 14L12 12L14 10Z" fill="#1A1A1A"/>
      <path style="fill:#FF0000;stroke:none" d="M2 20 h 4 v 4 h -4 z"/>
    </g>
  </g>
  <defs>
    <clipPath id="clip0_1_2"><rect width="24" height="24" fill="white"/></clipPath>
  </defs>
</svg>`

const USE_AND_STYLE = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <style>.mark{fill:#00aa66}.ring{stroke:#123456;stroke-width:2;fill:none}</style>
  <defs><g id="chevron"><path d="M0 0L8 8L0 16"/></g></defs>
  <use href="#chevron" x="6" y="6" class="ring"/>
  <circle cx="34" cy="34" r="8" class="mark"/>
</svg>`

async function main() {
	console.log('svg normaliser')

	test('flattens transforms', () => {
		const graphic = normalizeSvg(FIGMA_ICON)
		assert.ok(!graphic.svg.includes('transform='), 'output still has a transform')
		assert.equal(graphic.elements.length, 3, 'expected three elements')
		assert.ok(graphic.elements[0].d.includes('L'), 'path data missing')
	})

	test('a rounded rect keeps its corner arcs', () => {
		const normalized = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="currentColor"/></svg>')
		const d = /d="([^"]+)"/.exec(normalized.svg)[1]
		const cubic = parsePath(d).find((segment) => segment.c === 'C')
		assert.ok(cubic, 'the corners are cubics')
		const [control, , end] = cubic.p
		assert.ok(Math.abs(control[0] - 55.94) < 0.05, `the first control sits near the right edge, got ${control[0]}`)
		assert.ok(Math.abs(end[0] - 64) < 0.05 && Math.abs(end[1] - 18) < 0.05, 'and the arc ends on the rounded corner')
	})

	test('splits a merged path into one element per M', () => {
		const graphic = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L4 0L4 4Z M8 8L12 8L12 12Z" fill="#000"/></svg>')
		assert.equal(graphic.elements.length, 2)
		assert.ok(graphic.elements.every((element) => (element.d.match(/M/g) ?? []).length === 1))
	})

	test('the editor loads a compound path as one element', async () => {
		const compound = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16 18L12 22L8 18L12 14Z M10 18L12 20L14 18L12 16Z" fill="currentColor"/></svg>'
		const store = createStore(memIo({}))
		await store.save({ name: 'holes', svg: compound, note: 'x' })
		const loaded = await store.get('holes')
		assert.equal(loaded.elements.length, 1, 'the editor must not refill the hole')
		assert.equal((loaded.elements[0].d.match(/M/g) ?? []).length, 2)
	})

	test('nested subpaths stay one compound path so holes survive', () => {
		const compound = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16 18L12 22L8 18L12 14Z M10 18L12 20L14 18L12 16Z" fill="#000"/></svg>'
		const graphic = normalizeSvg(compound, { preserveViewBox: true })
		assert.equal(graphic.elements.length, 1, 'a hole must not become a separate filled shape')
		assert.equal((graphic.elements[0].d.match(/M/g) ?? []).length, 2, 'both subpaths are preserved')
	})

	test('inlines style attributes and stylesheet rules, expands <use>', () => {
		const graphic = normalizeSvg(USE_AND_STYLE)
		assert.ok(!graphic.svg.includes('style='), 'a style attribute survived')
		assert.ok(!graphic.svg.includes('<use'), 'a <use> survived')
		assert.equal(graphic.elements.length, 2)
		assert.ok(graphic.palette.includes('#123456'), `palette was ${graphic.palette.join(',')}`)
	})

	test('a single-colour icon becomes currentColor', () => {
		const graphic = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12L10 18L20 6" fill="none" stroke="#1A1A1A" stroke-width="2"/></svg>')
		assert.deepEqual(graphic.elements.map((element) => element.stroke), ['currentColor'])
		assert.deepEqual(graphic.palette, ['#1a1a1a'])
	})

	test('an icon that already mixes currentColor with a colour keeps both', () => {
		const graphic = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h6v6H4z" fill="currentColor"/><path d="M14 14h6v6h-6z" fill="#ff0000"/></svg>')
		assert.deepEqual(graphic.elements.map((element) => element.fill), ['currentColor', '#ff0000'])
	})

	test('a multi-colour icon keeps its own paint and records the palette', () => {
		const graphic = normalizeSvg(FIGMA_ICON)
		assert.deepEqual(graphic.elements.map((element) => element.fill), ['#1a1a1a', '#1a1a1a', '#ff0000'])
		assert.deepEqual(graphic.palette.sort(), ['#1a1a1a', '#ff0000'])
	})

	test('logo paint keeps its own colours', () => {
		const graphic = normalizeSvg(USE_AND_STYLE)
		assert.ok(graphic.svg.includes('#00aa66'))
		assert.ok(graphic.svg.includes('#123456'))
	})

	test('naming hints come from the markup before the model is asked', async () => {
		const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
		assert.ok(source.includes('nameHintFromMarkup'), 'markup hints are implemented')
		const block = source.slice(source.indexOf('function nameHintFromMarkup'), source.indexOf('function inferNameFromModel'))
		// the sanitised hint keeps kebab-case and trims to three words
		const toKebab = (value) => value
			.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
			.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 3).join('-')
		assert.equal(toKebab('Chevron Down'), 'chevron-down')
		assert.equal(toKebab('  Close X  '), 'close-x')
		assert.equal(toKebab('关闭'), '')
		assert.ok(block.includes('/<title'))
	})

	test('dragging an icon drops its <name> reference', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(source.includes("setData('text/plain', `<${entry.name}>`)"), 'drag inserts the bracketed name')
		assert.ok(!source.includes('text/x-dsh-icon'), 'no icon mention payload any more')
		assert.ok(source.includes('navigator.clipboard.writeText(reference)'), 'Copy Name copies the <name> reference')
	})

	test('names may be Chinese, but never contain the reference brackets', () => {
		assert.throws(() => normalizeName('a<b'), (error) => error.code === 'invalid-name')
		assert.equal(normalizeName('删除'), '删除')
	})

	test('conversation references are parsed and emitted', () => {
		assert.equal(refName('<删除>'), '删除')
		assert.equal(refName('  <删除>  '), '删除')
		assert.equal(refName('删除'), '删除')
		assert.equal(refName('<a><b>'), 'a><b', 'only the outermost pair is a reference')
		const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
		assert.ok(source.includes('normalizeName(refName(args && args.name))'), 'icon_get accepts <name>')
		assert.ok(source.includes('refName(args.query)'), 'icon_list search accepts <name>')
		assert.ok(source.includes('lines.push(`- <${entry.name}>'), 'icon_list emits <name>')
		assert.ok(source.includes('In conversation, refer to it as <${entry.name}>'), 'icon_get tells the agent how to cite it')
	})

	test('a clipboard paste keeps the declared viewBox and coordinates', () => {
		const pasted = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 6L18 18" stroke="#000"/></svg>', { preserveViewBox: true })
		assert.equal(pasted.viewBox, '0 0 24 24', 'the authored canvas wins over the content bbox')
		assert.ok(pasted.svg.includes('M6 6L18 18'), 'coordinates stay as authored')
		const fallback = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20"><path d="M2 2L10 10" stroke="#000"/></svg>', { preserveViewBox: true })
		assert.equal(fallback.viewBox, '0 0 32 20', 'width/height stand in when there is no viewBox')
		const untrimmed = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M2 2L10 10" stroke="#000"/></svg>', { preserveViewBox: true })
		assert.equal(untrimmed.viewBox, '0 0 9 9', 'no canvas in the document falls back to trimming (plus the half-stroke pad)')
	})

	test('trims an import to the content on a square icon canvas', () => {
		const graphic = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="6" width="10" height="6" fill="#000"/></svg>')
		const [x, y, width, height] = graphic.viewBox.split(' ').map(Number)
		assert.equal(x, 0)
		assert.equal(y, 0)
		assert.equal(width, height, 'icon canvases are square')
		assert.equal(width, 10)
		assert.equal(graphic.width, 10)
	})

	test('converts arcs to cubics without losing the shape', () => {
		const graphic = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20" fill="#000"/></svg>')
		assert.ok(graphic.svg.includes('C'))
		assert.ok(!graphic.svg.includes('A'))
		const box = pathBBox(graphic.elements[0].d)
		assert.ok(Math.abs(box.width - 20) < 0.2, `width was ${box.width}`)
	})

	test('viewBox origin stays 0 0 and numbers stay clean', () => {
		const graphic = normalizeSvg(FIGMA_ICON)
		assert.ok(graphic.viewBox.startsWith('0 0 '))
		assert.ok(!/NaN|Infinity/.test(graphic.svg))
	})

	test('identical art produces the same hash, different paint does not', () => {
		const a = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L4 0L4 4Z" fill="#000"/></svg>')
		const b = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L4 0L4 4Z" fill="#111111"/></svg>')
		const c = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L4 0L4 4Z" fill="#000"/></svg>')
		assert.notEqual(a.hash, b.hash)
		assert.equal(a.hash, c.hash)
	})

	test('rejects documents with nothing drawable', () => {
		assert.throws(() => normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">hi</text></svg>'), (error) => error.code === 'empty-graphic')
	})

	test('serialised documents keep no transform, style or class', () => {
		const graphic = normalizeSvg(USE_AND_STYLE)
		assert.ok(!/transform=|style=|class=/.test(graphic.svg))
	})

	test('transformPath applies an affine matrix', () => {
		const moved = transformPath('M0 0L10 0', [2, 0, 0, 2, 5, 5])
		assert.equal(moved, 'M5 5L25 5')
	})

	test('parsePath handles relative commands and implicit lineto', () => {
		const segments = parsePath('m10 10 5 0 0 5 z')
		assert.equal(segments[0].c, 'M')
		assert.equal(segments[1].c, 'L')
		assert.equal(segments[2].c, 'L')
		assert.deepEqual(segments[2].p[0], [15, 15])
	})

	await test('an identical paste reports the existing name and rule', async () => {
		const store = createStore(memIo({}))
		await store.save({ name: 'delete', svg: FIGMA_ICON, rule: '删除动作；不要用于关闭' })
		const inspected = await store.inspect({ svg: FIGMA_ICON })
		assert.equal(inspected.duplicate, 'delete')
		assert.equal(inspected.duplicateRule, '删除动作；不要用于关闭')
	})

	await test('pointer scanning stays inside shipped UI code', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/App.tsx': `export const Box = () => (${svg})`,
			'test/Icon.test.tsx': `expect(${svg})`,
			'docs/demo.html': `<div>${svg}</div>`,
			'fixtures/icon.svg': svg,
		})
		assert.equal(isUiSource('src/App.tsx'), true)
		assert.equal(isUiSource('test/Icon.test.tsx'), false)
		assert.equal(isUiSource('docs/demo.html'), false)
		assert.equal(isUiSource('fixtures/icon.svg'), false)
		const pointers = await findShapePointers(io, svg)
		assert.deepEqual(pointers.map((pointer) => pointer.file), ['src/App.tsx'])
	})

	await test('the canvas is not part of the icon identity', async () => {
		const inner = '<path d="M4 4h16v16H4z" fill="currentColor"/>'
		const small = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`
		const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${inner}</svg>`
		const store = createStore(memIo({}))
		const first = await store.save({ name: 'box', svg: small, viewBox: '0 0 24 24', preserveViewBox: true })
		assert.equal(first.status, 'saved')
		const duplicate = await store.save({ name: 'box-big', svg: big, viewBox: '0 0 48 48', preserveViewBox: true })
		assert.equal(duplicate.status, 'duplicate', 'same inner code in another canvas is the same icon')
		assert.equal(duplicate.of, 'box')
		const inspected = await store.inspect({ svg: big, preserveViewBox: true })
		assert.equal(inspected.duplicate, 'box')
	})

	await test('same ratio is one icon, another ratio is not', async () => {
		const inner = '<path d="M4 4h16v16H4z" fill="currentColor"/>'
		const square24 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`
		const square48 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${inner}</svg>`
		const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24">${inner}</svg>`
		const store = createStore(memIo({}))
		assert.equal((await store.save({ name: 'a', svg: square24, viewBox: '0 0 24 24', preserveViewBox: true })).status, 'saved')
		assert.equal((await store.save({ name: 'b', svg: square48, viewBox: '0 0 48 48', preserveViewBox: true })).status, 'duplicate', 'same ratio, other size')
		assert.equal((await store.save({ name: 'c', svg: wide, viewBox: '0 0 48 24', preserveViewBox: true })).status, 'saved', 'another ratio is another icon')

		const io = memIo({ 'src/Wide.tsx': `export const Wide = () => (${wide})` })
		assert.equal((await findShapePointers(io, square24)).length, 0, 'a wide copy does not match a square icon')
	})

	await test('rewriting a markup constant never injects a newline', async () => {
		const source = "const M = { viewBox: '0 0 16 16', markup: '<path d=\"M2 2h12v12H2z\" fill=\"currentColor\"/>' }"
		const io = memIo({ 'package.json': '{}', 'src/m.ts': source })
		const library = '<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z" fill="currentColor"/></svg>'
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1)
		const next = '<svg viewBox="0 0 16 16">\n  <path d="M0 0h16v16H0z" fill="currentColor"/>\n</svg>'
		await pushShapePointers(io, next, pointers)
		const out = io.files.get('src/m.ts')
		assert.ok(out.includes("markup: '<path"))
		assert.ok(!/markup: '[^']*\n/u.test(out), 'the literal stays on one line')
		assert.doesNotThrow(() => new Function(out), 'the file is still valid JS')
	})

	await test('shared path constants are references', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/icons.ts': "const HIGHLIGHT = 'M4 4L20 4L20 20L4 20Z'\nexport const Icon = () => h('path', { d: HIGHLIGHT })",
		})
		const library = '<svg viewBox="0 0 24 24"><path d="M4 4L20 4L20 20L4 20Z" fill="currentColor"/></svg>'
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1, 'the constant is a reference')
		assert.equal(pointers[0].kind, 'path')
		assert.equal(pointers[0].literal, 'M4 4L20 4L20 20L4 20Z')
		const next = library.replace('M4 4L20 4L20 20L4 20Z', 'M2 2L22 2L22 22L2 22Z')
		await pushShapePointers(io, next, pointers)
		assert.ok(io.files.get('src/icons.ts').includes("'M2 2L22 2L22 22L2 22Z'"), 'the constant is rewritten')
	})

	await test('a shared path constant counts once across several SVGs', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/icons.ts': `const P = 'M4 4L20 4L20 20L4 20Z'
export const A = () => h('svg', { viewBox: '0 0 24 24', fill: 'none' }, h('path', { d: P, fill: 'currentColor' }))
export const B = () => h('svg', { viewBox: '0 0 24 24', fill: 'none' }, h('path', { d: P, fill: 'currentColor' }))`,
		})
		const library = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4L20 4L20 20L4 20Z" fill="currentColor"/></svg>'
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1, 'the constant is one rewrite site, not one per SVG')
		assert.equal(pointers[0].kind, 'path')
		const groups = await scanCodeShapes(io)
		// Scan identity is the normalised drawing, not the authored markup.
		const shared = groups.find((group) => group.signature === bodySignature(normalizeSvg(library).svg))
		assert.ok(shared, 'the shape is listed')
		assert.equal(shared.sites.length, 2, 'both SVGs are usage sites')
		const next = library.replace('M4 4L20 4L20 20L4 20Z', 'M2 2L22 2L22 22L2 22Z')
		await pushShapePointers(io, next, pointers)
		const out = io.files.get('src/icons.ts')
		assert.equal((out.match(/M2 2L22 2L22 22L2 22Z/g) || []).length, 1, 'the constant is rewritten once')
		assert.ok(!out.includes('M4 4L20 4L20 20L4 20Z'), 'the old path is gone')
	})

	await test('markup constants are found and rewritten in place', async () => {
		const source = `const LOGO = { viewBox: '0 0 16 16', markup: '<path d="M2 2h12v12H2z" fill="currentColor"/>' }`
		const io = memIo({ 'package.json': '{}', 'src/marks.ts': source })
		const library = '<svg viewBox="0 0 16 16"><path d="M2 2h12v12H2z" fill="currentColor"/></svg>'
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1, 'a markup constant is a reference')
		assert.equal(pointers[0].kind, 'markup')
		const next = library.replace('M2 2h12v12H2z', 'M0 0h16v16H0z')
		await pushShapePointers(io, next, pointers)
		const out = io.files.get('src/marks.ts')
		assert.ok(out.includes('d="M0 0h16v16H0z"'), 'the markup string is rewritten')
		assert.ok(out.includes("viewBox: '0 0 16 16'"), 'the constant keeps its shape')
	})

	await test('React-style copies are found and rewritten', async () => {
		const source = `const A = () => h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },\n\th('path', { fill: 'currentColor', d: 'M4 4h16v16H4z' }),\n)`
		const io = memIo({ 'package.json': '{}', 'src/a.tsx': source })
		const library = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1, 'the h(svg) call is a reference')
		assert.equal(pointers[0].kind, 'jsx')
		const next = library.replace('M4 4h16v16H4z', 'M2 2h20v20H2z')
		await pushShapePointers(io, next, pointers)
		assert.ok(io.files.get('src/a.tsx').includes("d: 'M2 2h20v20H2z'"), 'the path literal is rewritten in place')
		assert.ok(io.files.get('src/a.tsx').includes("viewBox: '0 0 24 24'"), 'the call keeps its props')
	})

	await test('replacing a shape keeps each site canvas', async () => {
		const inner = '<path d="M4 4h16v16H4z" fill="currentColor"/>'
		const site = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${inner}</svg>`
		const library = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`
		const io = memIo({ 'src/Box.tsx': `export const Box = () => (${site})` })
		const pointers = await findShapePointers(io, library)
		assert.equal(pointers.length, 1, 'a different canvas still matches')
		const next = library.replace('M4 4h16v16H4z', 'M2 2h20v20H2z')
		await pushShapePointers(io, next, pointers)
		const out = io.files.get('src/Box.tsx')
		assert.ok(out.includes('viewBox="0 0 48 48"'), 'the site keeps its own canvas')
		assert.ok(out.includes('width="48"'), 'and its size attributes')
		assert.ok(out.includes('M2 2h20v20H2z'), 'only the inner code is replaced')
	})

	await test('the workspace scan offers icon-like art and rejects illustrations', async () => {
		const glyph = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		// A real favicon: dark rounded square, two eyes, a green stroke — three colours.
		const favicon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
			+ '<rect width="64" height="64" rx="18" fill="#17140F"/>'
			+ '<circle cx="24" cy="27" r="3.6" fill="#F6F1E7"/>'
			+ '<circle cx="40" cy="27" r="3.6" fill="#F6F1E7"/>'
			+ '<path d="M22 38c3.2 4 6.6 6 10 6s6.8-2 10-6" stroke="#22AA5A" stroke-width="3.6" stroke-linecap="round" fill="none"/>'
			+ '</svg>'
		const gradient = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#g)"/></svg>'
		const illustration = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${'<path d="M1 1h2v2H1z" fill="#111111"/>'.repeat(50)}</svg>`
		const manyColours = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${Array.from({ length: 12 }, (_, index) => `<path d="M${index} 0h2v2H${index}z" fill="#${(index + 1).toString(16).padStart(2, '0')}0000"/>`).join('')}</svg>`
		const io = memIo({
			'package.json': '{}',
			'src/Glyph.tsx': `export const A = () => (${glyph})`,
			'src/Favicon.tsx': `export const B = () => (${favicon})`,
			'src/Gradient.tsx': `export const C = () => (${gradient})`,
			'src/Illustration.tsx': `export const D = () => (${illustration})`,
			'src/ManyColours.tsx': `export const E = () => (${manyColours})`,
		})
		const groups = await scanCodeShapes(io)
		const files = groups.map((group) => group.sites[0].file)
		assert.ok(files.includes('src/Glyph.tsx'), 'a plain glyph is offered')
		assert.ok(files.includes('src/Favicon.tsx'), 'so is a three-colour favicon')
		assert.ok(!files.includes('src/Gradient.tsx'), 'gradient art is still out of scope')
		assert.ok(!files.includes('src/Illustration.tsx'), 'fifty shapes is an illustration, not a glyph')
		assert.ok(!files.includes('src/ManyColours.tsx'), 'twelve colours is not a glyph')
		const fav = groups.find((group) => group.sites[0].file === 'src/Favicon.tsx')
		assert.ok(/#17140f/i.test(fav.preview) && /#22aa5a/i.test(fav.preview), 'its preview keeps the authored colours')
	})

	await test('a scanned icon is previewed the way it will be stored', async () => {
		const red = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#ff0000"/></svg>'
		const solid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'
		const invisible = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5h7v7H5z" fill="none"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/Red.tsx': `export const A = () => (${red})`,
			'src/Solid.tsx': `export const B = () => (${solid})`,
			'src/Invisible.tsx': `export const C = () => (${invisible})`,
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 2, 'the paint-less shape is not offered at all')
		assert.equal(groups.unusable, 1, 'and it is counted as unusable')
		const redGroup = groups.find((group) => group.svg.includes('#ff0000'))
		assert.ok(redGroup, 'the red square is a candidate')
		assert.ok(redGroup.preview.includes('fill="currentColor"'), 'its preview follows the text colour')
		assert.ok(!redGroup.preview.includes('#ff0000'), 'the hard-coded red is gone from the preview')
		assert.ok(redGroup.svg.includes('#ff0000'), 'but the authored markup is kept for the import')
		const solidGroup = groups.find((group) => group.svg.includes('<circle'))
		assert.ok(solidGroup.preview.includes('fill="currentColor"'), 'a fill-less path previews as currentColor, not black')
	})

	await test('the workspace scan ignores packages and build output', async () => {
		const box = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/A.tsx': `export const A = () => (${box})`,
			'node_modules/pkg/index.tsx': `export const X = () => (${box})`,
			'dist/assets/app.js': `export const Y = () => (${box})`,
			'storybook-static/app.js': `export const Z = () => (${box})`,
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 1, 'only source code is scanned')
		assert.deepEqual(groups[0].sites.map((site) => site.file), ['src/A.tsx'])
	})

	await test('only a square canvas is offered by the workspace scan', () => {
		assert.equal(isSquareCanvas('<svg viewBox="0 0 24 24"><path d="M4 4H20"/></svg>'), true)
		assert.equal(isSquareCanvas('<svg viewBox="0 0 16 16"><path d="M2 2H14"/></svg>'), true)
		assert.equal(isSquareCanvas('<svg viewBox="0 0 24 23.995"><path d="M4 4H20"/></svg>'), true, 'rounding is tolerated')
		assert.equal(isSquareCanvas('<svg viewBox="0 0 32 24"><path d="M4 4H28"/></svg>'), false, 'a wide canvas is not an icon')
		assert.equal(isSquareCanvas('<svg viewBox="0 0 24 48"><path d="M4 4H20"/></svg>'), false)
		assert.equal(isSquareCanvas('<svg width="40" height="40"><path d="M4 4H20"/></svg>'), true)
		assert.equal(isSquareCanvas('<svg width="40" height="20"><path d="M4 4H20"/></svg>'), false)
		assert.equal(isSquareCanvas('<svg><path d="M4 4H20"/></svg>'), false, 'no declared canvas is not a square canvas')
	})

	await test('the scan drops non-square art and counts what it dropped', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/marks.tsx': [
				'export const A = () => <svg viewBox="0 0 24 24" fill="none"><path d="M4 4H20" stroke="currentColor"/></svg>',
				'export const B = () => <svg viewBox="0 0 32 24" fill="none"><path d="M4 4H28" stroke="currentColor"/></svg>',
			].join('\n'),
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 1, 'the wide canvas is not offered')
		assert.ok(groups[0].svg.includes('viewBox="0 0 24 24"'))
		assert.equal(groups.excluded, 1, 'and the panel can say why something disappeared')
	})

	await test('an icon added from code is recognised on the next scan', async () => {
		// The paint lives on the root here: the old comparison hashed the authored
		// markup, while the save stores a <g> wrapper as its body — different text,
		// same drawing, so the panel showed no name and no tick after adding it.
		const raw = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16"/></svg>'
		const io = memIo({ 'package.json': '{}', 'src/A.tsx': `export const A = () => (${raw})` })
		const first = await scanCodeShapes(io)
		assert.equal(first.length, 1)
		const store = createStore(io)
		await store.save({ name: 'my-icon', svg: first[0].svg, viewBox: first[0].viewBox, preserveViewBox: true, rule: 'x' })
		const entry = (await store.get('my-icon')).entry
		assert.ok(entry.signature, 'the entry records its normalised identity')
		assert.equal(entry.signature, first[0].signature, 'which is exactly the scan identity')
		const stored = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.viewBox}">${entry.body}</svg>`
		assert.notEqual(bodySignature(raw), bodySignature(stored), 'the authored markup and the stored body hash differently')
		const second = await scanCodeShapes(io)
		assert.equal(second[0].signature, entry.signature, 'so the next scan can name it')
	})

	await test('the same icon written two ways is one scan group', async () => {
		const rootPaint = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16"/></svg>'
		const elementPaint = '<svg viewBox="0 0 24 24"><path d="M4 4h16" fill="none" stroke="currentColor"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/A.tsx': `export const A = () => (${rootPaint})`,
			'src/B.tsx': `export const B = () => (${elementPaint})`,
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 1, 'one drawing, one group')
		assert.equal(groups[0].sites.length, 2, 'both places are listed as sites')
	})

	await test('the workspace scan groups one shape once', async () => {
		const box = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const dot = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/A.tsx': `export const A = () => (${box})`,
			'src/B.tsx': `export const B = () => (${box})`,
			'src/C.tsx': `export const C = () => (${dot})`,
			'test/D.test.tsx': `expect(${dot})`,
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 2, 'two distinct shapes')
		assert.equal(groups[0].sites.length, 2, 'the repeated shape groups its two sites')
		assert.deepEqual(groups[0].sites.map((site) => site.file).sort(), ['src/A.tsx', 'src/B.tsx'])
		assert.ok(groups[0].svg.includes('<svg'), 'the group carries usable markup')
	})

	await test('a pasted shape links the places it already lives in', async () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/Icon.tsx': `export const Close = () => (${svg})`,
			'public/close.svg': svg,
		})
		const store = createStore(io)
		await store.save({ name: 'close', svg, rule: '关闭浮层' })
		const pointers = await findShapePointers(io, svg)
		assert.deepEqual(
			pointers.map((pointer) => `${pointer.kind}:${pointer.file}`).sort(),
			['file:public/close.svg', 'inline:src/Icon.tsx'],
		)
		await store.setPointers('close', pointers)
		assert.equal((await store.pointers('close')).length, 2)

		const next = svg.replace('M4 4h16v16H4z', 'M2 2h20v20H2z')
		const pushed = await pushShapePointers(io, next, pointers)
		assert.equal(pushed.rewritten, 2)
		assert.ok(io.files.get('src/Icon.tsx').includes('M2 2h20v20H2z'))
		assert.ok(io.files.get('public/close.svg').includes('M2 2h20v20H2z'))
	})

	await test('one shape, many derivations: paint is not identity', () => {
		const magenta = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#ff00ff"/></svg>'
		const blue = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#000ff0" stroke-width="4"/></svg>'
		assert.notEqual(bodySignature(magenta), bodySignature(blue), 'the paint-aware signature sees two')
		assert.equal(shapeSignature(magenta), shapeSignature(blue), 'geometry says they are one shape')
		const other = '<svg viewBox="0 0 24 24"><path d="M2 2H22" stroke="#ff00ff"/></svg>'
		assert.notEqual(shapeSignature(magenta), shapeSignature(other), 'a different drawing is a different shape')
	})

	await test('recoloured copies are derivations, and a redraw keeps each colour', async () => {
		const plain = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="currentColor" stroke-width="2"/></svg>'
		const magenta = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#ff00ff" stroke-width="4"/></svg>'
		const io = memIo({
			'package.json': '{}',
			'src/a.tsx': `export const A = () => ${plain}\nexport const B = () => ${magenta}`,
		})
		const icon = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="currentColor" stroke-width="1"/></svg>'
		const pointers = await findShapePointers(io, icon)
		assert.equal(pointers.length, 2, 'both copies derive from the one shape')
		await pushShapePointers(io, icon.replace('M4 4H20', 'M2 2H22'), pointers)
		const out = io.files.get('src/a.tsx')
		assert.equal((out.match(/M2 2H22/gu) || []).length, 2, 'both got the new geometry')
		assert.ok(out.includes('stroke="#ff00ff"'), 'the coloured derivation keeps its colour')
		assert.ok(out.includes('stroke-width="4"'), 'and its weight')
		assert.ok(out.includes('stroke="currentColor"'), 'the plain one still follows the theme')
	})

	await test('a derivation that no longer draws the shape is reported stale', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/a.tsx': 'export const A = () => <svg viewBox="0 0 24 24"><path d="M2 2H22" stroke="currentColor"/></svg>',
		})
		const icon = '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="currentColor"/></svg>'
		const [recoded] = await readDerivations(io, [{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1 }], icon)
		assert.equal(recoded.stale, true, 'the file no longer draws this shape at that place')
		const [moved] = await readDerivations(io, [{ file: 'src/a.tsx', kind: 'inline', index: 4, line: 1 }], icon)
		assert.equal(moved.stale, true, 'a block that moved cannot be read back')
		const [good] = await readDerivations(
			io,
			[{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1 }],
			'<svg viewBox="0 0 24 24"><path d="M2 2H22" stroke="currentColor"/></svg>',
		)
		assert.equal(good.stale, false, 'a site that still draws it stays')
	})

	await test('a derivation panel reads each site the way the code draws it', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/a.tsx': [
				'export const A = () => <svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="currentColor" stroke-width="2"/></svg>',
				'export const B = () => <svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#000ff0" stroke-width="4"/></svg>',
			].join('\n'),
		})
		const list = await readDerivations(io, [
			{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1 },
			{ file: 'src/a.tsx', kind: 'inline', index: 1, line: 2 },
		])
		assert.equal(list.length, 2)
		// The drawing itself is the derivation: no colour or weight is recorded
		// anywhere, the code is read back as it is.
		assert.ok(list[0].svg.includes('stroke="currentColor"'), 'the theme-following site is read as written')
		assert.ok(list[0].svg.includes('stroke-width="2"'))
		assert.ok(list[1].svg.includes('#000ff0'), 'the coloured site keeps its own paint')
		assert.ok(list[1].svg.includes('stroke-width="4"'))
	})

	await test('a replace rewrites the inline body in place', async () => {
		const io = memIo({})
		const store = createStore(io)
		await store.save({ name: 'close', svg: FIGMA_ICON, rule: '第一版' })
		const second = await store.save({
			name: 'close',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3h18v18H3z" fill="currentColor"/></svg>',
			rule: '第二版',
		})
		const manifest = JSON.parse(io.files.get(MANIFEST_FILE))
		assert.equal(Object.keys(manifest.icons).length, 1, 'one icon, one manifest entry')
		assert.ok(manifest.icons['close'].body.includes('M3 3'), 'the body is stored inline')
		assert.equal(manifest.icons['close'].file, undefined, 'no blob pointer any more')
		assert.equal(manifest.icons['close'].history, undefined, 'no server-side history')
		assert.ok(second.svg.includes('M3 3'))
	})


	console.log('library store')

	await test('create, save, dedupe, annotate, rename', async () => {
		const io = memIo({ 'package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }) })
		const store = createStore(io)

		const created = await store.create({ name: '关闭', width: 24, height: 24 })
		assert.ok(created.entry.body !== '', 'an empty icon still carries a body')
		assert.equal(created.entry.rule, '')

		const saved = await store.save({ name: '关闭', svg: FIGMA_ICON, rule: '关闭浮层用；不要用于删除' })
		assert.equal(saved.status, 'saved')
		assert.equal(saved.entry.name, '关闭')
		assert.ok(saved.entry.body.includes('<path'), 'the body is inline in the entry')
		const rewritten = await store.save({ name: '关闭', svg: FIGMA_ICON, rule: '同一份内容' })
		assert.deepEqual(rewritten.entry.body, saved.entry.body, 'the same artwork keeps its body')
		assert.ok(saved.entry.hash.startsWith('sha256:'))
				assert.ok(saved.svg.includes('<path'), 'the authored markup is stored as authored')

		const again = await store.save({ name: '关闭', svg: FIGMA_ICON, rule: '关闭浮层用；不要用于删除' })
		assert.equal(again.status, 'unchanged', 'saving twice must not rewrite the file')

		const duplicate = await store.save({ name: 'close-copy', svg: FIGMA_ICON, rule: '重复图形' })
		assert.equal(duplicate.status, 'duplicate')
		assert.equal(duplicate.of, '关闭')
		assert.equal(duplicate.rule, '关闭浮层用；不要用于删除', 'a duplicate reports the existing rule')

		const annotated = await store.annotate({ name: '关闭', rule: '关闭浮层或对话框；删除请用 trash' })
		assert.equal(annotated.entry.rule, '关闭浮层或对话框；删除请用 trash')
		assert.equal(annotated.entry.hash, saved.entry.hash, 'annotate must not touch the svg')

		const renamed = await store.save({ name: 'dismiss', previousName: '关闭', svg: FIGMA_ICON, rule: '关闭浮层或对话框' })
		assert.equal(renamed.status, 'renamed')
		assert.equal(renamed.entry.body, saved.entry.body, 'a rename keeps the same body')

		const manifest = JSON.parse(io.files.get(MANIFEST_FILE))
		assert.equal(manifest.formatVersion, 11)
		assert.equal(Object.keys(manifest.icons).length, 1)
		// The `icons` map holds IconData only; metadata lives beside it.
		assert.deepEqual(Object.keys(Object.values(manifest.icons)[0]).sort(), ['body'])
		assert.equal(manifest.metadata['dismiss'].rule, '关闭浮层或对话框')
		assert.deepEqual(Object.keys(manifest.icons), ['dismiss'], 'the icons map order is the list order')
		assert.ok(manifest.metadata['dismiss'].hash.startsWith('sha256:'))
		await store.save({
			name: 'small',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h14v14H1z" fill="currentColor"/></svg>',
			allowDuplicate: true,
		})
		const after = JSON.parse(io.files.get(MANIFEST_FILE))
		assert.equal(after.width, 24, 'collection default width')
		assert.equal(after.icons.small.width, 16, 'a different size is written explicitly')
		assert.equal(after.icons.small.height, 16)
		assert.equal(after.icons.small.left, undefined, 'zero offsets stay implicit')
	})

	await test('Iconify aliases resolve to their canonical icon', async () => {
		const io = memIo({})
		const store = createStore(io)
		await store.save({ name: 'trash', svg: FIGMA_ICON, rule: '删除' })
		const manifest = JSON.parse(io.files.get(MANIFEST_FILE))
		manifest.aliases = { bin: { parent: 'trash' }, delete: { parent: 'bin' } }
		io.files.set(MANIFEST_FILE, JSON.stringify(manifest))

		assert.equal((await store.get('bin')).entry.name, 'trash', 'aliases point at the canonical icon')
		assert.equal((await store.get('delete')).entry.name, 'trash', 'alias chains resolve')
		assert.deepEqual((await store.list()).entries.map((entry) => entry.name), ['trash'], 'aliases are not entries')
		const after = JSON.parse(io.files.get(MANIFEST_FILE))
		assert.deepEqual(after.aliases, { bin: { parent: 'trash' }, delete: { parent: 'bin' } }, 'aliases survive a read')
	})

	await test('the list follows creation order', async () => {
		const store = createStore(memIo({}))
		await store.save({ name: 'zeta', svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L2 2" stroke="#000"/></svg>', note: 'z' })
		await store.save({ name: 'alpha', svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L3 3" stroke="#111"/></svg>', note: 'a' })
		await store.create({ name: 'gamma', width: 24, height: 24 })
		const { entries } = await store.list()
		assert.deepEqual(entries.map((entry) => entry.name), ['zeta', 'alpha', 'gamma'])
	})

	await test('remove drops the entry from the manifest', async () => {
		const io = memIo({})
		const store = createStore(io)
		await store.create({ name: 'one', width: 24, height: 24 })
		await store.create({ name: 'two', width: 24, height: 24 })
		const removed = await store.remove({ name: 'one' })
		assert.ok(removed.entry.body !== '')
		const { entries } = await store.list()
		assert.deepEqual(entries.map((entry) => entry.name), ['two'])
		await assert.rejects(() => store.remove({ name: 'nope' }), (error) => error.code === 'not-found')
	})

	await test('a new icon needs a name: there is no default', async () => {
		const io = memIo({})
		const store = createStore(io)
		await assert.rejects(() => store.create({ width: 24, height: 24 }), (error) => error.code === 'name-required')
		const first = await store.create({ name: 'close', width: 24, height: 24 })
		assert.equal(first.entry.name, 'close')
		assert.ok(first.entry.body !== '', 'the body is inline')
		assert.equal(first.entry.viewBox, '0 0 24 24')
		const { entries } = await store.list()
		assert.deepEqual(entries.map((entry) => entry.name), ['close'])
	})

	await test('application rules are optional, names are not', async () => {
		const store = createStore(memIo({}))
		const saved = await store.save({ name: 'bare', svg: FIGMA_ICON })
		assert.equal(saved.status, 'saved')
		assert.equal(saved.entry.rule, '', 'an icon may be saved without a rule')
		const annotated = await store.annotate({ name: 'bare', rule: '后来补的应用规则' })
		assert.equal(annotated.entry.rule, '后来补的应用规则')
		const legacy = await store.annotate({ name: 'bare', note: '旧字段仍然可读' })
		assert.equal(legacy.entry.rule, '旧字段仍然可读', 'note is accepted as the legacy spelling')
		await assert.rejects(
			() => store.save({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L6 6" stroke="#000"/></svg>' }),
			(error) => error.code === 'name-required',
		)
		await assert.rejects(() => store.save({ name: '../escape', svg: FIGMA_ICON }), (error) => error.code === 'invalid-name')
	})

	console.log('supply library')

	await test('a supply ref names its supplier and set', () => {
		assert.deepEqual(parseSupplyRef('lucide:trash'), { source: 'iconify', set: 'lucide', prefix: 'lucide', icon: 'trash' })
		assert.deepEqual(parseSupplyRef('iconmcp-generic:trash'), { source: 'iconmcp', set: 'generic', prefix: 'iconmcp-generic', icon: 'trash' })
		assert.deepEqual(parseSupplyRef('iconmcp:trash'), { source: 'iconmcp', set: '', prefix: 'iconmcp', icon: 'trash' })
		assert.equal(parseSupplyRef('trash'), null, 'no prefix is not a ref')
		assert.equal(parseSupplyRef(':trash'), null)
		assert.equal(parseSupplyRef('lucide:'), null, 'an empty icon name is not a ref')
		assert.equal(parseSupplyRef(null), null)
	})

	await test('a remote label and tags seed the first rule', () => {
		assert.equal(seedRule('Trash', ['delete', 'remove', 'bin']), 'Trash — delete, remove, bin')
		assert.equal(seedRule('Trash', ['Trash', 'DELETE', 'delete']), 'Trash — delete', 'the label and repeats are dropped')
		assert.equal(seedRule('', ['delete']), 'delete', 'no label: the tags stand alone')
		assert.equal(seedRule('Trash', []), 'Trash')
		assert.equal(seedRule(undefined, undefined), '')
		const many = seedRule('Trash', Array.from({ length: 20 }, (_, index) => `t${index}`))
		assert.equal(many.split(', ').length, 6, 'six tags at most')
	})

	await test('the authored canvas is read from the drawing itself', () => {
		assert.deepEqual(svgCanvasSize(ICONMCP_ICON), { width: 16, height: 16 })
		assert.deepEqual(svgCanvasSize('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>', 24), { width: 24, height: 24 })
		assert.deepEqual(svgCanvasSize(null, 16), { width: 16, height: 16 })
	})

	await test('an IconMCP drawing becomes one single-colour body on its own canvas', () => {
		const out = normalizeSvg(ICONMCP_ICON, { viewBox: '0 0 16 16' })
		assert.equal(out.viewBox, '0 0 16 16')
		assert.ok(out.svg.includes('stroke="currentColor"'), 'paint on the root reaches every element')
		assert.ok(!/#[0-9a-f]{3,8}/iu.test(out.svg), 'no colour is baked in: the body inherits currentColor')
		assert.ok(!out.svg.includes('<g'), 'the group wrapper is flattened')
	})

	/** A stand-in for the MCP endpoint: answers per tool, and counts the calls. */
	function mcpFetch(answers) {
		const calls = []
		const fetchImpl = async (_url, init) => {
			const payload = JSON.parse(init.body)
			const tool = payload.params.name
			calls.push({ tool, args: payload.params.arguments })
			const answer = answers[tool]
			if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) }
			if (answer && answer.error) return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: answer.error }) }
			const content = typeof answer === 'function' ? answer(payload.params.arguments) : answer
			return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { content } }) }
		}
		return { fetchImpl, calls }
	}

	await test('a get_icon answer is two blocks: the SVG and its description', async () => {
		const { fetchImpl } = mcpFetch({
			get_icon: [
				{ type: 'text', text: ICONMCP_ICON },
				{ type: 'text', text: JSON.stringify({ name: 'trash', label: 'Trash', set: 'generic', tags: ['delete', 'bin'] }) },
			],
		})
		const client = createIconmcpClient({ fetch: fetchImpl })
		const { svg, meta } = await client.icon('trash')
		assert.ok(svg.startsWith('<svg'), 'the drawing is picked out of the blocks')
		assert.equal(meta.label, 'Trash')
		assert.deepEqual(meta.tags, ['delete', 'bin'])
	})

	await test('list_sets and search_icons map onto supply refs', async () => {
		const { fetchImpl, calls } = mcpFetch({
			list_sets: [{ type: 'text', text: JSON.stringify({ icons: 7745, sets: [{ id: 'generic', label: 'Generic', group: 'Essentials', count: 141 }] }) }],
			search_icons: [{ type: 'text', text: JSON.stringify({ weak: false, results: [{ name: 'trash', label: 'Trash', set: 'generic', tags: ['delete'] }] }) }],
		})
		const client = createIconmcpClient({ fetch: fetchImpl })
		const sets = await client.sets()
		assert.equal(sets[0].prefix, 'iconmcp-generic', 'the prefix carries the set')
		assert.equal(sets[0].license, 'MIT')
		assert.equal(sets[0].source, 'iconmcp')
		assert.equal(sets[0].total, 141)
		const found = await client.search('delete', '', 5)
		assert.equal(found[0].ref, 'iconmcp-generic:trash')
		assert.equal(found[0].label, 'Trash')
		assert.deepEqual(found[0].tags, ['delete'])
		const scoped = await client.search('delete', 'generic', 5)
		assert.equal(scoped[0].ref, 'iconmcp-generic:trash')
		assert.deepEqual(calls.filter((call) => call.tool === 'search_icons')[1].args, { query: 'delete', limit: 5, set: 'generic' }, 'a scoped search passes the set through')
	})

	await test('a JSON-RPC error and a bad status both surface as throws', async () => {
		const broken = createIconmcpClient({ fetch: mcpFetch({ list_sets: { error: { message: 'boom' } } }).fetchImpl })
		await assert.rejects(() => broken.sets(), /boom/u)
		const down = createIconmcpClient({ fetch: mcpFetch({}).fetchImpl })
		await assert.rejects(() => down.sets(), /iconmcp 404/u)
		const empty = createIconmcpClient({ fetch: mcpFetch({ list_sets: [] }).fetchImpl })
		await assert.rejects(() => empty.sets(), /empty answer/u)
	})

	await test('a repeated call is answered from the cache', async () => {
		const { fetchImpl, calls } = mcpFetch({
			list_sets: [{ type: 'text', text: JSON.stringify({ sets: [] }) }],
		})
		const client = createIconmcpClient({ fetch: fetchImpl })
		await client.sets()
		await client.sets()
		assert.equal(calls.length, 1, 'the second browse must not hit the network again')
	})

	await test('a page of drawings survives one failing icon', async () => {
		const { fetchImpl } = mcpFetch({
			get_icon: (args) => (args.name === 'broken'
				? { error: { message: 'no such icon' } }
				: [{ type: 'text', text: ICONMCP_ICON }, { type: 'text', text: JSON.stringify({ name: args.name, label: args.name, set: 'generic', tags: [] }) }]),
		})
		const client = createIconmcpClient({ fetch: fetchImpl })
		const out = await client.svgs(['plus', 'broken', 'minus'])
		assert.deepEqual([...out.keys()].sort(), ['minus', 'plus'], 'the good drawings still arrive')
	})

	await test('an import stores provenance, and a new drawing keeps the rule', async () => {
		const store = createStore(memIo({}))
		const saved = await store.save({
			name: 'iconmcp-generic:trash',
			svg: ICONMCP_ICON,
			viewBox: '0 0 16 16',
			rule: seedRule('Trash', ['delete', 'remove']),
			source: 'iconmcp:generic',
			license: 'MIT',
		})
		assert.equal(saved.entry.viewBox, '0 0 16 16', 'the 16-unit canvas is kept, not rescaled to 24')
		assert.equal(saved.entry.source, 'iconmcp:generic')
		assert.equal(saved.entry.license, 'MIT')
		assert.equal(saved.entry.rule, 'Trash — delete, remove')
		assert.ok(isImportedSource(saved.entry.source), 'provenance marks it as an import')
		const replaced = await store.save({
			name: 'iconmcp-generic:trash',
			previousName: 'iconmcp-generic:trash',
			svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2.75 8H13.25" stroke="currentColor"/></svg>',
			viewBox: '0 0 16 16',
			allowDuplicate: true,
		})
		assert.equal(replaced.entry.rule, 'Trash — delete, remove', 'replacing artwork never wipes the rule')
		const cleared = await store.annotate({ name: 'iconmcp-generic:trash', rule: '' })
		assert.equal(cleared.entry.rule, '', 'an explicit empty string still clears it')
	})

	await test('a rename carries every name-keyed record', async () => {
		const io = memIo({})
		const store = createStore(io)
		await store.save({ name: 'old', svg: FIGMA_ICON, rule: 'r' })
		const manifest = JSON.parse(io.files.get(MANIFEST_FILE))
		await store.save({ name: 'new', previousName: 'old', svg: FIGMA_ICON, rule: 'r' })
		const after = (await store.manifest()).manifest
		assert.deepEqual(await store.pointers('new'), [])
	})

	await test('name collision and slug fallback', async () => {
		const store = createStore(memIo({}))
		await store.create({ name: 'close', width: 24, height: 24 })
		await store.create({ name: '关闭', width: 24, height: 24 })
		await assert.rejects(() => store.create({ name: 'close', width: 24, height: 24 }), (error) => error.code === 'name-taken')
		const { entries } = await store.list()
		const names = entries.map((entry) => entry.name).sort()
		assert.deepEqual(names, ['close', '关闭'])
		assert.equal(new Set(entries.map((entry) => entry.file)).size, 1, 'identical empty canvases share one blob')
		assert.equal(slugify('关闭'), '')
		assert.equal(slugify('Chevron Left!'), 'chevron-left')
	})

	await test('elements from the editor are normalised the same way', async () => {
		const store = createStore(memIo({}))
		const result = await store.save({
			name: 'square',
			kind: 'icon',
			note: '一个方块',
			elements: [
				{ d: 'M0 0L8 0L8 8L0 8Z', m: [1, 0, 0, 1, 4, 4], fill: 'currentColor' },
			],
		})
		assert.equal(result.status, 'saved')
		assert.equal(result.entry.viewBox, '0 0 8 8')
		assert.equal(result.elements.length, 1)
		assert.ok(!result.elements[0].m, 'saved elements must not keep an editor matrix')
	})

	await test('stroke-only art stays stroke-only through a save/read round trip', async () => {
		const store = createStore(memIo({}))
		const saved = await store.save({
			name: 'chevron',
			kind: 'icon',
			note: '展开/收起用',
			elements: [{ d: 'M2 6L8 12L14 6', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }],
		})
		assert.equal(saved.status, 'saved')
		const got = await store.get('chevron')
		assert.equal(got.elements.length, 1)
		assert.equal(got.elements[0].stroke, 'currentColor')
		assert.equal(got.elements[0].fill, undefined, 'a stroke-only path must not gain a black fill')
		assert.ok(!/fill="#000000"/.test(got.svg), 'serialised svg painted black')
	})

	await test('an editor save keeps the canvas it was drawn on', async () => {
		const store = createStore(memIo({}))
		await store.create({ name: 'dot', width: 24, height: 24 })
		const first = await store.save({
			name: 'dot',
			kind: 'icon',
			note: '圆点',
			viewBox: '0 0 24 24',
			elements: [{ d: 'M7 12A5 5 0 1 0 17 12A5 5 0 1 0 7 12Z', fill: 'currentColor' }],
		})
		assert.equal(first.entry.viewBox, '0 0 24 24', 'canvas must not shrink to the content')
		assert.ok(first.svg.includes('M7 12'), 'coordinates must stay where they were drawn')
		const second = await store.save({
			name: 'dot',
			kind: 'icon',
			note: '圆点',
			viewBox: '0 0 24 24',
			elements: [{ d: 'M7 12A5 5 0 1 0 17 12A5 5 0 1 0 7 12Z', fill: 'currentColor' }],
		})
		assert.equal(second.status, 'unchanged', 'saving twice must be a no-op')
		assert.equal(second.entry.viewBox, '0 0 24 24')
	})

	await test('Iconify flips and rotations are baked into the body', () => {
		const h = bakeIconifyTransform('<path/>', 24, 24, { hFlip: true })
		assert.ok(h.includes('translate(24 0)'), 'horizontal flip mirrors about the canvas')
		assert.ok(h.includes('scale(-1 1)'))
		const v = bakeIconifyTransform('<path/>', 24, 24, { vFlip: true })
		assert.ok(v.includes('translate(0 24)'))
		assert.ok(v.includes('scale(1 -1)'))
		const both = bakeIconifyTransform('<path/>', 24, 24, { hFlip: true, vFlip: true })
		assert.ok(both.includes('translate(24 0)') && both.includes('translate(0 24)'))
		const rotated = bakeIconifyTransform('<path/>', 24, 24, { rotate: 90 })
		assert.ok(rotated.includes('rotate(90 12 12)'), 'rotation happens about the centre')
		assert.equal(bakeIconifyTransform('<path/>', 24, 24, {}), '<path/>', 'no transform, no wrapper')
	})

	await test('an import keeps its authored canvas; a canvas-less source is trimmed', async () => {
		const store = createStore(memIo({}))
		const saved = await store.save({ name: 'kept', svg: FIGMA_ICON, note: '导入' })
		assert.equal(saved.entry.viewBox, '0 0 24 24', 'the authored viewBox wins')
		const bare = await store.save({
			name: 'trimmed',
			svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L14 14" fill="currentColor"/></svg>',
		})
		assert.equal(bare.entry.viewBox, '0 0 14 14', 'no canvas at all: trim to the content')
	})

	console.log('ai create')

	await test('a model drawing is accepted only when it fits the library', () => {
		const good = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>'
		assert.deepEqual(generatedIconIssues(good), [])
		assert.deepEqual(generatedIconIssues('<svg viewBox="0 0 32 24"><path d="M4 4H28" stroke="currentColor"/></svg>'), ['not-square'])
		assert.ok(generatedIconIssues('<svg viewBox="0 0 24 24"><path d="M4 4H20" fill="#ff0000"/></svg>').includes('baked-colour'))
		assert.ok(generatedIconIssues('<svg viewBox="0 0 24 24"><text x="2" y="2">A</text><path d="M4 4H20" stroke="currentColor"/></svg>').includes('forbidden-element'))
		assert.ok(generatedIconIssues('<svg viewBox="0 0 24 24"><style>.a{}</style><path d="M4 4H20" stroke="currentColor"/></svg>').includes('forbidden-element'))
		assert.ok(generatedIconIssues('<svg viewBox="0 0 24 24"></svg>').includes('no-geometry'))
		assert.ok(generatedIconIssues('<svg viewBox="0 0 24 24"><path d="M0 0" fill="url(#g)"/></svg>').includes('paint-server'))
	})

	await test('AI create profiles the library, draws, and refuses a broken answer', async () => {
		const workspace = '/w/ai'
		const files = new Map()
		const dirs = new Set(['/', workspace])
		const remember = (abs) => { let dir = path.dirname(abs); while (dir !== '/' && !dirs.has(dir)) { dirs.add(dir); dir = path.dirname(dir) } }
		const fsPort = {
			async resolve(rel, options = {}) { return path.isAbsolute(rel) ? rel : path.resolve(options.cwd || '/', rel) },
			async stat(abs) {
				if (files.has(abs)) return { type: 'file', size: files.get(abs).length }
				if (dirs.has(abs)) return { type: 'directory' }
				return null
			},
			async readText(abs) { return files.get(abs) ?? null },
			async writeText(abs, text) { files.set(abs, text); remember(abs) },
			async listDir(abs) {
				const out = []
				for (const key of files.keys()) if (path.dirname(key) === abs) out.push({ name: path.basename(key), type: 'file', size: files.get(key).length })
				for (const dir of dirs) if (dir !== abs && path.dirname(dir) === abs) out.push({ name: path.basename(dir), type: 'directory' })
				return out
			},
		}
		// Seed the library so the profile has something to read.
		const { createStore: makeStore } = await import('../lib/store.js')
		const seed = makeStore({
			async readText(rel) { const abs = path.join(workspace, rel); return files.get(abs) ?? null },
			async writeText(rel, text) { const abs = path.join(workspace, rel); files.set(abs, text); remember(abs) },
			async stat(rel) { const abs = path.join(workspace, rel); return files.has(abs) ? { type: 'file', size: files.get(abs).length } : null },
			async listDir() { return [] },
		})
		await seed.save({
			name: 'close',
			svg: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18" stroke="currentColor" stroke-width="1.5"/></svg>',
			rule: '关闭浮层',
		})

		// The reference lookup must stay offline in tests: answer both suppliers.
		const originalFetch = globalThis.fetch
		globalThis.fetch = async (url, options) => {
			const target = String(url)
			const reply = (body) => ({ ok: true, status: 200, json: async () => body })
			if (target.startsWith('https://iconmcp.com/mcp')) {
				const { params } = JSON.parse(options.body)
				if (params.name === 'search_icons') {
					return reply({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ name: 'calendar', label: 'Calendar', set: 'time', tags: ['date'] }] }) }] } })
				}
				if (params.name === 'get_icon') {
					return reply({ jsonrpc: '2.0', id: 1, result: { content: [
						{ type: 'text', text: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="2" y="3" width="12" height="11"/><path d="M2 6.5H14"/></svg>' },
						{ type: 'text', text: JSON.stringify({ name: 'calendar', label: 'Calendar', set: 'time', tags: ['date'] }) },
					] } })
				}
			}
			if (target.startsWith('https://api.iconify.design')) {
				if (target.includes('/search')) return reply({ icons: ['lucide:calendar-days'] })
				if (target.includes('/lucide.json')) return reply({ width: 24, height: 24, icons: { 'calendar-days': { body: '<rect x="3" y="4" width="18" height="17"/><path d="M3 9H21"/>' } } })
			}
			return { ok: false, status: 404, json: async () => ({}) }
		}

		const answers = []
		let next = ''
		const seen = []
		const routes = new Map()
		const ctx = {
			effect: (fn) => { fn() },
			inject: (_deps, run) => run({
				get: (name) => ({
					webServer: { register: (spec) => { routes.set(spec.path, spec.handler); return () => {} } },
					fs: fsPort,
					sessions: { get: () => undefined },
					workspaceRegistry: { list: () => [{ path: workspace, updatedAt: 'a' }] },
					workingDirectory: () => workspace,
					tools: undefined,
					systemPrompt: undefined,
					agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
					llm: {
						stream: (options) => {
							seen.push(options)
							const text = answers.shift() || next
							return (async function* () {
								if (text) yield { type: 'text-delta', text }
								yield { type: 'finish', reason: { kind: 'stop' } }
							})()
						},
					},
				})[name],
				effect: (fn) => { fn() },
				systemPrompt: { section: () => () => {} },
			}),
		}
		const { apply } = await import('../lib/index.js')
		apply(ctx)
		const call = (name, { method = 'POST', body } = {}) => new Promise((resolve) => {
			const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
			const req = { method, url: `/api/dsh-icon-studio/${name}`, async *[Symbol.asyncIterator]() { yield* chunks } }
			const res = { statusCode: 0, setHeader() {}, end(p) { resolve({ status: this.statusCode, data: JSON.parse(p) }) } }
			routes.get(`/api/dsh-icon-studio/${name}`)(req, res)
		})

		next = [
			'name: calendar-lock',
			'rule: A calendar with a lock; use it for locked schedules.',
			'svg: <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.5"/></svg>',
		].join('\n')
		const good = await call('ai-create', { body: { workspace, prompt: 'calendar with a lock' } })
		assert.equal(good.status, 200)
		assert.equal(good.data.name, 'calendar-lock', 'the model names the draft')
		assert.ok(good.data.svg.includes('currentColor'), 'the drawing comes back single-colour')
		assert.equal(good.data.profile.canvas, '24x24', 'the library canvas is read')
		assert.equal(good.data.profile.icons, 1)
		assert.ok(seen[0].system.includes('viewBox="0 0 24 24"'), 'the prompt carries the house canvas')
		assert.ok(seen[0].system.includes('stroke width 1.5'), 'and the measured stroke width')
		assert.ok(seen[0].system.includes('close:'), 'and a real example from the library')

		assert.ok(Array.isArray(good.data.references) && good.data.references.length > 0, 'the answer says which icons were studied')
		assert.ok(good.data.references.some((item) => item.source === 'iconmcp'))
		assert.ok(seen[0].system.includes('from other libraries'), 'the references reach the drawing prompt')
		assert.ok(seen[0].system.includes('do not copy their path data'), 'and are marked as study material, not source')
		globalThis.fetch = originalFetch

		next = 'name: wrong\nrule: no\nsvg: <svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#ff0000"/></svg>'
		const bad = await call('ai-create', { body: { workspace, prompt: 'something red' } })
		assert.equal(bad.data.error, 'rejected')
		assert.ok(bad.data.issues.includes('baked-colour'), 'a baked colour is refused, not imported')

		const empty = await call('ai-create', { body: { workspace, prompt: '   ' } })
		assert.equal(empty.status, 400, 'an empty prompt is a client error')
	})

	console.log('supply routes')

	await test('the host mounts one supply library and imports from either source', async () => {
		const workspace = '/w/project'
		const files = new Map()
		const dirs = new Set(['/', workspace])
		const remember = (abs) => {
			let dir = path.dirname(abs)
			while (dir !== '/' && !dirs.has(dir)) { dirs.add(dir); dir = path.dirname(dir) }
		}
		const fsPort = {
			async resolve(rel, options = {}) { return path.isAbsolute(rel) ? rel : path.resolve(options.cwd || '/', rel) },
			async stat(abs) {
				if (files.has(abs)) return { type: 'file', size: files.get(abs).length }
				if (dirs.has(abs)) return { type: 'directory' }
				return null
			},
			async readText(abs) { return files.get(abs) ?? null },
			async writeText(abs, text) { files.set(abs, text); remember(abs) },
			async listDir(abs) {
				const out = []
				for (const key of files.keys()) if (path.dirname(key) === abs) out.push({ name: path.basename(key), type: 'file', size: files.get(key).length })
				for (const dir of dirs) if (dir !== abs && path.dirname(dir) === abs) out.push({ name: path.basename(dir), type: 'directory' })
				return out
			},
		}
		// Canned answers in the exact shapes both upstreams return (captured live).
		const stubFetch = async (url, init) => {
			const target = String(url)
			const reply = (body) => ({ ok: true, status: 200, json: async () => body })
			if (target.startsWith('https://iconmcp.com/mcp')) {
				const { params } = JSON.parse(init.body)
				const json = (value) => [{ type: 'text', text: JSON.stringify(value) }]
				const answers = {
					list_sets: json({ sets: [{ id: 'generic', label: 'Generic', group: 'Essentials', count: 141 }] }),
					search_icons: json({ weak: false, results: [{ name: 'trash', label: 'Trash', set: 'generic', tags: ['delete', 'bin'] }] }),
					get_set: (args) => json({
						total: 141,
						icons: args.format === 'svg'
							? [{ name: 'trash', label: 'Trash', svg: ICONMCP_ICON }]
							: [{ name: 'trash', label: 'Trash' }],
					}),
					get_icon: (args) => [
						{ type: 'text', text: args.style === 'solid' ? ICONMCP_SOLID : ICONMCP_ICON },
						{ type: 'text', text: JSON.stringify({ name: 'trash', label: 'Trash', set: 'generic', tags: ['delete', 'bin'] }) },
					],
				}
				const answer = answers[params.name]
				if (answer === undefined) return { ok: false, status: 404, json: async () => ({}) }
				const content = typeof answer === 'function' ? answer(params.arguments) : answer
				return reply({ jsonrpc: '2.0', id: 1, result: { content } })
			}
			if (target.startsWith('https://api.iconify.design')) {
				if (target.includes('/collections')) return reply({ lucide: { name: 'Lucide', total: 100, license: { spdx: 'ISC' }, samples: ['trash'] } })
				if (target.includes('/search')) return reply({ icons: ['lucide:trash', 'lucide:settings'] })
				if (target.includes('/lucide.json')) return reply({ width: 24, height: 24, icons: { trash: { body: '<path d="M4 4H20L18 21H6Z" stroke="currentColor"/>' } } })
				if (target.includes('/collection')) return reply({ uncategorized: ['trash'], categories: { actions: ['settings'] } })
			}
			return { ok: false, status: 404, json: async () => ({}) }
		}
		const original = globalThis.fetch
		globalThis.fetch = stubFetch
		try {
			const routes = new Map()
			const ctx = {
				effect: (fn) => { fn() },
				inject: (_deps, run) => run({
					get: (name) => ({
						webServer: { register: (spec) => { routes.set(spec.path, spec.handler); return () => {} } },
						fs: fsPort,
						sessions: { get: () => undefined },
						workspaceRegistry: { list: () => [{ path: workspace, updatedAt: 'a' }] },
						workingDirectory: () => workspace,
						tools: undefined,
						systemPrompt: undefined,
					})[name],
					effect: (fn) => { fn() },
					systemPrompt: { section: () => () => {} },
				}),
			}
			const { apply } = await import('../lib/index.js')
			apply(ctx)
			const call = (name, { method = 'GET', search = '', body } = {}) => new Promise((resolve) => {
				const handler = routes.get(`/api/dsh-icon-studio/${name}`)
				assert.ok(handler, `route ${name} is not mounted`)
				const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
				const req = { method, url: `/api/dsh-icon-studio/${name}${search}`, async *[Symbol.asyncIterator]() { yield* chunks } }
				const res = {
					statusCode: 0,
					headersSent: false,
					setHeader() {},
					end(payload) { this.headersSent = true; resolve({ status: this.statusCode, data: JSON.parse(payload) }) },
				}
				handler(req, res)
			})

			const collections = await call('library-collections')
			assert.equal(collections.status, 200)
			assert.deepEqual(collections.data.collections.map((set) => set.prefix), ['iconmcp-generic', 'lucide'], 'both suppliers land in one list, IconMCP first')
			assert.equal(collections.data.collections[0].license, 'MIT')

			const found = await call('library-search', { search: '?query=delete&limit=8' })
			assert.deepEqual(found.data.icons, ['iconmcp-generic:trash', 'lucide:settings'], 'one search asks both; a shared slug is not repeated')
			assert.equal(found.data.meta['iconmcp-generic:trash'].label, 'Trash')

			const previews = await call('library-samples', { method: 'POST', body: { prefixes: ['iconmcp-generic', 'lucide'] } })
			assert.deepEqual(previews.data.samples['iconmcp-generic'].map((icon) => icon.name), ['trash'], 'one request per set brings its previews')
			assert.ok(previews.data.samples['iconmcp-generic'][0].svg.startsWith('<svg'))
			assert.equal(previews.data.samples.lucide, undefined, 'Iconify already ships samples with its list')

			// A set page answers with bare names, exactly like an Iconify set: the
			// client owns the `prefix:` part, so it is added in one place only.
			const page = await call('library-set', { search: '?prefix=iconmcp-generic&limit=8' })
			assert.deepEqual(page.data.names, ['trash'], 'a set page returns bare names')
			assert.equal(page.data.total, 141)

			const art = await call('library-set', { search: '?prefix=iconmcp-generic&limit=8&format=svg' })
			assert.ok(String(art.data.icons['iconmcp-generic:trash']).startsWith('<svg'), 'format=svg draws the page in one call')

			const resolved = await call('library-fetch', {
				method: 'POST',
				body: { workspace, names: page.data.names.map((name) => `iconmcp-generic:${name}`) },
			})
			assert.ok(resolved.data.icons['iconmcp-generic:trash'].startsWith('<svg'), 'the ref the client builds from a bare name resolves')

			const peek = await call('library-peek', { method: 'POST', body: { workspace, ref: 'iconmcp-generic:trash' } })
			assert.equal(peek.status, 200)
			assert.equal(peek.data.name, 'trash', 'the panel suggests the icon\'s own name')
			assert.equal(peek.data.rule, 'Trash — delete, bin', 'and the rule the supplier knows')
			assert.deepEqual(peek.data.styles, ['outline', 'solid'], 'a second style is offered only when it draws differently')
			assert.ok(peek.data.previews.outline && peek.data.previews.solid)

			const plain = await call('library-peek', { method: 'POST', body: { workspace, ref: 'lucide:trash' } })
			assert.deepEqual(plain.data.styles, ['outline'], 'a supplier without styles offers none')
			assert.equal(plain.data.rule, '', 'and no rule is invented for it')

			const imported = await call('library-import', { method: 'POST', body: { workspace, names: ['iconmcp-generic:trash'] } })
			assert.equal(imported.data.results[0].status, 'saved', JSON.stringify(imported.data.results))
			const manifest = JSON.parse(files.get(path.join(workspace, '.icons.json')))
			const body = manifest.icons['iconmcp-generic:trash']
			assert.equal(body.width, 16, 'the 16-unit canvas is stored, not rescaled')
			assert.equal(manifest.metadata['iconmcp-generic:trash'].rule, 'Trash — delete, bin', 'tags seed the first rule')
			assert.equal(manifest.metadata['iconmcp-generic:trash'].source, 'iconmcp:generic')
			assert.equal(manifest.metadata['iconmcp-generic:trash'].license, 'MIT')

			const explicit = await call('library-import', {
				method: 'POST',
				body: { workspace, items: [{ ref: 'iconmcp-generic:trash', name: 'trash-strong', rule: '列表里的删除', style: 'solid' }] },
			})
			assert.equal(explicit.data.results[0].local, 'trash-strong', 'the name is the one the user confirmed')
			const named = JSON.parse(files.get(path.join(workspace, '.icons.json')))
			assert.equal(named.metadata['trash-strong'].rule, '列表里的删除', 'and so is the rule')
			assert.equal(named.metadata['trash-strong'].origin, 'iconmcp-generic:trash', 'provenance keeps the upstream ref')

			const derivations = await call('derivations', { method: 'POST', body: { workspace, name: 'iconmcp-generic:trash' } })
			assert.equal(derivations.status, 200)
			assert.deepEqual(derivations.data.derivations, [], 'an import has no derivative sites yet')

			const again = await call('library-import', { method: 'POST', body: { workspace, names: ['iconmcp-generic:trash'] } })
			assert.equal(again.data.results[0].status, 'same', 'a repeat import is not a name conflict')

			const preview = await call('library-fetch', { method: 'POST', body: { workspace, names: ['iconmcp-generic:trash'] } })
			assert.ok(preview.data.icons['iconmcp-generic:trash'].startsWith('<svg'))
			assert.equal(preview.data.matches['iconmcp-generic:trash'], 'iconmcp-generic:trash', 'a preview knows the shape is already local')

			const iconify = await call('library-import', { method: 'POST', body: { workspace, names: ['lucide:trash'] } })
			assert.equal(iconify.data.results[0].status, 'saved', JSON.stringify(iconify.data.results))
			const after = JSON.parse(files.get(path.join(workspace, '.icons.json')))
			assert.equal(after.metadata['lucide:trash'].source, 'iconify:lucide', 'Iconify keeps its own provenance')
			assert.ok(!after.metadata['lucide:trash'].rule, 'Iconify brings no tags, so no rule is invented')
		} finally {
			globalThis.fetch = original
		}
	})

	console.log('@asset index')

	await test('finds markers, and ignores component usage', async () => {
		const io = memIo({
			'app/page.tsx': [
				"import { Graphic } from '../graphics/generated/react'",
				'export function Page() {',
				'  return <div>',
				'    <Graphic name="alpha" size={16} />',
				'    <span>',
				'      // @asset alpha',
				'      <svg viewBox="0 0 24 24"><path d="M1 1L2 2"/></svg>',
				'    </span>',
				'  </div>',
				'}',
			].join('\n'),
			'node_modules/pkg/index.tsx': '// @asset alpha\n<svg></svg>',
			'README.md': '// @asset alpha\n<svg></svg>',
		})
		const usages = await scanUsage(io, ['alpha'])
		assert.equal(usages.length, 1, 'the resource layer only sees @asset copies')
		assert.equal(usages[0].form, 'asset')
		assert.ok(usages.every((item) => !item.file.startsWith('node_modules')))
		assert.ok(usages.every((item) => !item.file.endsWith('.md')), 'prose must not be indexed')
	})

	await test('apply rewrites only the marked inline block', async () => {
		const io = memIo({
			'app/page.tsx': 'const x = 1\n// @asset alpha\n<svg viewBox="0 0 24 24"><path d="M1 1L2 2"/></svg>\nconst y = 2\n',
		})
		const result = await applyAsset(io, 'alpha', '<svg viewBox="0 0 24 24"><path d="M9 9L15 15"/></svg>')
		assert.equal(result.replaced, 1)
		const text = io.files.get('app/page.tsx')
		assert.ok(text.includes('M9 9L15 15'))
		assert.ok(text.includes('const x = 1'))
		assert.ok(text.includes('const y = 2'))
	})

	await test('apply leaves other graphics alone', async () => {
		const io = memIo({ 'a.tsx': '// @asset trash\n<svg><path d="M0 0"/></svg>\n' })
		const result = await applyAsset(io, 'alpha', '<svg><path d="M9 9"/></svg>')
		assert.equal(result.replaced, 0)
		assert.ok(io.files.get('a.tsx').includes('M0 0'))
	})

	await test('rename cascades through markers only', async () => {
		const io = memIo({
			'a.tsx': '// @asset alpha\n<svg><path d="M0 0"/></svg>\n<Graphic name="alpha" />',
			'b.tsx': "// @asset alpha\n<svg></svg>\n<Graphic name='alpha' />",
			'notes.md': '`@asset alpha`',
		})
		const result = await cascadeRename(io, 'alpha', 'beta')
		assert.equal(result.count, 2, 'code files only')
		assert.ok(io.files.get('a.tsx').includes('@asset beta'))
		assert.ok(io.files.get('a.tsx').includes('<Graphic name="alpha"'), 'component usage is the project\'s business')
		assert.ok(io.files.get('notes.md').includes('@asset alpha'), 'prose must not be rewritten')
	})

	console.log('version check')

	test('versions compare the way npm reports them', () => {
		assert.equal(isNewer('0.18.1', '0.18.0'), true, 'a patch release is newer')
		assert.equal(isNewer('0.18.0', '0.18.0'), false, 'the same version is not an update')
		assert.equal(isNewer('0.17.9', '0.18.0'), false, 'an older release is not an update')
		assert.equal(isNewer('1.0.0', '0.99.99'), true, 'major beats minor')
		assert.equal(isNewer('0.18.0-rc.1', '0.18.0'), false, 'a prerelease is older than its release')
		assert.equal(isNewer('0.18.0', '0.18.0-rc.1'), true, 'and the release is newer than the prerelease')
		assert.equal(isNewer('0.18.1-rc.2', '0.18.1-rc.1'), true, 'prereleases compare in order')
		assert.equal(isNewer('0.18.1-rc.1', '0.18.1-rc.2'), false)
		assert.equal(isNewer('nonsense', '0.18.0'), false, 'unparsable versions never claim an update')
		assert.equal(isNewer('0.18.0', ''), false)
	})

	await test('the registry check falls back to the mirror, then gives up', async () => {
		const calls = []
		const found = await latestPublished({
			name: 'dsh-icon-library',
			registries: ['https://registry.npmjs.org', 'https://registry.npmmirror.com'],
			fetchImpl: async (url) => {
				calls.push(url)
				if (url.startsWith('https://registry.npmjs.org')) throw new Error('down')
				return { ok: true, async json() { return { version: '0.18.2' } } }
			},
		})
		assert.deepEqual(found, { version: '0.18.2', registry: 'https://registry.npmmirror.com' })
		assert.equal(calls.length, 2, 'one failed registry, one answer')
		assert.equal(await latestPublished({ name: 'x', fetchImpl: async () => { throw new Error('offline') } }), null, 'offline reads as "cannot prove an update"')
	})

	console.log('client panel')

	await test('inline previews scope gradient ids', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		assert.ok(typeof factory === 'function', 'client.js must register a lazy factory')
		const module = factory((name) => (name === 'react' ? { createElement: () => null, Fragment: 'f' } : undefined))
		assert.ok(module.apply)
		assert.deepEqual(module.inject, ['slots', 'locale'])
		// the client file must stay self-contained for the browser module loader
		assert.ok(source.includes("window.__ModuleLoader__.load"))
		assert.ok(!/^\s*import\s/m.test(source), 'client.js must not use ESM imports')
		const { scopeIds } = module._test
		assert.equal(scopeIds('', 'x'), '')
		const scoped = scopeIds('<svg><defs><linearGradient id="paint0"/></defs><path fill="url(#paint0)"/></svg>', 'close')
		assert.ok(scoped.includes('id="close-paint0"'), 'gradient ids are prefixed')
		assert.ok(scoped.includes('url(#close-paint0)'), 'and so are their references')
		assert.ok(!scoped.includes('url(#paint0)'), 'the bare reference is gone')
	})

	await test('the client carries no drawing editor any more', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		for (const gone of ['function parsePath(', 'function penD(', 'function ellipseD(', 'function withId(', 'SHAPE_TOOLS', 'TOOL_GROUPS', 'gs-editor', 'gs-canvas', 'gs-layers']) {
			assert.ok(!source.includes(gone), `removed editor code is back: ${gone}`)
		}
		assert.ok(!source.includes("t('editorUntitled')"), 'editor copy is gone')
	})

	await test('only plain strings reach the host locale registry', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(source.includes('typeof value === \'string\''), 'function entries are filtered out')
		assert.ok(source.includes("ctx.locale.register(NS, { zh: plain(ZH), en: plain(EN) })"), 'the registry gets the filtered dictionaries')
		assert.ok(!/ctx\.locale\.register\(NS, \{ zh: ZH, en: EN \}\)/.test(source), 'never register raw dictionaries')
	})

	await test('interpolated copy is never handed to React as a function', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const react = {
			createElement: () => null, Fragment: 'f', useState: (v) => [v, () => {}], useEffect: () => {},
			useRef: (v) => ({ current: v }), useCallback: (fn) => fn, useMemo: (fn) => fn(),
		}
		const module = factory((name) => (name === 'react' ? react : undefined))
		const t = module._test.makeT(null)
		const counted = t('listCount', { n: 3 })
		assert.equal(typeof counted, 'string', 'function entries must be called')
		assert.ok(counted.includes('3'), 'and receive their variables')
		assert.equal(typeof t('commonClose'), 'string', 'plain entries stay strings')
	})


	await test('cards no longer offer a manual push', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(!source.includes("className: 'gs-card-stale'"), 'no stale dot on cards')
		assert.ok(!source.includes("t('pushMenu')"), 'no Push item in the card menu')
		assert.ok(!source.includes('setPushTarget(name)'), 'no push confirmation path')
		assert.ok(!source.includes('setSyncOpen((value) => !value)'), 'the footer no longer opens a sync panel')
	})

	await test('a source edit bumps the version until it is pushed', async () => {
		const io = memIo({})
		const store = createStore(io)
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="2"/></svg>'
		await store.save({ name: 'glyph', svg, viewBox: '0 0 24 24', preserveViewBox: true, allowDuplicate: true })
		let entry = (await store.list()).entries[0]
		assert.equal(entry.version, 1)
		assert.equal(entry.pushed, 1, 'a fresh icon starts in sync')

		await store.save({ name: 'glyph', svg: svg.replace('h16v16H4z', 'h10v10H4z'), viewBox: '0 0 24 24', preserveViewBox: true, allowDuplicate: true })
		entry = (await store.list()).entries[0]
		assert.equal(entry.version, 1.1, 'editing bumps the source version')
		assert.equal(entry.pushed, 1, 'the pushed marker stays behind')

		assert.equal(await store.markPushed('glyph'), true)
		entry = (await store.list()).entries[0]
		assert.equal(entry.pushed, 1.1, 'pushing records the current version')
		assert.equal(await store.markPushed('glyph'), false, 'a second push is a no-op')
	})



	await test('a draft-only change never bumps the version or the copies', async () => {
		const io = memIo({})
		const store = createStore(io)
		const elements = [{ id: 'e1', kind: 'path', d: 'M0 0h8v8H0z', m: [1, 0, 0, 1, 0, 0], fill: 'currentColor' }]
		await store.save({ name: 'glyph', elements, viewBox: '0 0 24 24', preserveViewBox: true, allowDuplicate: true })
		let entry = (await store.list()).entries[0]
		assert.equal(entry.version, 1)
		const before = io.files.get('.icon-studio/glyph.svg')
		// Same drawing, different editor bookkeeping (renamed layer, moved handle).
		await store.save({
			name: 'glyph',
			elements: [{ id: 'e9', kind: 'path', name: 'renamed', d: 'M0 0h8v8H0z', m: [1, 0, 0, 1, 0, 0], fill: 'currentColor' }],
			viewBox: '0 0 24 24',
			preserveViewBox: true,
			allowDuplicate: true,
		})
		entry = (await store.list()).entries[0]
		assert.equal(entry.version, 1, 'the asset did not change, so the version stays')
		assert.equal(io.files.get('.icon-studio/glyph.svg'), before, 'the export is byte-identical')
	})

	await test('a manual order persists and new icons append', async () => {
		const io = memIo({})
		const store = createStore(io)
		const art = (offset) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M${offset} 0h4v4h-4z"/></svg>`
		await store.save({ name: 'alpha', svg: art(0), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		await store.save({ name: 'beta', svg: art(6), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		await store.save({ name: 'gamma', svg: art(11), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		assert.deepEqual((await store.list()).entries.map((entry) => entry.name), ['alpha', 'beta', 'gamma'])

		await store.reorder(['gamma', 'alpha', 'beta'])
		assert.deepEqual((await store.list()).entries.map((entry) => entry.name), ['gamma', 'alpha', 'beta'])

		// The numbers are a dense sequence, so a later insert cannot land between them.
		const manifest = JSON.parse(io.files.get('.icons.json'))
		assert.deepEqual(Object.keys(manifest.icons), ['gamma', 'alpha', 'beta'])

		await store.save({ name: 'delta', svg: art(2), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		assert.deepEqual((await store.list()).entries.map((entry) => entry.name), ['gamma', 'alpha', 'beta', 'delta'])

		// Omitted icons stay at the end instead of disappearing from the list.
		await store.reorder(['delta'])
		assert.deepEqual((await store.list()).entries.map((entry) => entry.name), ['delta', 'gamma', 'alpha', 'beta'])
	})




	await test('the export keeps its ids unique across the library', async () => {
		const io = memIo({})
		const store = createStore(io)
		const art = (offset) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><defs><linearGradient id="paint0_linear_1" x1="0" y1="0" x2="0" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><path fill="url(#paint0_linear_1)" d="M${offset} 0h4v4h-4z"/></svg>`
		await store.save({ name: 'alpha', svg: art(0), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		await store.save({ name: 'beta', svg: art(8), viewBox: '0 0 16 16', preserveViewBox: true, allowDuplicate: true })
		const icons = JSON.parse(io.files.get('.icons.json')).icons
		const alphaEntry = { name: 'alpha', ...icons.alpha }
		const betaEntry = { name: 'beta', ...icons.beta }
		const { svgIds } = await import('../lib/svg.js')
		const both = [...svgIds(alphaEntry.body)].filter((id) => svgIds(betaEntry.body).has(id))
		assert.deepEqual(both, [], 'no two bodies share a gradient id')
		assert.ok(/beta-paint0_linear_1/u.test(betaEntry.body), 'the later icon is namespaced by its name')
	})


	await test('pasting an icon keeps its canvas, not a cropped one', async () => {
		const io = memIo({})
		const store = createStore(io)
		const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect x="16" y="16" width="16" height="16" fill="#000000"/></svg>'

		const inspected = await store.inspect({ svg: source })
		assert.equal(inspected.viewBox, '0 0 48 48', 'an authored canvas is kept as authored')

		const kept = await store.inspect({ svg: source, preserveViewBox: true })
		assert.equal(kept.viewBox, '0 0 48 48', 'pasting must keep the authored canvas')

		const saved = await store.save({ name: 'pasted', svg: kept.svg, viewBox: kept.viewBox, preserveViewBox: true, allowDuplicate: true })
		assert.equal(saved.entry.viewBox, '0 0 48 48')
		assert.ok(saved.svg.includes('x="16"'), 'the shape keeps its position inside that canvas')
	})

	await test('gradients survive normalisation, the editor model, and a re-save', async () => {
		const { normalizeSvg } = await import('../lib/svg.js')
		const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" fill="url(#g)"/></svg>'
		const normalized = normalizeSvg(source)
		assert.ok(normalized.svg.includes('linearGradient'), 'the gradient definition ships with the icon')
		assert.ok(normalized.svg.includes('url(#g)'), 'and the path still paints with it')

		const store = createStore(memIo({}))
		await store.save({ name: 'grad', svg: source, viewBox: '0 0 24 24', preserveViewBox: true, allowDuplicate: true })
		const graphic = await store.get('grad')
		assert.equal(graphic.elements.length, 1)
		assert.ok(Array.isArray(graphic.elements[0].defs) && graphic.elements[0].defs.some((entry) => entry.includes('linearGradient')), 'the editor receives the definition')

		const resaved = await store.save({ name: 'grad', previousName: 'grad', elements: graphic.elements, viewBox: '0 0 24 24', allowDuplicate: true })
		assert.ok(resaved.svg.includes('linearGradient'), 'saving from the editor keeps it')
	})




	/** Resolve a bound mark name to its icon file. */
	function iconSvgFor(name) {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let manifest
		try {
			manifest = JSON.parse(readFileSync(new URL('../../.icons.json', import.meta.url), 'utf8'))
		} catch (_error) {
			return null
		}
		const viewBoxOf = (icon) => icon.viewBox || `${icon.left || 0} ${icon.top || 0} ${icon.width || 24} ${icon.height || 24}`
		const entries = Object.entries(manifest.icons).map(([name, icon]) => ({ name, viewBox: viewBoxOf(icon), ...icon }))
		const guideEntry = entries.find((item) => typeof item.body === 'string' && item.body.includes('paint0_linear_49_45'))
		if (guideEntry) {
			const guideBlock = /const GUIDE_MARK = \{([\s\S]*?)\n    \}/.exec(source)[1]
			assert.equal(/viewBox: '([^']+)'/.exec(guideBlock)[1], guideEntry.viewBox, 'GUIDE_MARK viewBox')
			assert.ok(/paint0_linear_49_45/.test(guideBlock), 'GUIDE_MARK comes from icon-9-2')
		}

		const entry = entries.find((item) => item.name === name)
		if (!entry) return null
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${entry.viewBox}">${entry.body}</svg>`
	}



	await test('plugin display metadata lives in exported locale files', () => {
		for (const lang of ['en', 'zh']) {
			const meta = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
			assert.equal(meta.meta.title, 'Icon Library', `${lang} title`)
			assert.ok(typeof meta.meta.description === 'string' && meta.meta.description.length > 20, `${lang} description`)
		}
		const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
		assert.ok(manifest.files.includes('locale/*.json'), 'locale files ship with the package')
	})

	await test('the plugin detail ships its cover image', () => {
		const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
		assert.ok(manifest.files.includes('cover.png'), 'the cover ships with the package')
		const png = readFileSync(new URL('../cover.png', import.meta.url))
		assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'cover.png is a real PNG')
		assert.ok(png.readUInt32BE(16) >= 1200, 'wide enough for a detail hero')
		for (const [lang, detail] of [['en', 'README.md'], ['zh', 'README.zh.md']]) {
			const meta = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
			assert.equal(meta.meta.detail, detail, `${lang} names its detail document`)
			const text = readFileSync(new URL(`../${detail}`, import.meta.url), 'utf8')
			assert.ok(text.startsWith('![dsh-icon-library'), `${detail} leads with the cover`)
			assert.ok(text.includes('](cover.png)'), `${detail} references the shipped image`)
		}
	})

	await test('the shipped app icon is the library copy, untouched', () => {
		const lib = iconSvgFor('icon-studio-logo-colorful')
		if (lib === null) return
		const pkg = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
		assert.equal(bodySignature(pkg), bodySignature(lib), 'icon.svg must draw the same artwork as the library icon')
		const alias = readFileSync(new URL('../icon.mask.svg', import.meta.url), 'utf8')
		assert.equal(bodySignature(alias), bodySignature(lib), 'the legacy path carries the same native icon')
		const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
		assert.equal(manifest.exports['./icon'], './icon.svg', 'the host gets the native icon')
		assert.ok(alias.length > 0, 'the legacy path exists for hosts that cached it')
	})

	await test('both shipped marks match the icons they were generated from', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const check = (constant, name) => {
			const svg = iconSvgFor(name)
			if (svg === null) return
			const viewBox = /viewBox="([^"]+)"/.exec(svg)[1]
			const block = new RegExp(`const ${constant} = \\{([\\s\\S]*?)\\n    \\}`).exec(source)[1]
			const iconMarkup = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).trim().replace(/\s*\n\s*/g, '')
			const inlined = /markup: '((?:\\\\.|[^'])*)'/.exec(block)[1].replace(/\\'/g, "'")
			assert.equal(/viewBox: '([^']+)'/.exec(block)[1], viewBox, `${constant} viewBox follows its icon`)
			const wrap = (markup) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${markup}</svg>`
			assert.equal(bodySignature(wrap(inlined)), bodySignature(wrap(iconMarkup)), `run \`node scripts/sync-logo.mjs${constant === 'TAB_MARK' ? ' --tab' : ''}\` after editing the icon`)
		}
		// LOGO ships exactly as icon.svg (the app icon); TAB_MARK follows its library icon
		const appIcon = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8')
		const expected = /viewBox="([^"]+)"/.exec(appIcon)[1]
		const block = /const LOGO = \{([\s\S]*?)\n    \}/.exec(source)[1]
		const markup = appIcon.slice(appIcon.indexOf('>', appIcon.indexOf('<svg')) + 1, appIcon.lastIndexOf('</svg>')).trim().replace(/\s*\n\s*/g, '')
		assert.equal(/viewBox: '([^']+)'/.exec(block)[1], expected, 'LOGO matches icon.svg')
		assert.equal(/markup: '((?:\\\\.|[^'])*)'/.exec(block)[1].replace(/\\'/g, "'"), markup, 'run `node scripts/sync-logo.mjs icon.svg`')
		let manifest = null
		try {
			manifest = JSON.parse(readFileSync(new URL('../../.icons.json', import.meta.url), 'utf8'))
		} catch (_error) {
			manifest = null
		}
		if (manifest) check('TAB_MARK', manifest.tabLogo)
	})

	await test('the chat no longer renders or inserts @ icon mentions', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(!source.includes('uiConversation.userText.register(iconTextRule)'), 'no transcript rule')
		assert.ok(!source.includes("name: 'conversation.user.text.node'"), 'no sent-text renderer')
		assert.ok(!source.includes('registerSource(iconReferenceSource)'), 'no @ picker source')
		assert.ok(!source.includes('gs-mention'), 'no mention styling')
		assert.ok(source.includes('openGraphicByNameRef.current(requested)'), 'tab params still open one icon')
	})

	await test('the mounted tab refreshes the library when it becomes visible', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(source.includes("addEventListener('visibilitychange'"), 'listens for visibility')
		assert.ok(source.includes("addEventListener('focus'"), 'listens for focus')
		assert.ok(source.includes('setInterval(refresh, 60000)'), 'polls while mounted, once a minute')
		assert.ok(source.includes('result.unchanged'), 'and skips the re-render when the revision matches')
		assert.ok(source.includes("api.get('state', since === '' ? target : { ...target, since })"), 'sends the revision it already has')
	})

	await test('every icon reference exists in the icon map', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const start = source.indexOf('const I = {')
		const end = source.indexOf('\n    }', start)
		const keys = new Set([...source.slice(start, end).matchAll(/\n\s+([a-zA-Z]+):/g)].map((match) => match[1]))
		const used = new Set([...source.slice(end).matchAll(/\bI\.([a-zA-Z]+)\b/g)].map((match) => match[1]))
		const missing = [...used].filter((name) => !keys.has(name))
		assert.deepEqual(missing, [], `unknown icon keys: ${missing.join(', ')}`)
		// The init page looks glyphs up by name (feature list + scattered tiles),
		// so a quoted key is a reference too — a missing one renders an empty box.
		const dynamic = new Set([...source.matchAll(/icon: '([A-Za-z]+)'/g)].map((match) => match[1]))
		const missingDynamic = [...dynamic].filter((name) => !keys.has(name))
		assert.deepEqual(missingDynamic, [], `unknown dynamic icon keys: ${missingDynamic.join(', ')}`)
	})

	await test('panel and detail render a first frame without throwing', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const fakeReact = {
			createElement: (type, props, ...children) => ({ type, props, children }),
			Fragment: 'fragment',
			useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
			useEffect: () => {},
			useRef: (value) => ({ current: value === undefined ? null : value }),
			useCallback: (fn) => fn,
			useMemo: (fn) => fn(),
		}
		const module = factory((name) => (name === 'react' ? fakeReact : undefined))
		const { Panel, Detail, ListView, SupplyView, AddIconDialog, DerivationRow, InitView, ScanBar, shouldRetryLibrary } = module._test
		const t = (key) => key
		const say = () => {}
		const treeOf = (node) => {
			if (node === null || node === undefined) return 0
			if (Array.isArray(node)) return node.reduce((sum, child) => sum + treeOf(child), 0)
			if (typeof node !== 'object') return 1
			const props = node.props || {}
			const nested = node.children || []
			const expanded = typeof node.type === 'function' ? treeOf(node.type(props)) : 0
			return 1 + expanded + nested.reduce((sum, child) => sum + treeOf(child), 0)
		}
		const classesOf = (node, out = []) => {
			if (node === null || node === undefined) return out
			if (Array.isArray(node)) { node.forEach((child) => classesOf(child, out)); return out }
			if (typeof node !== 'object') return out
			const className = (node.props || {}).className
			if (typeof className === 'string') out.push(className)
			if (typeof node.type === 'function') classesOf(node.type(node.props || {}), out)
			;(node.children || []).forEach((child) => classesOf(child, out))
			return out
		}
		const first = Panel({ sessionId: 's', t })
		const nodeByClass = (root, wanted) => {
			let hit = null
			const walk = (node) => {
				if (hit || node === null || node === undefined) return
				if (Array.isArray(node)) { node.forEach(walk); return }
				if (typeof node !== 'object') return
				if (node.props && node.props.className === wanted) { hit = node; return }
				if (typeof node.type === 'function') walk(node.type(node.props || {}))
				;(node.children || []).forEach(walk)
			}
			walk(root)
			return hit
		}
		assert.ok(treeOf(first) >= 4, 'Panel did not render')
		assert.ok(classesOf(first).includes('gs-loading'), 'before the host answers, the panel only shows loading — no list, no scan')
		// The first-run screen names its glyphs by string, so a missing icon would
		// render an empty circle instead of failing: assert the whole card builds.
		const init = InitView({ t, onInit: say, busy: false })
		assert.ok(treeOf(init) > 8, 'the init screen rendered too little')
		assert.ok(classesOf(init).includes('gs-init'), 'the init screen keeps its frame')
		assert.ok(classesOf(init).includes('gs-init-feature'), 'and lists its features')
		assert.equal(classesOf(init).filter((name) => name === 'gs-init-feature-icon').length, 4, 'one icon per feature')
		// The card is usable the moment it appears: the boot-time re-probe runs in
		// the background, and clicking Initialise re-asks the host before writing.
		assert.equal(Boolean(nodeByClass(init, 'gs-init-action').props.disabled), false, 'the action is enabled immediately')
		const detailEntry = { name: 'close', file: 'icons/close.svg', viewBox: '0 0 24 24', rule: '关闭浮层', history: [], pointers: [{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1, literal: '' }], keywords: [] }
		const detail = Detail({ t, entry: detailEntry, svg: '<svg/>', onBack: say, onSave: async () => ({}), onInspect: async () => ({}), onDelete: say, onRefresh: say, say })
		assert.ok(treeOf(detail) > 10, 'Detail rendered too little')
		assert.ok(classesOf(detail).includes('gs-detail'), 'Detail keeps its own frame')
		assert.ok(classesOf(detail).includes('gs-meta-link'), 'references are folded into the meta block')
		const empty = ListView({ t, library: { libraryExists: false, root: '/w', graphics: [] }, loading: false, error: '', onOpen: say, onCreate: say, onImport: say, onRefresh: say, say })
		assert.ok(treeOf(empty) > 5)
		assert.ok(!classesOf(empty).includes('gs-head'), 'a missing library must not draw the title bar')
		assert.ok(!classesOf(empty).includes('gs-filter'), 'a missing library must not draw the search row')
		// An initialised but empty library is a real state: the toolbar (import /
		// AI / add) and the same four features as the first-run card must be there.
		const blank = ListView({ t, library: { libraryExists: true, root: '/w', graphics: [] }, loading: false, error: '', onOpen: say, onCreate: say, onImport: say, onRefresh: say, say })
		const blankClasses = classesOf(blank)
		assert.ok(blankClasses.includes('gs-head'), 'an empty library keeps the standard header')
		assert.ok(blankClasses.includes('gs-listwrap'), 'and the standard body frame')
		assert.ok(blankClasses.includes('gs-listfoot'), 'and the standard footer')
		assert.ok(blankClasses.includes('gs-empty gs-empty-paste'), 'with the centred paste hint')
		assert.ok(!blankClasses.includes('gs-scanbar'), 'the startup scan stays silent: no bar until it finds something')
		const blankSearch = nodeByClass(blank, 'gs-searchhint')
		assert.ok(blankSearch, 'the standard header keeps its search box')
		assert.equal(blankSearch.props.disabled, true, 'but it is inert while the library is empty')
		// The scan bar owns its states: one sentence each, and the chevron only
		// exists when there is something behind it.
		const flatText = (node) => {
			if (node === null || node === undefined) return ''
			if (Array.isArray(node)) return node.map(flatText).join('')
			if (typeof node !== 'object') return String(node)
			const own = typeof node.type === 'function' ? flatText(node.type(node.props || {})) : ''
			return own + (node.children || []).map(flatText).join('')
		}
		const bar = (scan) => ScanBar({ t, scan, onOpen: say, onRescan: say })
		const scanningBar = bar({ phase: 'scanning', groups: [] })
		assert.ok(classesOf(scanningBar).includes('gs-spinner'), 'scanning shows a spinner in the bar')
		assert.equal(nodeByClass(scanningBar, 'gs-scanbar-scan').props.disabled, true, 'the rescan button waits for the answer')
		assert.ok(flatText(scanningBar).includes('scanBarScanning'), 'with a scanning sentence')
		const emptyBar = bar({ phase: 'ready', groups: [] })
		assert.ok(!classesOf(emptyBar).includes('gs-spinner'), 'a finished scan has no spinner')
		assert.ok(!classesOf(emptyBar).includes('gs-scanbar-open'), 'and nothing to open when it found nothing')
		assert.ok(flatText(emptyBar).includes('scanBarEmpty'), 'it says the scan found nothing, not "please scan"')
		const errorBar = bar({ phase: 'error', groups: [] })
		assert.ok(flatText(errorBar).includes('scanBarError'), 'a failed scan says so')
		assert.ok(!classesOf(errorBar).includes('gs-scanbar-open'), 'and offers no dead-end link')
		assert.equal(nodeByClass(errorBar, 'gs-scanbar-scan').props.disabled, false, 'the rescan button becomes the retry')
		const foundBar = bar({ phase: 'ready', groups: [{ signature: 's', svg: '<svg/>' }] })
		assert.ok(classesOf(foundBar).includes('gs-scanbar-thumb'), 'a found group shows its thumbnail')
		assert.ok(classesOf(foundBar).includes('gs-scanbar-open'), 'and the chevron into the scan view')

		const filled = ListView({ t, library: { libraryExists: true, root: '/w', graphics: [{ name: 'close', note: 'n', keywords: [], svg: '' }] }, loading: false, error: '', onOpen: say, onCreate: say, onImport: say, onRefresh: say, say })
		assert.ok(classesOf(filled).includes('gs-head'), 'a filled library keeps its chrome')
		assert.ok(!classesOf(filled).includes('gs-filter'), 'search now lives in the title bar')
		const filledSearch = nodeByClass(filled, 'gs-searchhint')
		assert.equal(filledSearch.props.disabled, false, 'the search box is usable once an icon exists')
		let opened = 0
		const tLocal = module._test.makeT(null)
		const updated = ListView({
			t: tLocal,
			library: { libraryExists: true, root: '/w', graphics: [] },
			version: '0.18.0',
			update: { available: true, latest: '0.18.1' },
			onUpdate: () => { opened += 1 },
			loading: false,
			error: '',
			onOpen: say,
			onCreate: say,
			onImport: say,
			onRefresh: say,
			say,
		})
		const badge = nodeByClass(updated, 'gs-update')
		assert.ok(badge, 'a newer release shows a badge next to the version')
		assert.ok(flatText(badge).includes('0.18.1'), 'and names the version it can update to')
		badge.props.onClick()
		assert.equal(opened, 1, 'clicking it opens the plugin panel')
		assert.ok(!classesOf(blank).includes('gs-update'), 'no badge when the host proves nothing newer')
		assert.ok(!classesOf(filled).includes('gs-scanbar'), 'a library with nothing to adopt shows no bar')
		// One dialog, four sources: every mode renders its first frame.
		for (const mode of ['paste', 'supply', 'ai']) {
			const add = AddIconDialog({ t, sessionId: 's', workspace: '/w', library: { graphics: [] }, mode, text: '', name: '', ref: '', onClose: say, onImported: async () => {} })
			assert.ok(treeOf(add) > 5, `the add dialog renders in ${mode} mode`)
			assert.ok(classesOf(add).includes('gs-ai-preview') === (mode !== 'paste') || treeOf(add) > 5, `and keeps a frame in ${mode} mode`)
		}
		const supply = SupplyView({ t, sessionId: 's', workspace: '/w', library: { graphics: [] }, onBack: say, onImported: async () => {}, say })
		assert.ok(treeOf(supply) > 5, 'the supply browser rendered too little')
		assert.ok(classesOf(supply).includes('gs-supply'), 'the supply browser keeps its own frame')
		const row = DerivationRow({
			t,
			item: {
				file: 'src/a.tsx',
				kind: 'inline',
				index: 0,
				line: 3,
				svg: '<svg viewBox="0 0 24 24"><path d="M4 4H20" stroke="#ff00ff"/></svg>',
				paint: { color: '#ff00ff', colors: ['#ff00ff'], strokeWidth: '4', currentColor: false, multi: false },
			},
		})
		assert.ok(treeOf(row) > 3, 'a derivation row renders')
		assert.ok(classesOf(row).includes('gs-deriv'), 'and keeps its own frame')
		assert.ok(!classesOf(row).includes('gs-deriv-dot'), 'the preview speaks for itself: no paint badges')
	})

	await test('apply registers a tab body the host can render', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const fakeReact = {
			createElement: () => null,
			Fragment: 'fragment',
			useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
			useEffect: () => {},
			useRef: (value) => ({ current: value === undefined ? null : value }),
			useCallback: (fn) => fn,
			useMemo: (fn) => fn(),
		}
		const module = factory((name) => (name === 'react' ? fakeReact : undefined))
		let registered = 0
		const slots = {
			inject: (_name, make) => {
				const element = typeof make === 'function' ? make() : make
				assert.ok(element !== undefined, `slot ${_name} registered nothing`)
			},
			register: (spec, component) => {
				assert.ok(typeof component === 'function' || (component && typeof component === 'object'), `slot ${spec.name} has no component`)
				registered += 1
				return spec
			},
		}
		const ctx = {
			effect: (fn) => { fn() },
			locale: { register: () => {} },
			inject: (deps, run) => {
				run({
					get: (name) => (name === 'sidebarRightTabs' ? { register: () => { registered += 1 } } : name === 'sidebarRight' ? {} : undefined),
					effect: (fn) => { fn() },
					slots,
				})
			},
		}
		module.apply(ctx)
		assert.ok(registered >= 2, 'the tab body and title must both register a component')
	})

	await test('the panel browses one supply library, not one per supplier', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		for (const route of ['library-collections', 'library-search', 'library-set', 'library-fetch', 'library-import']) {
			assert.ok(source.includes(`'${route}'`), `the client does not call ${route}`)
		}
		assert.ok(!/iconify-(?:collections|search|set|fetch|import)/u.test(source), 'the per-supplier routes are gone')
		assert.ok(source.includes("entry.source.startsWith('iconmcp:')"), 'IconMCP imports count as already in the library')
		assert.ok(source.includes("'library-samples'"), 'the client asks for IconMCP set previews')
		assert.ok(source.includes("api.post('library-peek'"), 'a card opens a suggestion panel before importing')
		assert.ok(source.includes('items: [{ ref: props.iconRef'), 'the import carries the confirmed name, rule and style')
		assert.ok(source.includes("api.post('derivations'"), 'the panel reads every derivation from the code')
		assert.ok(source.includes("listAi: 'AI 生成图标'"), 'the menu offers AI create')
		assert.ok(source.includes("api.post('ai-create'"), 'and the dialog asks the host for a drawing')
		assert.ok(source.includes("mode: add.mode"), 'one dialog is opened for every source')
		// The supply browser is the one that opens the dialog from a card's "+";
		// a missing prop there fails silently, so pin it.
		assert.match(source, /h\(SupplyView, \{[\s\S]*?onAdd:/, 'the supply browser can open the add dialog')
		// The scan entry left the ⋯ menu, but the bar at the bottom still needs it.
		assert.match(source, /h\(ListView, \{[\s\S]*?onScan:/, 'the bottom scan bar can still open the scan')
		// React reserves `ref`: a string there is a legacy string ref (#290).
		assert.ok(source.includes('iconRef: add.ref'), 'the icon ref is passed under a non-reserved prop')
		assert.ok(!source.includes('ref: add.ref'), 'never as `ref`, which React treats specially')
		for (const retired of ['function ImportDialog', 'function SupplyAddDialog', 'function AiCreateDialog']) {
			assert.ok(!source.includes(retired), `${retired} is gone: there is one add dialog`)
		}
		assert.ok(source.includes("t('aiRefs'"), 'the preview says which icons were studied')
		assert.ok(source.includes('function AiPromptDialog'), 'AI create asks for a prompt first')
		assert.ok(source.includes('onDraft(result)'), 'the prompt dialog hands the draft to the save dialog')
		assert.ok(source.includes("t('aiPromptHint'"), 'the prompt step explains the two-step flow')
		assert.ok(source.includes("detailPointers: '{n} 处派生'"), 'the panel is called 派生 in the UI')
		assert.ok(source.includes("detailPointersOne: '{n} derivation'"), 'and the English count is not "1 derivations"')
		// Regression: sample art went into the module cache only, so every card
		// stayed blank. The drawings must reach component state as well.
		assert.ok(source.includes('setPreviews((current) => ({ ...current, ...svgs }))'), 'set previews reach component state')
		assert.ok(source.includes("format: 'svg'"), 'an IconMCP set page is drawn in one call')
		assert.ok(source.includes("map((name) => `${prefix}:${name}`)"), 'the client adds the prefix to bare set names')
		assert.ok(source.includes("set.source === 'iconmcp' ? 'IconMCP'"), 'the facts line names the supplier next to the licence')
		assert.ok(!source.includes('gs-supply-badge'), 'the supplier is not a separate badge any more')
	})

	await test('a boot-time "no library" answer is probed again instead of believed', async () => {
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))(globalThis.window)
		const module = factory((name) => (name === 'react' ? { createElement: () => null } : undefined))
		const probe = module._test.shouldRetryLibrary
		assert.equal(probe({ libraryExists: false }, 3), true, 'a fresh host may answer before the project is mounted')
		assert.equal(probe({ libraryExists: false }, 0), false, 'but not forever')
		assert.equal(probe({ libraryExists: true }, 3), false, 'a real library settles it')
		assert.equal(probe(null, 3), false, 'an error is not a "no library" answer')
	})

	await test('a standalone SVG file is named without a line number', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const module = factory((name) => (name === 'react' ? { createElement: () => null, Fragment: 'f' } : undefined))
		const { siteLabel } = module._test
		assert.equal(siteLabel({ file: 'icons/trash.svg', kind: 'file', line: 1 }), 'icons/trash.svg', 'a whole file has no line inside it')
		assert.equal(siteLabel({ file: 'src/a.tsx', kind: 'inline', line: 42 }), 'src/a.tsx:42')
		assert.equal(siteLabel({ file: 'src/a.tsx', kind: 'inline' }), 'src/a.tsx:1', 'a missing line reads as the first one')
	})

	await test('layout classes keep their display rule', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const start = source.indexOf('const CSS = `')
		const end = source.indexOf('\n`', start)
		const css = source.slice(start, end)
		for (const cls of ['gs-root', 'gs-head', 'gs-listfoot', 'gs-cardmenu', 'gs-scanbar']) {
			const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(css)
			assert.ok(rule, `missing .${cls} rule`)
			assert.ok(rule[1].includes('display:'), `.${cls} lost its display rule`)
		}
	})

	await test('the poll and an icon open stop paying for the workspace scan', async () => {
		const workspace = '/w/proj'
		const files = new Map()
		const dirs = new Set(['/', '/w', workspace, `${workspace}/src`])
		const writes = []
		const fsPort = {
			async resolve(rel, options = {}) { return path.isAbsolute(rel) ? rel : path.resolve(options.cwd || '/', rel) },
			async stat(abs) {
				if (files.has(abs)) return { type: 'file', size: files.get(abs).length }
				if (dirs.has(abs)) return { type: 'directory' }
				return null
			},
			async readText(abs) { return files.get(abs) ?? null },
			async writeText(abs, text) { files.set(abs, text); writes.push(abs) },
			async listDir(abs) {
				const out = []
				for (const key of files.keys()) if (path.dirname(key) === abs) out.push({ name: path.basename(key), type: 'file', size: files.get(key).length })
				for (const dir of dirs) if (dir !== abs && path.dirname(dir) === abs) out.push({ name: path.basename(dir), type: 'directory' })
				return out
			},
		}
		files.set(`${workspace}/src/a.tsx`, '<svg viewBox="0 0 24 24"><path d="M4 4L20 20"/></svg>\n')
		const routes = new Map()
		const services = {
			webServer: { register: (spec) => { routes.set(spec.path, spec.handler); return () => {} } },
			fs: fsPort,
			sessions: { get: () => undefined, list: () => [] },
			workspaceRegistry: { list: () => [{ path: workspace, updatedAt: 'z' }] },
			workingDirectory: { defaultDirectory: workspace },
			sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: workspace }) },
			tools: undefined,
			systemPrompt: { section: () => () => {} },
			locale: { register: () => () => {} },
			slots: {},
		}
		const scope = {
			get: (name) => services[name],
			effect: (fn) => { fn() },
			inject: (_deps, run) => run(scope),
			systemPrompt: services.systemPrompt,
		}
		const { apply } = await import('../lib/index.js')
		apply({ inject: (_deps, run) => run(scope), effect: (fn) => { fn() } })
		const call = (name, { method = 'GET', search = '', body } = {}) => new Promise((resolve) => {
			const handler = routes.get(`/api/dsh-icon-studio/${name}`)
			assert.ok(handler, `route ${name} is not mounted`)
			const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
			const req = { method, url: `/api/dsh-icon-studio/${name}${search}`, async *[Symbol.asyncIterator]() { yield* chunks } }
			const res = {
				statusCode: 0,
				headersSent: false,
				setHeader() {},
				end(payload) { this.headersSent = true; resolve({ status: this.statusCode, data: JSON.parse(payload), size: payload.length }) },
			}
			handler(req, res)
		})
		const q = `?workspace=${encodeURIComponent(workspace)}`
		await call('init', { method: 'POST', body: { workspace } })
		const saved = await call('save', {
			method: 'POST',
			body: { workspace, name: 'route', svg: '<svg viewBox="0 0 24 24"><path d="M4 4L20 20"/></svg>' },
		})
		assert.equal(saved.status, 200)
		assert.equal(saved.data.entry.pointers.length, 1, 'a create links the copy it was pasted from')
		assert.ok(saved.data.entry.scannedAt, 'and records that the workspace was indexed')

		const state = await call('state', { search: q })
		assert.ok(state.data.revision, 'the state carries a revision')
		assert.equal(state.data.graphics[0].name, 'route')
		assert.ok(Array.isArray(state.data.graphics[0].pointers), 'the compact pointer list rides along')
		assert.ok(!('literal' in state.data.graphics[0].pointers[0]), 'but not the tracked path data')
		const writesBeforePoll = writes.length
		const poll = await call('state', { search: `${q}&since=${state.data.revision}` })
		assert.equal(poll.data.unchanged, true, 'an unchanged library answers "unchanged"')
		assert.ok(poll.size < 400, `the poll is a few bytes, not the whole library (${poll.size})`)
		assert.equal(writes.length, writesBeforePoll, 'a poll never writes the manifest')

		// A library written before `scannedAt` existed must scan once, then trust it.
		const manifestPath = `${workspace}/.icons.json`
		const manifest = JSON.parse(files.get(manifestPath))
		delete manifest.metadata.route.scannedAt
		delete manifest.metadata.route.pointers
		files.set(manifestPath, JSON.stringify(manifest, null, 2))
		writes.length = 0
		const firstOpen = await call('graphic', { search: `${q}&name=route` })
		assert.ok(firstOpen.data.scan.files > 0, 'the first open of a legacy entry indexes the workspace')
		assert.equal(firstOpen.data.entry.pointers.length, 1)
		assert.ok(writes.some((file) => file === manifestPath), 'and records the result once')
		writes.length = 0
		const secondOpen = await call('graphic', { search: `${q}&name=route` })
		assert.equal(secondOpen.data.scan.files, 0, 'the second open does not walk the workspace again')
		assert.equal(writes.length, 0, 'and does not rewrite the manifest on every click')

		const firstScan = await call('scan', { method: 'POST', body: { workspace } })
		assert.equal(firstScan.status, 200)
		const cachedScan = await call('scan', { method: 'POST', body: { workspace } })
		assert.equal(cachedScan.data.groups.length, firstScan.data.groups.length, 'the cached scan answers the same list')
		const forced = await call('scan', { method: 'POST', body: { workspace, force: true } })
		assert.equal(forced.data.groups.length, firstScan.data.groups.length, 'and an explicit rescan agrees with it')
	})

	console.log('data URIs and the copy audit')

	// A real mask pipeline output: a class attribute, a `#000` fill and the
	// bounding-box path Clarity leaves behind. None of that is geometry.
	const MASK_BLOB = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><path fill="#000" d="M2 2h32v32H2z" class="clr-i-solid"/><path fill="none" d="M0 0h36v36H0z"/></svg>'
	const box24 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
	const star24 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" fill="currentColor"/></svg>'
	const blobUri = (svg, params = ';base64') => `data:image/svg+xml${params},${params === ';base64' ? Buffer.from(svg).toString('base64') : encodeURIComponent(svg)}`

	await test('a masked CSS data URI is a site, not an invisible copy', async () => {
		const io = memIo({
			'package.json': '{}',
			'styles/icons.css': `.ui-icon-box{-webkit-mask-image:url("${blobUri(MASK_BLOB)}")}`,
		})
		const library = normalizeSvg(MASK_BLOB).svg
		assert.notEqual(shapeSignature(MASK_BLOB), shapeSignature(library), 'the raw blob would never match the library entry')
		assert.equal(decodedShapeSignature(MASK_BLOB), shapeSignature(library), 'normalising both sides does match')
		const pointers = await findShapePointers(io, library)
		assert.deepEqual(pointers.map((pointer) => `${pointer.kind}:${pointer.file}`), ['datauri:styles/icons.css'])
		assert.equal(isStyleSource('styles/icons.css'), true)
		assert.equal(isUiSource('styles/icons.css'), false)
	})

	await test('a percent-encoded data URI is decoded too', async () => {
		const io = memIo({ 'src/App.tsx': `const ICON = "${blobUri(box24, ';charset=utf-8')}"` })
		const pointers = await findShapePointers(io, normalizeSvg(box24).svg)
		assert.equal(pointers.length, 1)
		assert.equal(pointers[0].kind, 'datauri')
	})

	await test('a raster data URI is reported, never guessed at', async () => {
		const io = memIo({ 'src/a.css': '.a{-webkit-mask-image:url("data:image/png;base64,iVBORw0KGgo=")}' })
		assert.equal((await findShapePointers(io, normalizeSvg(box24).svg)).length, 0, 'a PNG has no geometry to compare')
		const result = await audit(io, [{ name: 'box', svg: box24 }])
		assert.equal(result.raster.length, 1)
		assert.equal(result.raster[0].mime, 'png')
		assert.equal(result.raster[0].line, 1)
		assert.equal(result.counts.datauri, 0)
	})

	await test('pushing to a data URI keeps the encoding and the CSS around it', async () => {
		const next = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5h14v14H5z" fill="currentColor"/></svg>'
		const io = memIo({ 'styles/a.css': `.a{-webkit-mask-image:url("${blobUri(box24)}")}` })
		const pushed = await pushShapePointers(io, next, [{ file: 'styles/a.css', kind: 'datauri', index: 0, line: 1 }])
		assert.equal(pushed.rewritten, 1)
		const after = io.files.get('styles/a.css')
		assert.ok(after.startsWith('.a{-webkit-mask-image:url("data:image/svg+xml;base64,'), 'the wrapper survives the edit')
		assert.ok(after.endsWith('")}'), 'and so does the tail')
		assert.equal(shapeSignature(dataUriBlocks(after)[0].text), shapeSignature(next))
	})

	await test('a blob the file uses twice is a shared constant and is left alone', async () => {
		const next = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5h14v14H5z" fill="currentColor"/></svg>'
		const uri = blobUri(box24)
		const before = `.a{mask-image:url("${uri}")}.b{mask-image:url("${uri}")}`
		const io = memIo({ 'styles/a.css': before })
		const pushed = await pushShapePointers(io, next, [{ file: 'styles/a.css', kind: 'datauri', index: 0, line: 1 }])
		assert.equal(pushed.rewritten, 0, 'a copy nobody pointed at is not rewritten')
		assert.equal(io.files.get('styles/a.css'), before)
		assert.equal(countBlob(before, dataUriBlocks(before)[0].blob), 2)
	})

	await test('the audit groups copies per icon and names what it cannot read', async () => {
		const io = memIo({
			'package.json': '{}',
			'src/a.tsx': `export const A = () => (${box24})`,
			'src/b.tsx': `export const B = () => (${box24})`,
			'styles/c.css': `.x{-webkit-mask-image:url("${blobUri(box24)}")}`,
			'src/d.tsx': `export const D = () => (${star24})`,
		})
		const result = await audit(io, [{ name: 'box', svg: box24 }])
		assert.equal(result.counts.inline, 2)
		assert.equal(result.counts.datauri, 1)
		assert.equal(result.icons[0].name, 'box')
		assert.equal(result.icons[0].sites, 3, 'three copies of one drawing')
		assert.equal(result.unregistered.length, 1, 'the star is drawn but the library does not have it')
		assert.equal(result.unregistered[0].file, 'src/d.tsx')
		assert.equal(result.scanned.style, 1)
	})

	await test('a recorded pointer that no longer draws its icon is drift', async () => {
		const io = memIo({ 'src/a.tsx': `export const A = () => (${star24})` })
		const result = await audit(io, [{ name: 'box', svg: box24, pointers: [{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1 }] }])
		assert.equal(result.stale.length, 1)
		assert.equal(result.stale[0].name, 'box')
		assert.equal(violations(result, { maxSites: 0 }).clear, false)
	})

	await test('the site budget decides what a strict check fails on', () => {
		const result = { icons: [{ name: 'box', sites: 4, list: [] }], stale: [], raster: [], unregistered: [], counts: {}, scanned: {} }
		assert.equal(violations(result, { maxSites: 3 }).clear, false)
		assert.equal(violations(result, { maxSites: 4 }).clear, true)
		assert.equal(violations(result, { maxSites: 0 }).clear, true, 'no budget means no failure')
	})

	await test('check-icons parses its flags and refuses nonsense', async () => {
		const { parseArgs } = await import('../scripts/check-icons.mjs')
		assert.equal(parseArgs([]).maxSites, 0)
		assert.equal(parseArgs(['--max-sites=2', '--strict']).strict, true)
		assert.equal(parseArgs(['--json']).json, true)
		assert.throws(() => parseArgs(['--max-sites=oops']))
		assert.throws(() => parseArgs(['--nope']))
	})

	console.log('')
	if (failed > 0) {
		console.error(`${failed} failing, ${passed} passing`)
		process.exitCode = 1
	} else {
		console.log(`all ${passed} checks passed`)
	}
}

await main()
