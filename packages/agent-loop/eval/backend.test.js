import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { NO_ENTRY_NOTE, notGeometryError } from '../src/buildReport.js'
import { CDN_BASE, createEvalBackend, createReadFile, EXPORT_REG, IMPORT_REG } from './backend.js'
import { expectCase, WARNING_CASES } from '../test/warningCases.js'
import { everyFont, FONT_NAMES, UNKNOWN_FONT } from './fontCases.js'

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

const ESM_SPHERE = `import { primitives } from '@jscad/modeling'
export const main = (params) => {
  params.radius = { type: 'slider', default: 5, min: 1, max: 10 }
  return primitives.sphere({ radius: params.radius })
}`

const nameplate = (font = '') => `const jf = require('@jbroll/jscad-fluent')
const jscadText = require('@jscadui/jscad-text')
jscadText.init(require('@jscad/modeling'))
const main = () => {
  const plate = jf.cuboid({ size: [120, 30, 4] }).translateZ(2)
  const outline = jscadText.text2d('JOHN', { size: 12, halign: 'center', valign: 'center'${font} })
  const text = new jf.FluentGeom2(outline).extrudeLinear({ height: 2 }).translateZ(4)
  return plate.union(text)
}
module.exports = { main }`

const writeMain = async (source, backend = createEvalBackend()) => JSON.parse(await backend.requestTool('write', { path: 'main.js', content: source }))
const call = async (backend, name, input = {}) => {
  const out = await backend.requestTool(name, input)
  try {
    return JSON.parse(out)
  } catch {
    return out
  }
}

