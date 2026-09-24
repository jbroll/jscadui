import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)

const examplesDir = join(__dirname, '..', 'examples')
const gridPath = join(examplesDir, 'openscad', 'text', 'ALL.js')

const jscad = nodeRequire('@jscad/modeling')
const { cube } = jscad.primitives
const { measureAggregateBoundingBox } = jscad.measurements

const loadCjs = (path, req) => {
  const module = { exports: {} }
  new Function('require', 'exports', 'module', readFileSync(path, 'utf-8'))(
    req, module.exports, module,
  )
  return module.exports
}

/**
 * Run a generated ALL.js with every model stubbed out, except the ones named
 * in `broken`, whose require throws.
 */
const runGrid = (broken = [], { trap = [], models = {} } = {}) => {
  const req = (name) => {
    if (name.endsWith('grid-utils.js')) {
      return loadCjs(resolve(dirname(gridPath), name), nodeRequire)
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

describe('generated ALL.js grid', () => {
  afterEach(() => {
    delete globalThis.__allWasmTrap
    delete globalThis.__jscadScriptGeneration
  })

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
