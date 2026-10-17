import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

const examplesDir = join(__dirname, '..', 'examples')
const gridPath = join(examplesDir, 'openscad', 'text', 'ALL.js')
const gridUtilsPath = join(examplesDir, 'lib', 'grid-utils.js')

const jscad = nodeRequire('@jscad/modeling')
const { cube } = jscad.primitives
const { measureAggregateBoundingBox } = jscad.measurements

// V1 .jscad geometry (classic CSG, from the app's CSG-compat shim path) for the
// V1 grid tests below. Modeling's measure/transform silently ignore it (zero
// bbox, no-op placement), so the grid must handle it via getBounds/translate.
const v1csg = nodeRequire('@jscad/csg/api.js')
const v1cube = () => v1csg.primitives3d.cube({ size: 10 })
const v1Bounds = (g) => {
  const [a, b] = g.getBounds()
  return [[a.x, a.y, a.z], [b.x, b.y, b.z]]
}

const items = JSON.parse(readFileSync(gridPath, 'utf-8').match(/const items = (\[[\s\S]*?\])/)[1])

const loadCjs = (path, req) => {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', readFileSync(path, 'utf-8'))(
    req, module.exports, module,
  )
  return module.exports
}

// The examples package is "type": "module", so Node's real require() can't load a local
// .js file as CommonJS; eval it, resolving grid-utils.js's own relative requires by hand.
const loadGridUtils = () => {
  const localRequire = (spec) => spec.startsWith('.') ? loadCjs(resolve(dirname(gridUtilsPath), spec), localRequire) : nodeRequire(spec)
  return loadCjs(gridUtilsPath, localRequire)
}

/**
 * Run a generated ALL.js with every model stubbed out, except the ones named
 * in `broken`, whose require throws.
 */
const runGrid = (broken = [], { trap = [], models = {}, utils = {} } = {}) => {
  const req = (name) => {
    if (name.endsWith('grid-utils.js')) {
      return { ...loadGridUtils(), ...utils }
    }
    if (broken.includes(name)) throw new Error(`boom in ${name}`)
    if (trap.includes(name)) throw new WebAssembly.RuntimeError('function signature mismatch')
    return { main: models[name] ?? (() => cube({ size: 10 })) }
  }
  return loadCjs(gridPath, req).main({})
}

const failureLines = async (run) => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await run()
    return errors.mock.calls.map(args => args.join(' '))
  } finally {
    errors.mockRestore()
  }
}

afterEach(() => {
  delete globalThis.__allWasmTrap
  delete globalThis.__jscadScriptGeneration
  delete globalThis.__jscadStream
  delete globalThis.__jscadProgress
})