describe('eval backend builds', () => {
  it('builds on write and reports the geometry, then measures it', async () => {
    const backend = createEvalBackend()
    const report = await writeMain(CUBE, backend)
    expect(report).toEqual({
      saved: 'main.js',
      ok: true,
      entry: 'main.js',
      warnings: [],
      console: [],
      params: [],
      geometry: {
        parts: 1,
        boundingBox: [
          [-10, -10, -10],
          [10, 10, 10],
        ],
        dimensions: [20, 20, 20],
        volume: 8000,
        watertight: true,
        manifold: true,
        selfIntersecting: false,
      },
    })
    const measured = await call(backend, 'measure')
    expect(measured.volume).toBeCloseTo(8000, 0)
  })

  it('runs an ES module that imports @jscad/modeling and reports its slider', async () => {
    const backend = createEvalBackend()
    const report = await writeMain(ESM_SPHERE, backend)
    expect(report.ok).toBe(true)
    expect(report.params).toEqual([{ name: 'radius', type: 'slider', default: 5, min: 1, max: 10 }])
    const volume = (await call(backend, 'measure')).volume
    expect(volume).toBeGreaterThan(480)
    expect(volume).toBeLessThan(530)
  })

  const SECTION_BOX = `const { cuboid } = require('@jscad/modeling').primitives
const main = (params) => {
  params.box = { _type: 'Box', width: { type: 'slider', default: 40, min: 10, max: 80 }, depth: { default: 20 } }
  return cuboid({ size: [params.box.width, params.box.depth, 5] })
}
module.exports = { main }`

  it('builds a parameter section assigned as one object, and refuses one mixing in plain values', async () => {
    const report = await writeMain(SECTION_BOX)
    expect(report).toMatchObject({ ok: true, geometry: { dimensions: [40, 20, 5] } })
    expect(report.params).toEqual([
      { name: 'box.width', type: 'slider', default: 40, min: 10, max: 80 },
      { name: 'box.depth', type: 'int', default: 20, step: 1 },
    ])
    const mixed = await writeMain(SECTION_BOX.replace('depth: { default: 20 }', 'depth: 20'))
    expect(mixed).toMatchObject({ ok: false, error: { file: 'main.js', line: 3 } })
    expect(mixed.error.message).toContain('params.box was given an object mixing parameter definitions and plain values; assign each parameter on its own: params.box.width = { ... }')
  })

  it('fails a package that is not installed with the frame CDN error text', async () => {
    const res = await writeMain(`import { sphere } from '@jscad/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('failed to load module @jscad/primitives')
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/primitives')
  })

  it.each([
    ['a Hershey', ''],
    ['a TTF', ", font: 'Liberation Sans'"],
  ])('serves @jscadui/jscad-text, as the frame does: a nameplate with %s font builds', async (_, font) => {
    const backend = createEvalBackend()
    const res = await writeMain(nameplate(font), backend)
    expect(res.error).toBeUndefined()
    expect(res).toMatchObject({ ok: true, warnings: [], geometry: { parts: 1 } })
    const m = await call(backend, 'measure')
    expect(m.dimensions[0]).toBeCloseTo(120, 3)
    expect(m.dimensions[2]).toBeCloseTo(6, 3)
    expect(m.volume).toBeGreaterThan(120 * 30 * 4 + 50)
  })

  it('serves every font of the static font map from local files, bold included', async () => {
    const res = await writeMain(everyFont())
    expect(res.error).toBeUndefined()
    expect(res).toMatchObject({ ok: true, geometry: { parts: FONT_NAMES.length } })
    expect(FONT_NAMES).toContain('Liberation Sans:style=Bold')
  }, 60_000)

  it('names the available fonts when a model asks for an unknown one', async () => {
    const res = await writeMain(UNKNOWN_FONT)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('Font "Comic Sans MS" not found')
    expect(res.error.message).toContain('Liberation Sans (Bold, Italic, Bold Italic)')
    expect(res.error.message).toContain('Roboto (Bold, Italic)')
  })

  it('fails a package subpath the frame does not alias', async () => {
    const res = await writeMain(`import { sphere } from '@jscad/modeling/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/modeling/primitives.js')
  })

  it('rejects export without an import line, as the frame does', async () => {
    const res = await writeMain('export const main = () => []')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('SyntaxError')
  })

  it('reports the file, line, column and offending line of a syntax error', async () => {
    const res = await writeMain('const x = 1\nconst main (params) => {}\nmodule.exports = { main }')
    expect(res.ok).toBe(false)
    expect(res.error).toMatchObject({ name: 'SyntaxError', file: 'main.js', line: 2, column: 11 })
    expect(res.error.message).toMatch(/\(2:\d+\)/)
    expect(res.error.message).toContain('const main (params) => {}')
  })

  it('names the helper file a syntax error is in', async () => {
    const backend = createEvalBackend()
    await backend.reset({ 'helper.js': 'module.exports = {\n  size: 20\n  x: 1 }' })
    const res = await writeMain("const { size } = require('./helper.js')\nmodule.exports = { main: () => [] }", backend)
    expect(res.error).toMatchObject({ name: 'SyntaxError', file: 'helper.js', line: 3 })
  })

  it('reports where a runtime error was thrown', async () => {
    const res = await writeMain("const jf = require('@jbroll/jscad-fluent')\nconst main = () => {\n  return jf.cube({ size: 2 }).nope()\n}\nmodule.exports = { main }")
    expect(res).toMatchObject({ ok: false, entry: 'main.js', error: { name: 'TypeError', file: 'main.js', line: 3 } })
    expect(res.error.column).toBeGreaterThan(0)
  })

  it('fails a model whose main returns something that is not geometry', async () => {
    for (const value of ['42', '{ a: 1 }', 'undefined']) {
      const res = await writeMain(`module.exports = { main: () => (${value}) }`)
      expect(res, value).toMatchObject({ ok: false, error: notGeometryError() })
    }
  })

  it('uses the same transform test as the worker', () => {
    const worker = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8')
    expect(worker).toContain(`const importReg = ${IMPORT_REG}`)
    expect(worker).toContain(`const exportReg = ${EXPORT_REG}`)
  })

  it('maps project and CDN URLs like the frame', () => {
    const read = createReadFile({ 'main.js': 'X' })
    expect(read('http://project.local/main.js')).toBe('X')
    expect(() => read('http://project.local/other.js')).toThrow('file not found http://project.local/other.js')
    expect(read('https://cdn.jsdelivr.net/npm/@jscad/modeling@2.12.0')).toContain('"@jscad/modeling"')
    expect(() => read('https://cdn.jsdelivr.net/npm/no-such-package-xyz')).toThrow('file not found https://cdn.jsdelivr.net/npm/no-such-package-xyz')
  })

  it('refuses every Node built-in as a CDN package, like an unpublished one', () => {
    const read = createReadFile({})
    for (const name of builtinModules) {
      expect(() => read(CDN_BASE + name), name).toThrow(`file not found ${CDN_BASE}${name}`)
    }
  })

  it.each(['fs', 'child_process', 'net', 'http', 'https', 'os', 'process', 'worker_threads', 'node:fs', 'fs/promises'])(
    'fails model code that requires %s with the failed-to-load text',
    async (spec) => {
      const res = await writeMain(`const m = require(${JSON.stringify(spec)})\nmodule.exports = { main: () => { throw new Error('loaded ' + typeof m) } }`)
      expect(res.ok).toBe(false)
      expect(res.error.message).toContain(`failed to load module ${spec}`)
      expect(res.error.message).toContain('file not found')
    },
  )

  it('fails the build when the entry exports no main', async () => {
    const res = await writeMain('module.exports = {}')
    expect(res).toMatchObject({ ok: false, entry: 'main.js', error: { name: 'NoMainError', message: 'main.js exports no main()' } })
  })

  it('turns a throwing model into a failed build, never a throw', async () => {
    const res = await writeMain('throw new Error("boom")')
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/^boom/)
  })

  it('hands model code no real Node require through a global symbol', async () => {
    expect(globalThis[Symbol.for('jscadui.eval.nodeRequire')]).toBeUndefined()
    const res = await writeMain(`const load = globalThis[Symbol.for('jscadui.eval.userModule')]
module.exports = { main: () => { load('fs'); return [] } }`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('failed to load module fs')
  })

  it('returns console output on the build report, empty when the run logs nothing', async () => {
    expect((await writeMain(`console.log('hi', { a: 1 })\nmodule.exports = { main: () => [] }`)).console).toEqual(['hi {"a":1}'])
    expect((await writeMain(CUBE)).console).toEqual([])
  })

  it('restores the real console after a throw', async () => {
    const originalLog = console.log
    await writeMain('throw new Error("boom")')
    expect(console.log).toBe(originalLog)
  })

  it('never mutates the modeling module object fluent and model-tools share', async () => {
    const modeling = createRequire(import.meta.url)('@jscad/modeling')
    const before = modeling.primitives.roundedCuboid
    await writeMain(`const { primitives } = require('@jscad/modeling')\nmodule.exports = { main: () => primitives.roundedCuboid({ radius: 1 }) }`)
    expect(modeling.primitives.roundedCuboid).toBe(before)
  })
})

