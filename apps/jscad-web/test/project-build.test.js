import { describe, expect, it, vi } from 'vitest'
import index from '@jscadui/agent-loop/api/index.json'
import { NO_ENTRY } from '@jscadui/agent-loop'
import { createProjectBuilds, projectEntry, reportError } from '../src/projectBuild.js'

const measured = { entityCount: 1, boundingBox: [[0, 0, 0], [10, 20, 30]], dimensions: [10, 20, 30], volume: 6000 }
const checked = { ok: true, watertight: true, manifold: true }

const builds = (overrides = {}) =>
  createProjectBuilds({
    measure: vi.fn(async () => measured),
    check: vi.fn(async () => checked),
    ...overrides,
  })

describe('projectEntry', () => {
  it('follows Node: package.json main, then index.js, then main.js', () => {
    expect(projectEntry({ 'main.js': '', 'index.js': '' }, 'main.js')).toBe('index.js')
    expect(projectEntry({ 'main.js': '', 'package.json': '{"main":"src/gear.js"}', 'src/gear.js': '' })).toBe('src/gear.js')
  })

  it("falls back to the project's declared entry, which a dropped folder names by its own rule", () => {
    expect(projectEntry({ 'gear.js': '', 'lib.js': '' }, '/gear.js')).toBe('gear.js')
    expect(projectEntry({ 'gear.js': '' }, 'missing.js')).toBe(null)
    expect(projectEntry({ 'gear.js': '' })).toBe(null)
  })
})

describe('reportError', () => {
  it("drops the worker's jscadMain prefix and locates the error in the project from its stack", () => {
    const error = { name: 'TypeError', message: 'jscadMain failed: x is not a function', stack: 'TypeError: x\n    at main (http://project.local/parts/gear.js:4:11)' }
    expect(reportError(error)).toEqual({ name: 'TypeError', message: 'x is not a function', file: 'parts/gear.js', line: 4, column: 11 })
  })

  it("locates a syntax error from the line and column Babel's message names", () => {
    const error = { name: 'SyntaxError', message: 'Babel transform failed for http://project.local/main.js: /http:/project.local/main.js: Unexpected token, expected "," (2:35)\n\n> 2 | x' }
    expect(reportError(error)).toMatchObject({ name: 'SyntaxError', file: 'main.js', line: 2, column: 36 })
  })

  it('adds the hint for the chat api', () => {
    const error = { name: 'TypeError', message: 'jf.measureVolume is not a function' }
    expect(reportError(error, { api: 'fluent', index }).message).toContain('measureVolume is a method of FluentGeom3')
  })
})

describe('createProjectBuilds', () => {
  it('has no report before any build of the project', async () => {
    expect(await builds().report()).toBe(null)
  })

  it("reports a project load with its warnings, console, params and the measured geometry", async () => {
    const b = builds()
    b.recordLoad('http://project.local/main.js', {
      result: { warnings: [{ fn: 'cuboid', option: 'radius' }], console: ['hi'], def: [{ name: 'width', type: 'number', initial: 10 }] },
    })
    expect(await b.report()).toEqual({
      ok: true,
      entry: 'main.js',
      warnings: [{ fn: 'cuboid', option: 'radius' }],
      console: ['hi'],
      params: [{ name: 'width', type: 'number', default: 10 }],
      geometry: { parts: 1, boundingBox: [[0, 0, 0], [10, 20, 30]], dimensions: [10, 20, 30], volume: 6000, watertight: true },
    })
  })

  it('measures an editor build only when its report is asked for, and once', async () => {
    const measure = vi.fn(async () => measured)
    const b = builds({ measure })
    b.recordLoad('http://project.local/main.js', { result: {} })
    expect(measure).not.toHaveBeenCalled()
    await b.report()
    await b.report()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("reports a failed load with the run's console and warnings, and no geometry", async () => {
    const b = builds()
    const error = Object.assign(new Error('jscadMain failed: boom'), { output: { console: ['got here'], warnings: [] } })
    error.stack = 'Error: boom\n    at main (http://project.local/main.js:3:9)'
    b.recordLoad('http://project.local/main.js', { error })
    expect(await b.report()).toEqual({
      ok: false,
      entry: 'main.js',
      error: { name: 'Error', message: 'boom', file: 'main.js', line: 3, column: 9 },
      warnings: [],
      console: ['got here'],
      params: [],
    })
  })

  it('reports a project with no entry file', async () => {
    const b = builds()
    b.recordNoEntry()
    expect(await b.report()).toMatchObject({ ok: false, entry: null, error: { name: 'NoEntryError', message: NO_ENTRY } })
  })

  it('forgets the project build when something else is loaded, since the frame no longer holds it', async () => {
    const b = builds()
    b.recordLoad('http://project.local/main.js', { result: {} })
    b.recordLoad('https://jscad.rkroll.com/examples/jscad/01-two-cars.example.js', { result: {} })
    expect(await b.report()).toBe(null)
  })

  it("lets measure, check and export run only on a build that succeeded, naming the failed build's error", async () => {
    const b = builds()
    expect(await b.noGeometry()).toEqual({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: write the model first' } })
    b.recordLoad('http://project.local/main.js', { error: new Error('jscadMain failed: boom') })
    expect(await b.noGeometry()).toEqual({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: the last build failed (boom); fix it first' } })
    b.recordLoad('http://project.local/main.js', { result: {} })
    expect(await b.noGeometry()).toBe(null)
  })

  it('reports a build whose geometry cannot be measured as having none', async () => {
    const b = builds({ measure: vi.fn(async () => { throw new Error('not a geometry') }) })
    b.recordLoad('http://project.local/main.js', { result: {} })
    expect(await b.report()).toMatchObject({ ok: false, error: { name: 'NoGeometryError', message: 'main() returned something that is not geometry: not a geometry' } })
  })
})
