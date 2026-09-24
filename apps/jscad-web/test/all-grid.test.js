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

  it('yields to the event loop after each cell', async () => {
    const ticks = []
    let tick = 0
    const timer = setInterval(() => tick++, 0)
    const counting = () => { ticks.push(tick); return cube({ size: 10 }) }
    try {
      await runGrid([], { models: { './text-fonts.scad': counting, './text-sizes.scad': counting } })
    } finally {
      clearInterval(timer)
    }
    expect(ticks[1]).toBeGreaterThan(ticks[0])
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
    const placed = []
    const normalizeAndPlace = () => { const g = { dispose: vi.fn() }; placed.push(g); return [g] }
    globalThis.__jscadStream = hook()
    await runGrid([], { utils: { normalizeAndPlace } })
    expect(placed).toHaveLength(11)
    for (const g of placed) expect(g.dispose).toHaveBeenCalledOnce()
  })

  it('hides the hook from a nested grid, which returns its geometry', async () => {
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
})

describe('progress without streaming', () => {
  it('calls __jscadProgress once per cell and returns the geometry', async () => {
    globalThis.__jscadProgress = vi.fn()
    const geoms = await runGrid()
    expect(globalThis.__jscadProgress).toHaveBeenCalledTimes(11)
    expect(geoms).toHaveLength(11)
  })
})