describe('eval backend project', () => {
  const MAIN_WITH_HELPER = `const jf = require('@jbroll/jscad-fluent')\nconst { size } = require('./helper.js')\nmodule.exports = { main: () => [jf.cube({ size })] }`

  it('builds the project through its entry with every file written so far', async () => {
    const backend = createEvalBackend()
    expect((await writeMain(MAIN_WITH_HELPER, backend)).ok).toBe(false)
    const res = await call(backend, 'write', { path: 'helper.js', content: 'module.exports = { size: 20 }' })
    expect(res).toMatchObject({ ok: true, entry: 'main.js' })
    expect((await call(backend, 'measure')).volume).toBeCloseTo(8000, 0)
    expect(backend.files()).toEqual({ 'main.js': MAIN_WITH_HELPER, 'helper.js': 'module.exports = { size: 20 }' })
  })

  it('resolves the entry Node style: package.json main, then index.js, then main.js', async () => {
    const backend = createEvalBackend()
    await backend.reset({ 'main.js': CUBE, 'index.js': ESM_SPHERE })
    expect((await call(backend, 'write', { path: 'box.js', content: CUBE.replace('size: 20', 'size: 10') })).entry).toBe('index.js')
    const report = await call(backend, 'write', { path: 'package.json', content: '{ "main": "./box.js" }' })
    expect(report).toMatchObject({ ok: true, entry: 'box.js', geometry: { dimensions: [10, 10, 10] } })
  })

  it('saves a helper written before any entry, with nothing to build and nothing failed', async () => {
    const backend = createEvalBackend()
    const res = await call(backend, 'write', { path: 'helper.js', content: 'module.exports = {}' })
    expect(res).toEqual({ saved: 'helper.js', ok: true, entry: null, note: `saved; ${NO_ENTRY_NOTE}`, warnings: [], console: [], params: [] })
    expect((await call(backend, 'measure')).error.message).toBe(`no geometry: ${NO_ENTRY_NOTE}`)
  })

  it('says a write whose build failed is saved', async () => {
    const res = await writeMain('throw new Error("broken")')
    expect(res).toMatchObject({ saved: 'main.js', ok: false, entry: 'main.js', note: 'main.js is saved; the build of main.js failed' })
  })

  it('edits a file and builds', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const res = await call(backend, 'edit', { path: 'main.js', oldString: 'size: 20', newString: 'size: 30' })
    expect(res.geometry.dimensions).toEqual([30, 30, 30])
    expect(backend.files()['main.js']).toContain('size: 30')
  })

  it('refuses an edit whose oldString is missing or not unique, and keeps the file and build', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const missing = await call(backend, 'edit', { path: 'main.js', oldString: 'size: 99', newString: 'size: 30' })
    expect(missing).toMatchObject({ ok: false, error: { name: 'EditError', message: expect.stringMatching(/oldString is not in main.js/) } })
    const twice = await call(backend, 'edit', { path: 'main.js', oldString: 'jf', newString: 'fluent' })
    expect(twice.error.message).toMatch(/oldString occurs \d+ times in main.js/)
    expect(backend.files()['main.js']).toBe(CUBE)
    expect((await call(backend, 'measure')).volume).toBeCloseTo(8000, 0)
  })

  it('lists and reads the project files', async () => {
    const backend = createEvalBackend()
    await backend.reset({ 'main.js': 'a\nb\n', 'lib/part.js': 'p' })
    expect(await call(backend, 'list')).toEqual({ ok: true, files: [{ path: 'lib/part.js', size: 1 }, { path: 'main.js', size: 4 }] })
    expect(await call(backend, 'read', { path: 'main.js' })).toBe('     1\ta\n     2\tb')
    expect((await call(backend, 'read', { path: 'gone.js' })).error.name).toBe('FileNotFoundError')
  })

  it('reset seeds the project, and builds it when asked', async () => {
    const backend = createEvalBackend()
    expect(await backend.reset({ 'main.js': CUBE })).toBeNull()
    expect((await call(backend, 'measure')).error.message).toMatch(/no geometry: write the model first/)
    const report = await backend.reset({ 'main.js': CUBE }, { build: true })
    expect(report).toMatchObject({ ok: true, entry: 'main.js' })
    expect(backend.lastBuild()).toEqual(report)
    expect((await call(backend, 'measure')).volume).toBeCloseTo(8000, 0)
    expect(await backend.reset({}, { build: true })).toBeNull()
  })

  it('answers measure, check and export on a failed last build with that failure', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    await writeMain('throw new Error("broken")', backend)
    for (const name of ['measure', 'check', 'export']) {
      const res = await call(backend, name, { format: 'stl' })
      expect(res).toEqual({ ok: false, error: { name: 'NoGeometryError', message: expect.stringMatching(/^no geometry: the last build failed \(broken\); fix it first$/) } })
    }
  })
})