describe('generated ALL.js grid', () => {
  it('renders every cell when nothing fails', async () => {
    const geoms = await runGrid()
    expect(geoms.length).toBe(11)
  })

  it('awaits a cell whose main is async, as a nested grid is', async () => {
    const geoms = await runGrid([], { models: { './text-fonts.scad': async () => cube({ size: 10 }) } })
    expect(geoms.length).toBe(11)
  })

  // The grid yields via MessageChannel (grid-utils yieldToEventLoop), not via
  // timers, so wall-clock tick counting flakes under load: a 0ms interval is
  // not guaranteed a timer phase between two message callbacks. Count the
  // yield mechanism itself instead — fully deterministic, no timing.
  it('yields to the event loop after each cell', async () => {
    const RealChannel = globalThis.MessageChannel
    expect(typeof RealChannel).toBe('function')
    let yields = 0
    function CountingChannel(...args) {
      yields++
      return new RealChannel(...args)
    }
    CountingChannel.prototype = RealChannel.prototype
    globalThis.MessageChannel = CountingChannel
    const counting = () => cube({ size: 10 })
    try {
      await runGrid([], { models: { './text-fonts.scad': counting, './text-sizes.scad': counting } })
    } finally {
      globalThis.MessageChannel = RealChannel
    }
    expect(yields).toBe(11)
  })

  it('stops at the next cell once a newer script starts', async () => {
    globalThis.__jscadScriptGeneration = 1
    const ran = []
    const newerScript = () => { globalThis.__jscadScriptGeneration = 2; return cube({ size: 10 }) }
    const record = (name) => () => { ran.push(name); return cube({ size: 10 }) }
    await expect(runGrid([], {
      models: { './text-fonts.scad': newerScript, './text-sizes.scad': record('sizes') },
    })).rejects.toThrow(/superseded/)
    expect(ran).toEqual([])
  })

  it('keeps the other cells when one model throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const geoms = await runGrid(['./text-fonts.scad'])
      expect(geoms.filter(g => !g.color).length).toBe(10)
    } finally {
      errors.mockRestore()
    }
  })

  it('places the marker in the failed cell, at the cell size', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let geoms
    try {
      geoms = await runGrid(['./text-fonts.scad'])
    } finally {
      errors.mockRestore()
    }

    const marker = geoms.filter(g => g.color)
    expect(marker.length).toBeGreaterThan(0)

    const [[x0, y0, z0], [x1, y1, z1]] = measureAggregateBoundingBox(...marker)
    expect(Math.max(x1 - x0, y1 - y0, z1 - z0)).toBeCloseTo(51, 5)
    expect((z0 + z1) / 2).toBeCloseTo(0, 5)

    // Cell 3 of 11: grid is 4 wide, spacing 60, centred on the origin
    expect((x0 + x1) / 2).toBeCloseTo(90, 5)
  })

  it('reports each failure and a summary for the test harness', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let lines
    try {
      await runGrid(['./text-fonts.scad', './text-sizes.scad'])
      lines = errors.mock.calls.map(args => args.join(' '))
    } finally {
      errors.mockRestore()
    }

    expect(lines).toContain('ALL: FAILED ./text-fonts.scad: boom in ./text-fonts.scad')
    expect(lines).toContain('ALL: FAILED ./text-sizes.scad: boom in ./text-sizes.scad')
    expect(lines).toContain('ALL: 2/11 models failed: ./text-fonts.scad ./text-sizes.scad')
  })

  it('fails every cell after a wasm trap instead of trusting it', async () => {
    const lines = await failureLines(() => runGrid([], { trap: ['./text-fonts.scad'] }))
    expect(lines).toContain('ALL: FAILED ./text-fonts.scad: function signature mismatch')
    expect(lines).toContain('ALL: FAILED ./text-sizes.scad: not run: wasm trapped in ./text-fonts.scad')
    expect(lines.at(-1)).toMatch(/^ALL: \d+\/11 models failed: \.\/text-fonts\.scad /)
  })

  it('fails cells before the trap only if they threw', async () => {
    const lines = await failureLines(() => runGrid([], { trap: ['./text-sizes.scad'] }))
    expect(lines.some(l => l.startsWith('ALL: FAILED ./text-fonts.scad'))).toBe(false)
  })

  it('keeps an ordinary error from poisoning later cells', async () => {
    const lines = await failureLines(() => runGrid(['./text-fonts.scad']))
    expect(lines.filter(l => l.startsWith('ALL: FAILED '))).toHaveLength(1)
  })

  it('exports runGrid and its extent, so a parent grid can nest it', () => {
    const grid = loadCjs(gridPath, (name) => name.endsWith('grid-utils.js') ? loadGridUtils() : { main: () => cube({ size: 10 }) })
    expect(typeof grid.runGrid).toBe('function')
    expect(grid.extent).toEqual([4 * 60 - 60 + 51, 3 * 60 - 60 + 51])
  })
})

