import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const gridUtilsPath = join(__dirname, '..', 'examples', 'lib', 'grid-utils.js')
const nodeRequire = createRequire(gridUtilsPath)

// The examples package is "type": "module", so Node's require() cannot load it as CommonJS
const loadCjs = (path, req) => {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', readFileSync(path, 'utf-8'))(req, module.exports, module)
  return module.exports
}
const localRequire = (spec) => spec.startsWith('.') ? loadCjs(join(dirname(gridUtilsPath), spec), localRequire) : nodeRequire(spec)
const { gridModule, gridExtent } = loadCjs(gridUtilsPath, localRequire)

const jscad = nodeRequire('@jscad/modeling')
const { cube } = jscad.primitives
const { measureAggregateBoundingBox } = jscad.measurements

const OPTIONS = { spacing: 60, cellSize: 51 }
const FOUR = ['./a.scad', './b.scad', './c.scad', './d.scad']
const model = () => ({ main: () => cube({ size: 10 }) })

// A grid whose items resolve through `modules`; an Error there is thrown by require
const grid = (items, modules, required = []) => gridModule(items, OPTIONS, (url) => {
  required.push(url)
  const mod = modules[url]
  if (mod instanceof Error) throw mod
  if (!mod) throw new Error(`unexpected require ${url}`)
  return mod
})
const leaves = (items) => Object.fromEntries(items.map((url) => [url, model()]))

const box = (geoms) => {
  const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...geoms)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, z1 - z0) }
}

const claimingHook = (lose = []) => {
  const batches = []
  const keys = []
  return {
    batches,
    keys,
    emit: (geoms) => batches.push(geoms),
    progress: () => {},
    claim: async (key) => {
      keys.push(key)
      return !lose.includes(key)
    },
  }
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.__allWasmTrap
  delete globalThis.__jscadStream
})

describe('gridExtent', () => {
  it('spans the cell centres plus one cell', () => {
    expect(gridExtent(1, 60, 51)).toEqual([51, 51])
    expect(gridExtent(4, 60, 51)).toEqual([111, 111])
    expect(gridExtent(5, 60, 51)).toEqual([171, 111])
  })
})

describe('nested grids', () => {
  const s = 51 / 111

  it("places a sub-grid's leaves in its parent's cell, scaled by the sub-grid's item count", async () => {
    const parent = grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': grid(FOUR, leaves(FOUR)) })
    const geoms = await parent.main({})
    expect(geoms).toHaveLength(5)
    // the parent's second cell is at (30, 0); the sub-grid's first at (-30, -30) in its own frame
    const first = box([geoms[1]])
    expect(first.x).toBeCloseTo(30 - 30 * s, 5)
    expect(first.y).toBeCloseTo(-30 * s, 5)
    expect(first.size).toBeCloseTo(51 * s, 5)
    expect(box(geoms.slice(1)).size).toBeCloseTo(51, 5)
  })

  it('draws a one-item sub-grid at the full cell size', async () => {
    const parent = grid(['./sub/ALL.js'], { './sub/ALL.js': grid(['./a.scad'], leaves(['./a.scad'])) })
    const [leaf] = await parent.main({})
    expect(box([leaf]).size).toBeCloseTo(51, 5)
  })

  it('gives a sub-grid its own params namespace', async () => {
    const seen = vi.fn(() => cube({ size: 10 }))
    const parent = grid(['./sub/ALL.js'], { './sub/ALL.js': grid(['./a.scad'], { './a.scad': { main: seen } }) })
    await parent.main({ ALL: { a: { size: 3 } } })
    expect(seen).toHaveBeenCalledWith({ size: 3 })
  })

  it("places a failed leaf's marker in its sub-grid cell", async () => {
    quiet()
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': new Error('boom') })
    const geoms = await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }).main({})
    const marker = box(geoms.filter((g) => g.color))
    expect(marker.size).toBeCloseTo(51 * s, 5)
    expect(marker.x).toBeCloseTo(30 - 30 * s, 5)
    expect(marker.y).toBeCloseTo(-30 * s, 5)
  })

  it("streams a sub-grid's leaves one at a time through the parent's hook, hidden from leaf code", async () => {
    const batches = []
    let seen = 'unset'
    const peek = { main: () => { seen = globalThis.__jscadStream; return cube({ size: 10 }) } }
    const stream = globalThis.__jscadStream = { emit: (geoms) => batches.push(geoms), progress: () => {} }
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': peek })
    expect(await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }).main({})).toEqual([])
    expect(batches).toHaveLength(5)
    expect(seen).toBeNull()
    expect(globalThis.__jscadStream).toBe(stream)
  })
})

