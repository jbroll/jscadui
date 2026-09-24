import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime, evalScadSolidSync } from '../bin/run-jscad.js'

type Ctx = Awaited<ReturnType<typeof initScadRuntime>>
type Geom = { manifold?: unknown, crossSection?: unknown, volume(): number, area(): number }

describe('manifold inputs are disposed once an op consumes them', () => {
  let ctx: Ctx
  let cube: (size: number) => Geom

  beforeAll(async () => {
    ctx = await initScadRuntime()
    cube = (size) => j$.cube({ size })
  })

  const disposed = (g: Geom) => g.manifold === null

  it('union, subtract and intersect free their inputs', () => {
    for (const op of [j$.union, j$.subtract, j$.intersect]) {
      const a = cube(10), b = j$.translate([5, 0, 0], cube(10))
      const r = op(a, b)
      expect(disposed(a)).toBe(true)
      expect(disposed(b)).toBe(true)
      expect(r.volume()).toBeGreaterThan(0)
    }
  })

  it('safeUnion frees its parts', () => {
    const a = cube(10), b = j$.translate([20, 0, 0], cube(10))
    const r = j$.safeUnion([a, [b]])
    expect(disposed(a) && disposed(b)).toBe(true)
    expect(r.volume()).toBeCloseTo(2000, 3)
  })

  it('transforms free their input', () => {
    const ops = [
      (g: Geom) => j$.translate([1, 2, 3], g),
      (g: Geom) => j$.rotate([10, 20, 30], g),
      (g: Geom) => j$.rotate({ a: 30, v: [1, 1, 0] }, g),
      (g: Geom) => j$.scale(2, g),
      (g: Geom) => j$.mirror([1, 0, 0], g),
      (g: Geom) => j$.multmatrix([[1, 0, 0, 5], [0, 1, 0, 0], [0, 0, 1, 0]], g),
      (g: Geom) => j$.resize([20, 0, 0], g),
    ]
    for (const op of ops) {
      const g = cube(10)
      const r = op(g)
      expect(disposed(g)).toBe(true)
      expect(Math.abs(r.volume())).toBeGreaterThan(0)
    }
  })

  it('hull, minkowski and color free their inputs', () => {
    const a = cube(10), b = j$.translate([20, 0, 0], cube(10))
    expect(j$.hull(a, b).volume()).toBeCloseTo(3000, 3)
    expect(disposed(a) && disposed(b)).toBe(true)

    const c = cube(10), d = cube(2)
    expect(j$.minkowski(c, d).volume()).toBeCloseTo(1728, 3)
    expect(disposed(c) && disposed(d)).toBe(true)

    const e = cube(10)
    const colored = j$.color('red', undefined, e)
    expect(disposed(e)).toBe(true)
    expect(colored.volume()).toBeCloseTo(1000, 3)
  })

  it('keeps an input the op hands back as its result', () => {
    const g = cube(10)
    expect(j$.mirror([0, 0, 0], g)).toBe(g)
    expect(j$.rotate([0, 0, 0], g)).toBe(g)
    expect(j$.union(g, undefined)).toBe(g)
    expect(disposed(g)).toBe(false)
    expect(g.volume()).toBeCloseTo(1000, 3)
  })

  const scad = (source: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'disposal-'))
    const file = join(dir, 'model.scad')
    writeFileSync(file, source)
    return evalScadSolidSync(file, ctx)
  }

  it('children() called twice evaluates fresh geometry each time', () => {
    const r = scad('module twice() { children(); translate([20, 0, 0]) children(); }\ntwice() cube(10);')
    expect(r.volume()).toBeCloseTo(2000, 3)
  })

  it('children(i) in a loop and $children stay valid', () => {
    const r = scad(`
      module row() { for (i = [0:$children-1]) translate([i * 20, 0, 0]) children(i); for (i = [0:$children-1]) translate([i * 20, 20, 0]) children(i); }
      row() { cube(10); sphere(5, $fn=16); }
    `)
    expect(r.volume()).toBeGreaterThan(2000)
  })

  it('render, color, highlight and intersection_for pass geometry through once', () => {
    const r = scad(`
      render() color("red") #cube(10);
      %cube(50);
      translate([30, 0, 0]) intersection_for (i = [0, 1]) translate([i, 0, 0]) cube(10);
    `)
    expect(r.volume()).toBeCloseTo(1000 + 900, 3)
  })
})

describe('on the jscad engine disposal does nothing', () => {
  beforeAll(() => { j$.init(jscad) })

  it('leaves plain geom3 inputs alone', () => {
    const a = { ...jscad.primitives.cube({ size: 10 }), dispose: vi.fn() }
    const b = jscad.primitives.cube({ size: 10, center: [5, 0, 0] })
    const r = j$.union(j$.translate([0, 0, 0], a), b)
    expect(a.dispose).not.toHaveBeenCalled()
    expect(jscad.measurements.measureVolume(r)).toBeCloseTo(1500, 3)
    expect(jscad.measurements.measureVolume(a)).toBeCloseTo(1000, 3)
  })
})