describe('eval backend run', () => {
  it('returns console output and leaves the project and its build alone', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const res = await call(backend, 'run', { source: "console.log('expected volume', 42)" })
    expect(res).toEqual({ ok: true, warnings: [], console: ['expected volume 42'] })
    expect(backend.files()).toEqual({ 'main.js': CUBE })
    expect((await call(backend, 'measure')).volume).toBeCloseTo(8000, 0)
  })

  it('summarizes the geometry a snippet main() returns without touching the build', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const res = await call(backend, 'run', { source: CUBE.replace('size: 20', 'size: 4') })
    expect(res.geometry).toMatchObject({ parts: 1, dimensions: [4, 4, 4], volume: 64 })
    expect((await call(backend, 'measure')).volume).toBeCloseTo(8000, 0)
  })

  it('previews a value that is not geometry, and a snippet can require project files', async () => {
    const backend = createEvalBackend()
    await backend.reset({ 'helper.js': 'module.exports = { size: 20 }' })
    expect(await call(backend, 'run', { source: "module.exports = require('./helper.js')" })).toMatchObject({ ok: true, returned: '{"size":20}' })
    expect(await call(backend, 'run', { source: 'module.exports = { main: () => ({ a: 1 }) }' })).toMatchObject({ returned: '{"a":1}' })
  })

  it("says whether a run's geometry is watertight, manifold and self-intersecting, as a build report does", async () => {
    const closed = await call(createEvalBackend(), 'run', { source: CUBE })
    expect(closed.geometry).toMatchObject({ parts: 1, watertight: true, manifold: true, selfIntersecting: false })
    const open = await call(createEvalBackend(), 'run', {
      source: "const { geom3 } = require('@jscad/modeling').geometries\nmodule.exports = { main: () => geom3.fromPoints([[[0, 0, 0], [10, 0, 0], [0, 10, 0]]]) }",
    })
    expect(open.geometry).toMatchObject({ watertight: false })
  })

  it('reports an error with its line and column, and the console before it', async () => {
    const res = await call(createEvalBackend(), 'run', { source: "console.log('before')\nconst x = 1\nx()" })
    expect(res).toMatchObject({ ok: false, console: ['before'], error: { name: 'TypeError', file: '__run__.js', line: 3 } })
  })

  it('needs source', async () => {
    expect((await call(createEvalBackend(), 'run', {})).error.message).toMatch(/source must be/)
  })

  it('sets jscad-text up with the modeling it serves, so text2d needs no init', async () => {
    const withoutInit = nameplate().replace("jscadText.init(require('@jscad/modeling'))\n", '')
    const built = await writeMain(withoutInit)
    expect(built).toMatchObject({ ok: true, geometry: { parts: 1 } })
    expect(await writeMain(nameplate())).toEqual(built)
    const ran = await call(createEvalBackend(), 'run', { source: "const jscadText = require('@jscadui/jscad-text')\nconsole.log(jscadText.text2d('A') !== null)" })
    expect(ran).toMatchObject({ ok: true, console: ['true'] })
  })

  it('leaves no module state behind: a build after a run that broke jscad-text builds as a fresh build does', async () => {
    const withoutInit = nameplate().replace("jscadText.init(require('@jscad/modeling'))\n", '')
    const fresh = await writeMain(withoutInit)
    const backend = createEvalBackend()
    const ran = await call(backend, 'run', { source: "const jscadText = require('@jscadui/jscad-text')\njscadText.init(null)\njscadText.text2d('A')" })
    expect(ran).toMatchObject({ ok: false, error: { message: expect.stringContaining('call init(jscad) before using text2d()') } })
    expect(await writeMain(withoutInit, backend)).toEqual(fresh)
  })

  const SLIDER_BOX = `const { cuboid } = require('@jscad/modeling').primitives
const main = (params) => {
  params.width = { type: 'slider', default: 60, min: 10, max: 100 }
  params.depth = { type: 'slider', default: 20 }
  return cuboid({ size: [params.width, params.depth, 5] })
}
module.exports = { main }`

  it("runs a project main() with the snippet's values over its defaults, as a build would", async () => {
    const backend = createEvalBackend()
    await writeMain(SLIDER_BOX, backend)
    const given = await call(backend, 'run', { source: "const { main } = require('./main.js')\nmodule.exports = { main: () => main({ width: 30 }) }" })
    expect(given).toMatchObject({ ok: true, geometry: { dimensions: [30, 20, 5] } })
    const none = await call(backend, 'run', { source: "const { main } = require('./main.js')\nmodule.exports = { main: () => main() }" })
    expect(none).toMatchObject({ ok: true, geometry: { dimensions: [60, 20, 5] } })
  })

  it('names the failing file and line with no loader suffix on the message', async () => {
    const backend = createEvalBackend()
    await writeMain("const main = (params) => { throw new RangeError('too big') }\nmodule.exports = { main }", backend)
    const res = await call(backend, 'run', { source: "require('./main.js').main({})" })
    expect(res).toMatchObject({ ok: false, error: { name: 'RangeError', file: 'main.js', line: 1 } })
    expect(res.error.message).not.toMatch(/failed loading module/)
  })
})