describe('claims', () => {
  it('skips a leaf it loses without requiring it', async () => {
    const required = []
    const hook = globalThis.__jscadStream = claimingHook(['1'])
    await grid(['./a.scad', './b.scad', './c.scad'], leaves(['./a.scad', './b.scad', './c.scad']), required).main({})
    expect(hook.keys).toEqual(['0', '1', '2'])
    expect(required).toEqual(['./a.scad', './c.scad'])
    expect(hook.batches).toHaveLength(2)
  })

  it('walks a sub-grid it wins nothing in, requiring only the sub-grid', async () => {
    const required = []
    const hook = globalThis.__jscadStream = claimingHook(['0', '1/0', '1/1', '1/2', '1/3'])
    const sub = grid(FOUR, leaves(FOUR), required)
    await grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': sub }, required).main({})
    expect(hook.keys).toEqual(['0', '1/0', '1/1', '1/2', '1/3'])
    expect(required).toEqual(['./sub/ALL.js'])
  })

  it('claims the same keys on every walk', async () => {
    const parent = grid(['./x.scad', './sub/ALL.js'], { './x.scad': model(), './sub/ALL.js': grid(FOUR, leaves(FOUR)) })
    const walk = async () => {
      const hook = globalThis.__jscadStream = claimingHook()
      await parent.main({})
      return hook.keys
    }
    expect(await walk()).toEqual(await walk())
  })

  it('stops claiming after a trap and marks the trapped leaf with the stored skull', async () => {
    quiet()
    const hook = globalThis.__jscadStream = claimingHook()
    const items = ['./a.scad', './b.scad', './c.scad']
    const trap = new WebAssembly.RuntimeError('unreachable')
    expect(await grid(items, { ...leaves(items), './b.scad': trap }).main({})).toEqual([])
    expect(hook.keys).toEqual(['0', '1'])
    const skull = hook.batches[1].flat(Infinity)
    expect(skull.every((layer) => layer.transforms.length === 16 && !layer.isManifoldGeom3)).toBe(true)
  })

  it('marks a sub-grid that fails to load only on the worker that claims it', async () => {
    const error = quiet()
    const items = ['./x.scad', './sub/ALL.js']
    const modules = { './x.scad': model(), './sub/ALL.js': new Error('bad sub-grid') }
    const winner = globalThis.__jscadStream = claimingHook()
    await grid(items, modules).main({})
    expect(winner.keys).toEqual(['0', '1'])
    expect(winner.batches).toHaveLength(2)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^ALL: FAILED \.\/sub\/ALL\.js/))

    error.mockClear()
    const loser = globalThis.__jscadStream = claimingHook(['1'])
    await grid(items, modules).main({})
    expect(loser.keys).toEqual(['0', '1'])
    expect(loser.batches).toHaveLength(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('fits a sub-grid module that exports no extent into one cell', async () => {
    const { extent: _extent, ...sub } = grid(['./a.scad'], leaves(['./a.scad']))
    const [leaf] = await grid(['./sub/ALL.js'], { './sub/ALL.js': sub }).main({})
    expect(box([leaf]).size).toBeCloseTo(51, 5)
  })

  it('stops the parent too when a sub-grid leaf traps', async () => {
    quiet()
    const hook = globalThis.__jscadStream = claimingHook()
    const sub = grid(FOUR, { ...leaves(FOUR), './a.scad': new WebAssembly.RuntimeError('unreachable') })
    await grid(['./sub/ALL.js', './y.scad'], { './sub/ALL.js': sub, './y.scad': model() }).main({})
    expect(hook.keys).toEqual(['0/0'])
  })
})