describe('streaming', () => {
  const hook = () => {
    const batches = []
    return { batches, emit: vi.fn(geoms => batches.push(geoms)), progress: vi.fn() }
  }

  it('emits each cell in order and returns nothing', async () => {
    const stream = globalThis.__jscadStream = hook()
    const geoms = await runGrid()
    expect(geoms).toEqual([])
    expect(stream.batches).toHaveLength(11)
    const centres = stream.batches.map(b => measureAggregateBoundingBox(...b)).map(([[x0], [x1]]) => (x0 + x1) / 2)
    expect(centres[0]).toBeCloseTo(-90, 5)
    expect(centres[1]).toBeCloseTo(-30, 5)
  })

  it('disposes each placed geometry after it is sent', async () => {
    // custom properties on a real geom, such as a manifold's dispose, survive normalizeAndPlace's transforms
    const disposed = []
    const tracked = () => {
      const g = cube({ size: 10 })
      g.dispose = vi.fn()
      disposed.push(g)
      return g
    }
    globalThis.__jscadStream = hook()
    await runGrid([], { models: Object.fromEntries(items.map((url) => [url, tracked])) })
    expect(disposed).toHaveLength(11)
    for (const g of disposed) expect(g.dispose).toHaveBeenCalledOnce()
  })

  it('hides the hook from leaf code', async () => {
    const stream = globalThis.__jscadStream = hook()
    let seen = 'unset'
    const nested = async () => { seen = globalThis.__jscadStream; return cube({ size: 10 }) }
    await runGrid([], { models: { './text-fonts.scad': nested } })
    expect(seen).toBeNull()
    expect(globalThis.__jscadStream).toBe(stream)
  })

  it('emits the prebuilt skull for every cell after a trap', async () => {
    const stream = globalThis.__jscadStream = hook()
    await failureLines(() => runGrid([], { trap: ['./text-fonts.scad'] }))
    const trapped = items.indexOf('./text-fonts.scad')
    for (const batch of stream.batches.slice(trapped)) {
      // the stream hook flattens the nested [prebuiltSkull()] before converting
      const skull = batch.flat(Infinity)
      expect(skull).toHaveLength(2)
      expect(skull.every(g => g.transforms.length === 16 && !g.isManifoldGeom3)).toBe(true)
      expect(skull.map(g => g.color)).toEqual([[0.95, 0.95, 0.92, 1], [0.1, 0.1, 0.1, 1]])
    }
  })

  it('turns a failure inside emit into that cell\'s marker', async () => {
    const stream = hook()
    let calls = 0
    stream.emit = vi.fn(geoms => { if (calls++ === 0) throw new Error('numTri failed'); stream.batches.push(geoms) })
    globalThis.__jscadStream = stream
    const lines = await failureLines(() => runGrid())
    expect(lines[0]).toMatch(/^ALL: FAILED .*: numTri failed$/)
    expect(stream.batches).toHaveLength(11)
  })

  it('awaits an async stream emit before settling the run', async () => {
    let resolveEmit
    const gate = new Promise(r => { resolveEmit = r })
    const stream = globalThis.__jscadStream = { emit: vi.fn(() => gate), progress: vi.fn() }
    let settled = false
    const run = runGrid().then(() => { settled = true })
    const start = Date.now()
    while (stream.emit.mock.calls.length === 0 && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 10))
    }
    expect(stream.emit).toHaveBeenCalled()
    // An unawaited emit would let all 11 cells settle in milliseconds.
    await new Promise(r => setTimeout(r, 100))
    expect(settled).toBe(false)
    resolveEmit()
    await run
    expect(settled).toBe(true)
  })
})

describe('progress without streaming', () => {
  it('calls __jscadProgress once per cell and returns the geometry', async () => {
    globalThis.__jscadProgress = vi.fn()
    const geoms = await runGrid()
    expect(globalThis.__jscadProgress).toHaveBeenCalledTimes(11)
    expect(geoms).toHaveLength(11)
  })
})

describe('V1 CSG cells (.jscad via the CSG shim)', () => {
  it('places a V1 cell instead of silently dropping it', async () => {
    const geoms = await runGrid([], { models: { './text-fonts.scad': v1cube } })
    // 10 modeling cubes + the V1 cube: no failure marker, nothing dropped
    expect(geoms).toHaveLength(11)
    expect(geoms.filter(g => g.color)).toHaveLength(0)
    // Item 3 of 11 sits at gridPosition(3, 11, 60) == (90, -60)
    const v1 = geoms.filter(g => typeof g.getBounds === 'function')
    expect(v1).toHaveLength(1)
    const [[x0, y0, z0], [x1, y1, z1]] = v1Bounds(v1[0])
    expect(Math.max(x1 - x0, y1 - y0, z1 - z0)).toBeCloseTo(51, 5)
    expect((x0 + x1) / 2).toBeCloseTo(90, 5)
    expect((y0 + y1) / 2).toBeCloseTo(-60, 5)
  })

  it('normalizes a V1 geometry to the cell size at the grid position', () => {
    const { normalizeAndPlace } = loadGridUtils()
    const [placed] = normalizeAndPlace([v1cube()], 30, -60, 51)
    expect(placed).toBeDefined()
    const [[x0, y0, z0], [x1, y1, z1]] = v1Bounds(placed)
    expect(Math.max(x1 - x0, y1 - y0, z1 - z0)).toBeCloseTo(51, 5)
    expect((x0 + x1) / 2).toBeCloseTo(30, 5)
    expect((y0 + y1) / 2).toBeCloseTo(-60, 5)
  })
})
