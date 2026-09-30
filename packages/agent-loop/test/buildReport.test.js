import { describe, expect, it } from 'vitest'
import { buildReport, errorLocation, NO_ENTRY_NOTE, noEntryReport, previewValue, reportParams, noGeometryError, summarizeRun, writeReport } from '../src/buildReport.js'

const BASE = 'http://project.local/'

describe('buildReport', () => {
  const measured = {
    boundingBox: [
      [-10, -10, 0],
      [10, 10, 20.000000001],
    ],
    dimensions: [20, 20, 20.000000001],
    center: [0, 0, 10],
    volume: 7999.99999,
    polygonCount: 6,
    entityCount: 2,
  }

  it('reports a build that succeeds with its geometry, in the contract order', () => {
    const report = buildReport({
      entry: 'main.js',
      warnings: [{ fn: 'jf.cube', option: 'sise' }],
      console: ['hi'],
      params: [{ name: 'size', type: 'slider', label: 'size', initial: 5, min: 1, max: 9, step: undefined }],
      measured,
      checked: { watertight: true, manifold: true, selfIntersecting: false },
    })
    expect(report).toEqual({
      ok: true,
      entry: 'main.js',
      warnings: [{ fn: 'jf.cube', option: 'sise' }],
      console: ['hi'],
      params: [{ name: 'size', type: 'slider', default: 5, min: 1, max: 9 }],
      geometry: {
        parts: 2,
        boundingBox: [
          [-10, -10, 0],
          [10, 10, 20],
        ],
        dimensions: [20, 20, 20],
        volume: 8000,
        watertight: true,
        manifold: true,
        selfIntersecting: false,
      },
    })
    expect(Object.keys(report)).toEqual(['ok', 'entry', 'warnings', 'console', 'params', 'geometry'])
  })

  it('reports a failed build with its error location and no geometry', () => {
    const report = buildReport({ entry: 'main.js', error: { name: 'TypeError', message: 'x is not a function', file: 'main.js', line: 3, column: 7 }, console: ['before'] })
    expect(report).toEqual({
      ok: false,
      entry: 'main.js',
      error: { name: 'TypeError', message: 'x is not a function', file: 'main.js', line: 3, column: 7 },
      warnings: [],
      console: ['before'],
      params: [],
    })
  })

  it('reports a project with no entry as built, with nothing to build', () => {
    expect(noEntryReport()).toEqual({ ok: true, entry: null, note: NO_ENTRY_NOTE, warnings: [], console: [], params: [] })
    expect(NO_ENTRY_NOTE).toBe('no entry yet (main.js, index.js or package.json main)')
  })

  it('leaves out group rows and unset fields from the params', () => {
    expect(reportParams([{ name: '_group_x', type: 'group', caption: 'X' }, { name: 'n', type: 'choice', initial: 'a', values: ['a', 'b'] }])).toEqual([
      { name: 'n', type: 'choice', default: 'a', values: ['a', 'b'] },
    ])
  })
})

describe('errorLocation', () => {
  it('reads a Babel syntax error location, 1-based', () => {
    const error = Object.assign(new SyntaxError('http://project.local/part.js: Unexpected token (2:10)'), { loc: { line: 2, column: 10 } })
    expect(errorLocation(error, BASE)).toEqual({ file: 'part.js', line: 2, column: 11 })
    expect(errorLocation(Object.assign(error, { file: 'other.js' }), BASE)).toEqual({ file: 'other.js', line: 2, column: 11 })
  })

  it('reads the first project frame of a stack, in V8 and Firefox formats', () => {
    const v8 = { stack: 'Error: bad\n    at helper (/repo/node_modules/x.js:1:1)\n    at main (http://project.local/lib/part.js:12:5)\n    at http://project.local/main.js:3:1' }
    expect(errorLocation(v8, BASE)).toEqual({ file: 'lib/part.js', line: 12, column: 5 })
    expect(errorLocation({ stack: 'main@http://project.local/main.js:4:9\n' }, BASE)).toEqual({ file: 'main.js', line: 4, column: 9 })
  })

  it('is empty when nothing names a project file', () => {
    expect(errorLocation({ stack: 'Error: x\n    at y (/repo/z.js:1:1)' }, BASE)).toEqual({})
    expect(errorLocation(undefined, BASE)).toEqual({})
  })
})