describe('eval backend tools', () => {
  it('labels measure and check sizes as millimetres', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    expect((await call(backend, 'measure')).units).toBe('mm')
    expect((await call(backend, 'check')).units).toBe('mm')
  })

  it('answers measure with an error result when nothing was built', async () => {
    const res = await call(createEvalBackend(), 'measure')
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it('stubs view as unavailable without throwing', async () => {
    const res = await call(createEvalBackend(), 'view')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('UnavailableError')
  })

  it("exports the current build with the app's serializer for the format, answering its byte size without the bytes", async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const res = await call(backend, 'export', { format: 'stl' })
    expect(Object.keys(res).sort()).toEqual(['format', 'ok', 'size'])
    // Binary STL: an 84-byte header and 50 bytes per triangle of the cube's 12.
    expect(res).toEqual({ ok: true, format: 'stl', size: 84 + 12 * 50 })
    expect((await call(backend, 'export', { format: 'stla' })).size).toBeGreaterThan(12 * 'facet normal'.length)
    expect((await call(backend, 'export', { format: '3mf' })).ok).toBe(true)
  })

  it('refuses a format the app has no serializer for', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    expect(await call(backend, 'export', { format: 'step' })).toEqual({
      ok: false,
      error: { name: 'ExportFormatError', message: 'Unknown export format: step; use stl, 3mf, obj or svg' },
    })
  })

  it('measures and checks a one-part model as that part, as the frame does', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const measured = await call(backend, 'measure')
    const checked = await call(backend, 'check')
    expect(measured).not.toHaveProperty('entityCount')
    expect(checked).not.toHaveProperty('items')
    expect(checked).toMatchObject({ nonManifoldEdges: 0, consistentNormals: true })
  })

  it('answers export with an error result when nothing was built', async () => {
    const res = await call(createEvalBackend(), 'export', { format: 'stl' })
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it.each(['teleport', 'eval', 'writeModel', 'params'])('answers the unknown tool %s with an error result', async (name) => {
    const res = await call(createEvalBackend(), name, { source: CUBE })
    expect(res).toEqual({ ok: false, error: { name: 'UnknownToolError', message: `unknown tool ${name}` } })
  })

  it('answers docs from the API index', async () => {
    const backend = createEvalBackend()
    expect(await backend.requestTool('docs', { query: 'roundedCuboid' })).toContain('roundRadius: Number = 0.2')
    expect(JSON.parse(await backend.requestTool('docs', { query: 'roundedCube' })).error.name).toBe('NotFoundError')
  })
})

