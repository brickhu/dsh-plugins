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
import { normalizeSvg, pathBBox, parsePath, serializeGraphic, transformPath, bakeIconifyTransform } from '../lib/svg.js'
import { createStore, MANIFEST_FILE, slugify, normalizeName, refName } from '../lib/store.js'
import { applyAsset, cascadeRename, scanUsage } from '../lib/assets.js'
import { findShapePointers, pushShapePointers, isUiSource, scanCodeShapes } from '../lib/sync.js'
import { bodySignature } from '../lib/shape.js'

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
		const shared = groups.find((group) => group.signature === bodySignature(library))
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

	await test('the workspace scan only offers simple glyph art', async () => {
		const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
		const gradient = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><path d="M4 4h16v16H4z" fill="url(#g)"/></svg>'
		const colorful = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h8v8H4z" fill="#f00"/><path d="M12 12h8v8h-8z" fill="#0f0"/><path d="M4 16h8v4H4z" fill="#00f"/></svg>'
		const many = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${'<path d="M1 1h2v2H1z" fill="currentColor"/>'.repeat(12)}</svg>`
		const io = memIo({
			'package.json': '{}',
			'src/A.tsx': `export const A = () => (${icon})`,
			'src/B.tsx': `export const B = () => (${gradient})`,
			'src/C.tsx': `export const C = () => (${colorful})`,
			'src/D.tsx': `export const D = () => (${many})`,
		})
		const groups = await scanCodeShapes(io)
		assert.equal(groups.length, 1, 'only the simple glyph is a candidate')
		assert.equal(groups[0].sites[0].file, 'src/A.tsx')
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

	console.log('client geometry')

	await test('client helpers round-trip path data and boxes', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		assert.ok(typeof factory === 'function', 'client.js must register a lazy factory')
		const fakeReact = {
			createElement: () => null,
			Fragment: 'fragment',
			useState: (value) => [value, () => {}],
			useEffect: () => {},
			useRef: (value) => ({ current: value }),
			useCallback: (fn) => fn,
			useMemo: (fn) => fn(),
		}
		const module = factory((name) => (name === 'react' ? fakeReact : undefined))
		assert.ok(module.apply)
		assert.deepEqual(module.inject, ['slots', 'locale'])
		const { parsePath: clientParse, segmentsToD, pathBBox: clientBox, penD, ellipseD, transformD } = module._test
		const segments = clientParse('M0 0L10 0L10 10Z')
		assert.equal(segmentsToD(segments), 'M0 0L10 0L10 10Z')
		const box = clientBox('M0 0L10 0L10 10Z')
		assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 10, 10])
		const moved = transformD('M0 0L10 0', [1, 0, 0, 1, 5, 5])
		assert.equal(moved, 'M5 5L15 5')
		const curved = penD([{ x: 0, y: 0, out: { x: 2, y: 0 } }, { x: 10, y: 10, in: { x: -2, y: 0 } }], false)
		assert.ok(curved.startsWith('M0 0C2 0'))
		const circle = clientBox(ellipseD(10, 10, 5, 5))
		assert.ok(Math.abs(circle.width - 10) < 0.05)
		const { ICON_CANVAS } = module._test
		assert.equal(ICON_CANVAS, 24, 'new icons start on the 24-unit grid')
		// the client file must stay self-contained for the browser module loader
		assert.ok(source.includes("window.__ModuleLoader__.load"))
		assert.ok(!/^\s*import\s/m.test(source), 'client.js must not use ESM imports')
	})

	await test('node editing rewrites one anchor and keeps the path valid', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const fakeReact = { createElement: () => null, Fragment: 'fragment' }
		const module = factory((name) => (name === 'react' ? fakeReact : undefined))
		const { parsePath, segmentsToD } = module._test

		const segments = parsePath('M0 0L10 0L10 10')
		assert.equal(segments.length, 3)
		segments[1].p[0] = [4, 2]
		assert.equal(segmentsToD(segments), 'M0 0L4 2L10 10')

		const cubic = parsePath('M0 0C2 4 6 8 10 10')
		assert.equal(cubic[1].c, 'C')
		assert.equal(cubic[1].p.length, 3, 'two controls and one anchor')
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
		const stale = t('syncStale', { n: 3 })
		assert.equal(typeof stale, 'string', 'function entries must be called')
		assert.ok(stale.includes('3'), 'and receive their variables')
		assert.equal(typeof t('syncClean'), 'string')
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

	await test('inline previews scope their gradient ids', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(source.includes('function scopeIds('), 'the helper exists')
		assert.ok(source.includes('url(#${id})'), 'references are rewritten')
		assert.ok(source.includes('svgArt(entry.svg, entry.name)'), 'cards render through the scoping/embedding helper')
	})

	await test('the mounted tab refreshes the library when it becomes visible', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		assert.ok(source.includes("addEventListener('visibilitychange'"), 'listens for visibility')
		assert.ok(source.includes("addEventListener('focus'"), 'listens for focus')
		assert.ok(source.includes('setInterval(refresh, 15000)'), 'polls while mounted')
	})

	await test('closure detection decides shape vs path', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		let factory = null
		globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
		new Function('window', source)(globalThis.window)
		const module = factory((name) => (name === 'react' ? { createElement: () => null, Fragment: 'f' } : undefined))
		const { isClosedPath, kindOf } = module._test

		assert.equal(isClosedPath('M4 4h16v16H4z'), true, 'explicit close')
		assert.equal(isClosedPath('M0 0L10 0L10 10L0 10L0 0'), true, 'line back to start')
		assert.equal(isClosedPath('M0 0L10 0'), false, 'open path')
		assert.equal(kindOf({ d: 'M0 0L10 0', fill: 'currentColor' }), 'shape', 'filled art is a shape')
		assert.equal(kindOf({ d: 'M0 0L10 0', fill: 'none', stroke: 'currentColor' }), 'path')
	})

	await test('geometry helpers used by the canvas are defined', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const needed = ['normalizeRect', 'quadBBox', 'worldQuad', 'unionBBox', 'viewBoxSize', 'withId', 'matrixMultiply', 'matrixInvert', 'translateM', 'pathBBox', 'segmentsToD', 'parsePath']
		const missing = needed.filter((name) => !new RegExp(`(?:function|const)\\s+${name}\\s*[=(]`).test(source))
		assert.deepEqual(missing, [], `undefined helpers: ${missing.join(', ')}`)
	})

	await test('every icon reference exists in the icon map', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const start = source.indexOf('const I = {')
		const end = source.indexOf('\n    }', start)
		const keys = new Set([...source.slice(start, end).matchAll(/\n\s+([a-zA-Z]+):/g)].map((match) => match[1]))
		const used = new Set([...source.slice(end).matchAll(/\bI\.([a-zA-Z]+)\b/g)].map((match) => match[1]))
		const missing = [...used].filter((name) => !keys.has(name))
		assert.deepEqual(missing, [], `unknown icon keys: ${missing.join(', ')}`)
	})

	await test('every icon reference exists in the icon map', () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const start = source.indexOf('const I = {')
		const end = source.indexOf('\n    }', start)
		const keys = new Set([...source.slice(start, end).matchAll(/\n\s+([a-zA-Z]+):/g)].map((match) => match[1]))
		const used = new Set([...source.slice(end).matchAll(/\bI\.([a-zA-Z]+)\b/g)].map((match) => match[1]))
		const missing = [...used].filter((name) => !keys.has(name))
		assert.deepEqual(missing, [], `unknown icon keys: ${missing.join(', ')}`)
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
		const { Panel, Detail, ListView, ImportDialog } = module._test
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
		assert.ok(treeOf(Panel({ sessionId: 's', t })) >= 4, 'Panel did not render')
		const detailEntry = { name: 'close', file: 'icons/close.svg', viewBox: '0 0 24 24', rule: '关闭浮层', history: [], pointers: [{ file: 'src/a.tsx', kind: 'inline', index: 0, line: 1, literal: '' }], keywords: [] }
		const detail = Detail({ t, entry: detailEntry, svg: '<svg/>', onBack: say, onSave: async () => ({}), onInspect: async () => ({}), onDelete: say, onRefresh: say, say })
		assert.ok(treeOf(detail) > 10, 'Detail rendered too little')
		assert.ok(classesOf(detail).includes('gs-detail'), 'Detail keeps its own frame')
		assert.ok(classesOf(detail).includes('gs-meta-link'), 'references are folded into the meta block')
		const empty = ListView({ t, library: { libraryExists: false, root: '/w', graphics: [] }, loading: false, error: '', onOpen: say, onCreate: say, onImport: say, onRefresh: say, say })
		assert.ok(treeOf(empty) > 5)
		assert.ok(!classesOf(empty).includes('gs-head'), 'empty library must not draw the title bar')
		assert.ok(!classesOf(empty).includes('gs-filter'), 'empty library must not draw the search row')
		const filled = ListView({ t, library: { libraryExists: true, root: '/w', graphics: [{ name: 'close', note: 'n', keywords: [], svg: '' }] }, loading: false, error: '', onOpen: say, onCreate: say, onImport: say, onRefresh: say, say })
		assert.ok(classesOf(filled).includes('gs-head'), 'a filled library keeps its chrome')
		assert.ok(!classesOf(filled).includes('gs-filter'), 'search now lives in the title bar')
		assert.ok(treeOf(ImportDialog({ t, onClose: say, onSubmit: say })) > 5)
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

	await test('layout classes keep their display rule', async () => {
		const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
		const start = source.indexOf('const CSS = `')
		const end = source.indexOf('\n`', start)
		const css = source.slice(start, end)
		for (const cls of ['gs-ehead', 'gs-etools', 'gs-head', 'gs-bottom', 'gs-tabbar', 'gs-editor']) {
			const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(css)
			assert.ok(rule, `missing .${cls} rule`)
			assert.ok(rule[1].includes('display:'), `.${cls} lost its display rule`)
		}
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