describe('previewValue', () => {
  it('shows a value as JSON, functions by name, and caps a long one', () => {
    expect(previewValue({ a: 1, f: function area() {} })).toBe('{"a":1,"f":"[Function area]"}')
    expect(previewValue(undefined)).toBe('undefined')
    const loop = { a: 1 }
    loop.self = loop
    expect(previewValue(loop)).toBe('{"a":1,"self":"[Circular]"}')
    expect(previewValue([1, 2, 3, 4, 5, 6], 5)).toBe('[1,2,… (8 more characters)')
  })
})

describe('summarizeRun', () => {
  const cube = { polygons: [] }
  const measure = (items) => ({ entityCount: items.length, boundingBox: [[0, 0, 0], [10, 10, 10]], dimensions: [10, 10, 10], volume: 1000 })

  it("summarizes geometry a main returned with the measure it is given", () => {
    expect(summarizeRun({ hasMain: true, value: [cube, [cube]] }, measure)).toEqual({
      geometry: { parts: 2, boundingBox: [[0, 0, 0], [10, 10, 10]], dimensions: [10, 10, 10], volume: 1000 },
    })
  })

  it('adds watertight, manifold and selfIntersecting from the check it is given, as a build report does', () => {
    const check = (items) => ({ watertight: items.length === 1, manifold: true, selfIntersecting: false, openEdges: 0 })
    expect(summarizeRun({ hasMain: true, value: cube }, measure, check)).toEqual({
      geometry: { parts: 1, boundingBox: [[0, 0, 0], [10, 10, 10]], dimensions: [10, 10, 10], volume: 1000, watertight: true, manifold: true, selfIntersecting: false },
    })
  })

  it('previews any other value a main returned', () => {
    expect(summarizeRun({ hasMain: true, value: { width: 3 } }, measure)).toEqual({ returned: '{"width":3}' })
    expect(summarizeRun({ hasMain: true, value: [] }, measure)).toEqual({ returned: '[]' })
  })

  it("previews a module's exports without the loader's self default, and nothing for empty exports", () => {
    const exports = { size: 10 }
    exports.default = exports
    expect(summarizeRun({ hasMain: false, value: exports }, measure)).toEqual({ returned: '{"size":10}' })
    const empty = {}
    empty.default = empty
    expect(summarizeRun({ hasMain: false, value: empty }, measure)).toEqual({})
  })
})

describe('writeReport', () => {
  const failed = buildReport({ entry: 'main.js', error: { name: 'RangeError', message: 'too big' } })

  it('names the file saved ahead of the build report', () => {
    const built = buildReport({ entry: 'main.js' })
    expect(writeReport('parts/lid.js', built)).toEqual({ saved: 'parts/lid.js', ...built })
    expect(Object.keys(writeReport('main.js', built))[0]).toBe('saved')
  })

  it('says the write stuck when the build failed', () => {
    expect(writeReport('main.js', failed)).toEqual({ saved: 'main.js', ...failed, note: 'main.js is saved; the build of main.js failed' })
  })

  it('says a helper written before any entry is saved', () => {
    expect(writeReport('layout.js', noEntryReport())).toMatchObject({ saved: 'layout.js', ok: true, entry: null, note: `saved; ${NO_ENTRY_NOTE}` })
  })
})

describe('noGeometryError', () => {
  it('names the missing entry when nothing was built', () => {
    expect(noGeometryError(noEntryReport()).error.message).toBe(`no geometry: ${NO_ENTRY_NOTE}`)
  })

  it('asks for a model before any build, and names the failed build after one', () => {
    expect(noGeometryError(null)).toEqual({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: write the model first' } })
    const failed = buildReport({ entry: 'main.js', error: { name: 'TypeError', message: 'x is not a function\n  at main.js:2' } })
    expect(noGeometryError(failed).error.message).toBe('no geometry: the last build failed (x is not a function); fix it first')
  })
})
