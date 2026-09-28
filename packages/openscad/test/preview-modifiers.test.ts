import { describe, it, expect, beforeAll } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import j$ from '@jscadui/openscad-runtime'
import { initScadRuntime } from '../bin/run-jscad.js'

const code = (src: string) => transpile(parse(src).ast, { currentFile: '/m.scad' }).code

const run = (src: string) => {
  const fn = new Function('require', 'module', 'exports', 'j$', code(src))
  const mod = { exports: {} as Record<string, unknown> }
  fn(() => ({}), mod, mod.exports, j$)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod.exports.main as () => any)()
}

type G = { previewOnly?: boolean, color?: number[], polygons?: { vertices: number[][] }[], volume?: () => number }
const ghosts = (r: G[]) => r.filter(g => g.previewOnly)
const solids = (r: G[]) => r.filter(g => !g.previewOnly)
const zRange = (g: G) => {
  const zs = g.polygons!.flatMap(p => p.vertices.map(v => v[2]))
  return [Math.min(...zs), Math.max(...zs)]
}

describe('% and # emission', () => {
  it('wraps % children in j$.background', () => {
    expect(code('%cube(1);')).toContain('j$.background(')
    expect(code('%if (true) cube(1);')).toContain('j$.background(')
    expect(code('%for (i = [0:1]) cube(1);')).toContain('j$.background(')
  })

  it('wraps # children in j$.highlight', () => {
    expect(code('#cube(1);')).toContain('j$.highlight(')
    expect(code('#if (true) cube(1);')).toContain('j$.highlight(')
  })

  it('marks a module body that is only a % statement as a group', () => {
    expect(code('module m() { %cube(1); }')).toContain('return j$.group(j$.background(')
    expect(code('module m() { cube(1); }')).not.toContain('j$.group(')
  })

  it('leaves * disabled', () => {
    const c = code('*cube(1);')
    expect(c).not.toContain('j$.background(')
    expect(c).not.toContain('j$.highlight(')
  })

  it('routes main through j$.withOverlays', () => {
    expect(code('cube(1);')).toContain('j$.withOverlays(j$.safeUnion(')
  })
})

describe('% and # results', () => {
  beforeAll(async () => { await initScadRuntime() })

  it('a model without modifiers returns one geometry', () => {
    expect(Array.isArray(run('cube(10);'))).toBe(false)
  })

  it('# inside difference shows the cutter and still cuts', () => {
    const r = run('difference() { cube(10); #translate([5, 5, -1]) cylinder(h = 12, r = 2); }')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].color).toEqual([1, 0.32, 0.32, 0.5])
    expect(zRange(ghosts(r)[0])[0]).toBeCloseTo(-1, 4)
    expect(zRange(ghosts(r)[0])[1]).toBeCloseTo(11, 4)
    expect(solids(r)[0].volume!()).toBeLessThan(1000)
  })

  it('% stays out of the solid', () => {
    const r = run('%cube(50); cube(10);')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].color).toEqual([0.5, 0.5, 0.5, 0.3])
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
  })

  it('a %-only model returns only its ghost', () => {
    const r = run('%cube(5);')
    expect(r).toHaveLength(1)
    expect(r[0].previewOnly).toBe(true)
  })

  it('a % child of intersection is left out of it', () => {
    const r = run('intersection() { cube(10); %sphere(100); }')
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
  })

  it('a % child behind a transform empties intersection', () => {
    const r = run('intersection() { cube(10); translate([20, 0, 0]) %sphere(1); }')
    expect(solids(r)).toHaveLength(0)
    expect(ghosts(r)).toHaveLength(1)
  })

  it('a module whose only child is % empties intersection', () => {
    const r = run('module m() { %sphere(1); }\nintersection() { cube(10); m(); }')
    expect(solids(r)).toHaveLength(0)
    expect(ghosts(r)).toHaveLength(1)
  })

  it('merges a loop of highlights into one ghost', () => {
    const one = ghosts(run('#cube(1);'))[0].polygons!.length
    const r = run('for (i = [0:2499]) #translate([2 * i, 0, 0]) cube(1);')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].polygons).toHaveLength(2500 * one)
  })

  it('keeps one ghost per kind and dimension', () => {
    const r = run('#cube(1); #sphere(1); %cube(2); %square(3); %circle(1); #square(1);') as (G & { sides?: unknown[] })[]
    expect(ghosts(r)).toHaveLength(4)
    expect(ghosts(r).filter(g => g.sides)).toHaveLength(2)
  })

  it('% inside a module call follows the call\'s transform', () => {
    const r = run('module m() { %cube(1); cube(1); }\ntranslate([0, 0, 20]) m();')
    expect(zRange(ghosts(r)[0])).toEqual([20, 21])
  })
})
