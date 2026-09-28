import { describe, it, expect, beforeAll } from 'vitest'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import jscad from '@jscad/modeling'
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
const ghosts = (r: G | G[]) => [r].flat().filter(g => g.previewOnly)
const solids = (r: G | G[]) => [r].flat().filter(g => !g.previewOnly)
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
    expect(code('#for (i = [0:1]) cube(1);')).toContain('j$.highlight(')
  })

  it('marks a module body that is only a % statement as a group', () => {
    expect(code('module m() { %cube(1); }')).toContain('return j$.group(j$.background(')
    expect(code('module m() { cube(1); }')).not.toContain('j$.group(')
  })

  it('marks a module body that is only a nested % block or children() as a group', () => {
    expect(code('module m() { { %cube(1); } }')).toContain('return j$.group(j$.background(')
    expect(code('module m() { { a = 1; %cube(1); } }')).toContain('return j$.group(')
    expect(code('module m() { children(0); }')).toContain('return j$.group(j$.childrenAt(')
    expect(code('module m() { children(); }')).toContain('return j$.group(')
  })

  it('marks if, let, echo and assert around a % child as a group', () => {
    expect(code('if (true) %cube(1);')).toContain('j$.group((j$.isTruthy(')
    expect(code('if (true) cube(1); else { %cube(1); }')).toContain('j$.group(')
    expect(code('let (a = 1) %cube(1);')).toContain('j$.group(')
    expect(code('echo(1) %cube(1);')).toContain('j$.group(')
    expect(code('assert(true) %cube(1);')).toContain('j$.group(')
  })

  it('leaves groups around geometry that is not % unmarked', () => {
    expect(code('if (true) cube(1);')).not.toContain('j$.group(')
    expect(code('let (a = 1) cube(1);')).not.toContain('j$.group(')
    expect(code('if (true) translate([1, 0, 0]) %cube(1);')).not.toContain('j$.group(')
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

  it('difference skips a leading % child and subtracts from the next', () => {
    const plain = solids(run('difference() { cube(10); sphere(6); }'))[0].volume!()
    const r = run('difference() { %cube(20); cube(10); sphere(6); }')
    expect(solids(r)).toHaveLength(1)
    expect(solids(r)[0].volume!()).toBeCloseTo(plain, 3)
    expect(ghosts(r)).toHaveLength(1)
  })

  it('difference skips every leading % child', () => {
    const r = run('difference() { %cube(20); %sphere(30); cube(10); translate([20, 0, 0]) cube(1); }')
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
    expect(ghosts(r).length).toBeGreaterThan(0)
  })

  it('union and intersection skip a leading % child', () => {
    expect(solids(run('union() { %cube(20); cube(10); }'))[0].volume!()).toBeCloseTo(1000, 3)
    expect(solids(run('intersection() { %cube(20); cube(10); }'))[0].volume!()).toBeCloseTo(1000, 3)
  })

  it.each([
    ['if', 'if (true) %sphere(1);'],
    ['if else', 'if (false) cube(1); else %sphere(1);'],
    ['let', 'let (a = 1) %sphere(1);'],
    ['echo', 'echo("x") %sphere(1);'],
    ['assert', 'assert(true) %sphere(1);'],
  ])('%s around a lone % child empties intersection', (_name, child) => {
    const r = run(`intersection() { cube(10); ${child} }`)
    expect(solids(r)).toHaveLength(0)
    expect(ghosts(r)).toHaveLength(1)
  })

  it('an if not taken around a % child stays absent', () => {
    const r = run('intersection() { cube(10); if (false) %sphere(1); }')
    expect(solids(r)[0].volume!()).toBeCloseTo(1000, 3)
  })

  it('a module whose only statement is a nested % block empties intersection', () => {
    const r = run('module m() { { %sphere(1); } }\nintersection() { cube(10); m(); }')
    expect(solids(r)).toHaveLength(0)
    expect(ghosts(r)).toHaveLength(1)
  })

  it('a module passing a % child through children() empties intersection', () => {
    for (const body of ['children(0);', 'children();']) {
      const r = run(`module m() { ${body} }\nintersection() { cube(10); m() %sphere(1); }`)
      expect(solids(r)).toHaveLength(0)
      expect(ghosts(r)).toHaveLength(1)
    }
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

// Last: j$.init(jscad) switches the shared runtime off manifold for the rest of the file.
describe('% and # on the jscad engine', () => {
  beforeAll(() => { j$.init(jscad) })

  it('# inside difference gives a 3D ghost', () => {
    const r = run('difference() { cube(10); #translate([5, 5, -1]) cylinder(h = 12, r = 2); }')
    expect(ghosts(r)).toHaveLength(1)
    expect(ghosts(r)[0].polygons!.length).toBeGreaterThan(0)
    expect(solids(r)).toHaveLength(1)
    expect(jscad.geometries.geom3.isA(solids(r)[0])).toBe(true)
  })

  it('% on a 2D shape gives a sides ghost', () => {
    const r = run('%square(3);') as (G & { sides?: number[][][] })[]
    expect(r).toHaveLength(1)
    expect(r[0].previewOnly).toBe(true)
    expect(r[0].sides!.length).toBeGreaterThan(0)
  })
})
