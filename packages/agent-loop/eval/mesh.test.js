import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createEvalBackend } from './backend.js'
import { collectMesh, MAX_MESH_BYTES, MAX_MESH_PAGES, meshPage, meshPages, meshSha256 } from './mesh.js'

const { colors, primitives } = createRequire(import.meta.url)('@jscad/modeling')
const served = (mesh) => async (index) => meshPage(mesh, index)
const floats = (values) => Buffer.from(new Float32Array(values).buffer).toString('base64')
const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0]
const page = (piece = {}, extra = {}) => ({ pages: 1, bytes: 36, pieces: [{ part: 0, color: null, data: floats(TRIANGLE), ...piece }], ...extra })
const BIG = () => primitives.sphere({ radius: 10, segments: 256 })

describe('meshPages and collectMesh', () => {
  it('sends each part with its colour and whole triangles', async () => {
    const red = colors.colorize([1, 0, 0], primitives.cuboid({ size: [20, 10, 5] }))
    const plain = primitives.sphere({ radius: 3, segments: 8 })
    const { parts } = await collectMesh(served(meshPages([red, plain])))
    expect(parts).toHaveLength(2)
    expect(parts[0].color).toEqual([1, 0, 0])
    expect(parts[1].color).toBeNull()
    expect(parts[0].positions.length).toBe(12 * 9)
    expect(parts[1].positions.length % 9).toBe(0)
  })

  it('packs many small parts into one page, each with its own colour', async () => {
    const cubes = Array.from({ length: 62 }, (_, i) => colors.colorize([i / 62, 0, 0], primitives.cuboid({ size: [1, 1, 1], center: [i * 2, 0, 0] })))
    const mesh = meshPages(cubes)
    expect(mesh.pages).toHaveLength(1)
    const { parts } = await collectMesh(served(mesh))
    expect(parts.map((p) => p.color)).toEqual(cubes.map((_, i) => [i / 62, 0, 0]))
    expect(parts.every((p) => p.positions.length === 12 * 9)).toBe(true)
  })

  it('splits a large part across pages and joins it back in order', async () => {
    const mesh = meshPages(BIG())
    expect(mesh.pages.length).toBeGreaterThan(1)
    const { parts } = await collectMesh(served(mesh))
    expect(parts).toHaveLength(1)
    expect(parts[0].positions.length).toBe(mesh.bytes / 4)
  })

  it('splits a part that crosses a page and keeps the parts either side of it', async () => {
    const mesh = meshPages([primitives.cuboid({ size: [1, 1, 1] }), BIG(), primitives.cuboid({ size: [2, 2, 2] })])
    expect(mesh.pages[0].map((p) => p.part)).toEqual([0, 1])
    expect(mesh.pages.at(-1).map((p) => p.part)).toEqual([1, 2])
    const { parts } = await collectMesh(served(mesh))
    expect(parts.map((p) => p.positions.length)).toEqual([12 * 9, mesh.bytes / 4 - 24 * 9, 12 * 9])
  })

  it('keeps every page of one-triangle parts under the reply cap', () => {
    const color = [0.1234567890123456, 0.7803921568627451, 1e-7]
    const tiny = Array.from({ length: 30_000 }, (_, i) => ({ color, toPolygons: () => [{ vertices: [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]] }] }))
    const mesh = meshPages(tiny)
    expect(mesh.pages.length).toBeGreaterThan(1)
    for (let index = 0; index < mesh.pages.length; index += 1) expect(JSON.stringify(meshPage(mesh, index)).length).toBeLessThan(1024 * 1024)
  })

  it('hashes the same model the same way and a moved one differently', async () => {
    const at = async (x) => meshSha256((await collectMesh(served(meshPages(primitives.cuboid({ size: [10, 10, 10], center: [x, 0, 0] }))))).parts)
    expect(await at(0)).toBe(await at(0))
    expect(await at(0)).not.toBe(await at(1))
    expect(await at(0)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sends no pages for a model over the size limit', () => {
    const polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }
    const huge = { measureBoundingBox: () => [[0, 0, 0], [1, 1, 0]], toPolygons: () => new Array(Math.floor(MAX_MESH_BYTES / 36) + 1).fill(polygon) }
    const mesh = meshPages(huge)
    expect(mesh.pages).toEqual([])
    expect(mesh.bytes).toBeGreaterThan(MAX_MESH_BYTES)
  })

  it.each([
    ['a malformed first reply', [null], /malformed/],
    ['a size over the limit', [{ pages: 0, bytes: MAX_MESH_BYTES + 1 }], /over the/],
    ['too many pages', [{ pages: MAX_MESH_PAGES + 1, bytes: 36 }], /page limit/],
    ['no triangles', [{ pages: 0, bytes: 0 }], /no triangles/],
    ['a page with no pieces', [page({}, { pieces: [] })], /malformed/],
    ['a count that is not whole triangles', [page({ data: floats([0, 0, 0, 1, 0, 0, 0, 1]) })], /whole triangles/],
    ['a NaN', [page({ data: floats([NaN, 0, 0, 1, 0, 0, 0, 1, 0]) })], /finite/],
    ['text that is not base64', [page({ data: 'not base64!' })], /whole triangles/],
    ['a colour out of range', [page({ color: [2, 0, 0] })], /malformed/],
    ['a page count that changes', [page({}, { pages: 2, bytes: 72 }), page({}, { pages: 3 })], /malformed/],
    ['a part out of order', [page({ part: 1 }, { pages: 2, bytes: 72 }), page({ part: 0 }, { pages: 2 })], /malformed/],
    ['a part whose colour changes between pages', [page({}, { pages: 2, bytes: 72 }), page({ color: [1, 0, 0] }, { pages: 2 })], /malformed/],
  ])('refuses %s', async (_name, replies, error) => {
    expect((await collectMesh(async (index) => replies[index])).error).toMatch(error)
  })

  it('joins a part carried over from one page to the next', async () => {
    const replies = [page({}, { pages: 2, bytes: 72 }), page({}, { pages: 2 })]
    const { parts } = await collectMesh(async (index) => replies[index])
    expect(parts).toHaveLength(1)
    expect(parts[0].positions.length).toBe(18)
  })
})

describe('the eval backend', () => {
  const CUBE = 'const jf = require("@jbroll/jscad-fluent")\nmodule.exports = { main: () => [jf.cube({ size: 20 }).colorize([0, 0, 1])] }'

  it('answers mesh with no pages before anything built', async () => {
    expect(await createEvalBackend().mesh(0)).toEqual({ pages: 0, bytes: 0 })
  })

  it('adds the graded model mesh to a grade that asks for it', async () => {
    const graded = await createEvalBackend().gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' }, { mesh: true })
    expect(graded.mesh.parts).toHaveLength(1)
    expect(graded.mesh.parts[0].color).toEqual([0, 0, 1])
    expect(graded.mesh.parts[0].positions.length).toBe(12 * 9)
  })

  it('leaves the mesh out of a grade that does not ask for it', async () => {
    const graded = await createEvalBackend().gradeProject({ files: { 'main.js': CUBE }, entry: 'main.js' })
    expect(graded).not.toHaveProperty('mesh')
  })
})