describe('eval backend grading', () => {
  it('gradeProject measures a project in a fresh state', async () => {
    const backend = createEvalBackend()
    await writeMain(CUBE, backend)
    const graded = await backend.gradeProject({ files: { 'main.js': ESM_SPHERE }, entry: 'main.js' })
    expect(graded.measure.volume).toBeGreaterThan(480)
    expect(graded.measure.volume).toBeLessThan(530)
    expect(graded.solid.watertight).toBe(true)
    expect(graded.params).toContainEqual(expect.objectContaining({ name: 'radius', initial: 5 }))
    expect(await backend.gradeProject(null)).toEqual({ measure: null, solid: null, params: [] })
  })

  it('gradeProject grades nothing for a project with no entry or a failed build', async () => {
    const backend = createEvalBackend()
    expect(await backend.gradeProject({ files: { 'part.js': CUBE }, entry: null })).toEqual({ measure: null, solid: null, params: [] })
    expect(await backend.gradeProject({ files: { 'main.js': 'throw 1' }, entry: 'main.js' })).toEqual({ measure: null, solid: null, params: [] })
  })

  it('gradeProject adds the probe a fixture asks for, and only then', async () => {
    const box = { files: { 'main.js': CUBE }, entry: 'main.js' }
    const graded = await createEvalBackend().gradeProject(box, { probe: { sections: [{ axis: 'z', at: [0.5] }], bodies: {} } })
    expect(graded.probe.sections).toHaveLength(1)
    expect(graded.probe.bodies).toHaveLength(1)
    expect(await createEvalBackend().gradeProject(box)).not.toHaveProperty('probe')
    expect(await createEvalBackend().gradeProject(null, { probe: { bodies: {} } })).toEqual({ measure: null, solid: null, params: [], probe: null })
  })

  it('gradeProject gives up on a model that never finishes', async () => {
    const hang = { files: { 'main.js': 'module.exports = { main: () => new Promise(() => {}) }' }, entry: 'main.js' }
    expect(await createEvalBackend().gradeProject(hang, { timeoutMs: 20 })).toEqual({ measure: null, solid: null, params: [] })
  })
})

