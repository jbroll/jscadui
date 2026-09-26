import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../src/parser/parse.js'
import { transpile } from '../src/transpiler/transpile.js'
import { initScadRuntime, evalScadSolidSync } from '../bin/run-jscad.js'
import jscad from '@jscad/modeling'
import j$ from '@jscadui/openscad-runtime'

// dotSCAD's polyhedron_hull(..., polyhedron_abuse = true) is
// `hull() polyhedron(points, [[0:len(points) - 1]])`: one face through every
// point. OpenSCAD hulls the face's vertices; polyhedron() on its own drops the
// open mesh, which left penrose_basket without any of its shells.
const points = '[[0,0,0],[10,0,0],[10,10,0],[0,10,2],[5,5,8]]'
const transpileCode = (source: string) => transpile(parse(source).ast, { includeHeader: false }).code

describe('hull() of an open polyhedron', () => {
  let dir: string
  let ctx: Awaited<ReturnType<typeof initScadRuntime>>
  const run = (source: string) => {
    const file = join(dir, 'model.scad')
    writeFileSync(file, source)
    return evalScadSolidSync(file, ctx)
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'polyhedron-hull-'))
    ctx = await initScadRuntime()
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('transpiles a direct polyhedron child to polyhedronHull', () => {
    const code = transpileCode(`hull() polyhedron(${points}, [[0,1,2,3,4]]);`)
    expect(code).toContain('j$.polyhedronHull(')
    expect(transpileCode(`polyhedron(${points}, [[0,1,2,3,4]]);`)).not.toContain('polyhedronHull')
  })

  it('hulls the vertices of a single-face polyhedron', () => {
    // OpenSCAD 2026.09 --backend=manifold: 6 facets, volume 266.667
    const solid = run(`hull() polyhedron(${points}, [[0,1,2,3,4]]);`)
    expect(solid.volume()).toBeCloseTo(800 / 3, 6)
  }, 30000)

  it('hulls it together with its siblings', () => {
    const solid = run(`hull() { polyhedron(${points}, [[0,1,2,3,4]]); translate([20,0,0]) cube(1); }`)
    expect(solid.boundingBox()[1][0]).toBeCloseTo(21, 6)
  }, 30000)

  it('still drops an open polyhedron outside hull()', () => {
    expect(run(`polyhedron(${points}, [[0,1,2,3,4]]);`)).toBeNull()
  }, 30000)
})

// The browser's `jscad` engine: plain @jscad/modeling, which has no hullPoints
describe('polyhedronHull on @jscad/modeling', () => {
  beforeAll(() => j$.init(jscad))
  afterAll(async () => { await initScadRuntime() })

  it('hulls the points with hullPoints3', () => {
    const pts = JSON.parse(points)
    const solid = j$.polyhedronHull({ points: pts, faces: [[0, 1, 2, 3, 4]] })
    expect(jscad.measurements.measureVolume(solid)).toBeCloseTo(800 / 3, 6)
  })
})