describe('eval backend warnings', () => {
  it('returns a warning for an option the function does not take', async () => {
    const res = await writeMain(`const { primitives } = require('@jscad/modeling')
const main = () => primitives.roundedCuboid({ size: [30, 20, 10], radius: 2 })
module.exports = { main }`)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([{ fn: 'primitives.roundedCuboid', option: 'radius', suggestions: ['roundRadius'], file: 'main.js', line: 2 }])
  })

  it('names the line of each call site of a slip', async () => {
    const res = await writeMain(`const jf = require('@jbroll/jscad-fluent')
const a = () => jf.cube({ sise: 10 })
const b = () => jf.cube({ sise: 20 }).translate([30, 0, 0])
module.exports = { main: () => [a(), b(), a()] }`)
    expect(res.warnings).toEqual([
      { fn: 'jf.cube', option: 'sise', suggestions: ['size'], file: 'main.js', line: 2 },
      { fn: 'jf.cube', option: 'sise', suggestions: ['size'], file: 'main.js', line: 3 },
    ])
  })

  it('names fluent factories and stays quiet for fluent internals', async () => {
    const fluent = await writeMain(`const jf = require('@jbroll/jscad-fluent')
const main = () => [jf.cube({ sise: 10 }), jf.circle({ radius: 5 }).extrudeLinear({ height: 10 }).translate([1, 2, 3])]
module.exports = { main }`)
    expect(fluent.warnings).toEqual([{ fn: 'jf.cube', option: 'sise', suggestions: ['size'], file: 'main.js', line: 2 }])
  })

  it('names fluent methods called on shapes', async () => {
    const res = await writeMain(`const jf = require('@jbroll/jscad-fluent')
module.exports = { main: () => jf.circle({ radius: 5 }).extrudeLinear({ hieght: 10 }).center({ axis: [true, true, false] }) }`)
    expect(res.ok).toBe(true)
    expect(res.warnings).toEqual([
      { fn: 'FluentGeom2.extrudeLinear', option: 'hieght', suggestions: ['height'], file: 'main.js', line: 2 },
      { fn: 'FluentGeom3.center', option: 'axis', suggestions: ['axes'], file: 'main.js', line: 2 },
    ])
  })

  it('names unknown options on fluent functions and methods added for modeling parity', async () => {
    const res = await writeMain(`const jf = require('@jbroll/jscad-fluent')
module.exports = { main: () => [
  jf.circle({ radius: 1, center: [5, 0] }).extrudeHelical({ pitchh: 10 }),
  jf.path({ closd: false }, [[0, 0], [10, 0]]).appendArc({ endpoint: [10, 10], radius: [5, 5], clockwize: true }).expand({ delta: 1 }).extrudeLinear({ height: 1 }),
  jf.cube({ size: 4 }).project({ axiss: [0, 0, 1] }).extrudeLinear({ height: 1 }),
  jf.geom3Array(jf.cube({ size: 1 }), jf.cube({ size: 2 })).rotateX(90),
] }`)
    expect(res.ok).toBe(true)
    expect(res.warnings.map(({ fn, option, suggestions }) => ({ fn, option, suggestions }))).toEqual([
      { fn: 'FluentGeom2.extrudeHelical', option: 'pitchh', suggestions: ['pitch'] },
      { fn: 'jf.path', option: 'closd', suggestions: ['closed'] },
      { fn: 'FluentPath2.appendArc', option: 'clockwize', suggestions: ['clockwise'] },
      { fn: 'FluentGeom3.project', option: 'axiss', suggestions: ['axis'] },
      { fn: 'FluentGeometryArray.rotateX', option: 'angle', suggestions: undefined },
    ])
  })

  it('starts each build with no warnings, and reports them on run too', async () => {
    const backend = createEvalBackend()
    const bad = `const { primitives } = require('@jscad/modeling')\nmodule.exports = { main: () => primitives.cube({ sise: 3 }) }`
    expect((await writeMain(bad, backend)).warnings).toHaveLength(1)
    expect((await call(backend, 'run', { source: bad })).warnings).toHaveLength(1)
    expect((await writeMain(CUBE, backend)).warnings).toEqual([])
  })
})

describe('eval backend warnings and error hints follow the api', () => {
  for (const c of WARNING_CASES) {
    it(c.name, async () => {
      const res = JSON.parse(await createEvalBackend({ api: c.api }).requestTool('write', { path: 'main.js', content: c.source }))
      expectCase(expect, c, res)
    })
  }
})
