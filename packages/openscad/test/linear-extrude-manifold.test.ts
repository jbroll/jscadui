import { describe, it, expect, beforeAll } from 'vitest'
import j$ from '@jscadui/openscad-runtime'
import jscad from '@jscad/modeling'
import { linearExtrudeMesh } from '../../openscad-runtime/src/linearExtrude.js'
import { initScadRuntime } from '../bin/run-jscad.js'

type Geom = { manifold: { numTri(): number }, volume(): number }

/**
 * linear_extrude on the Manifold engine, where a mesh that does not close is
 * rejected and the extrusion disappears. Cases from the GPU run on
 * jbroll/jscadui#118.
 */
describe('linear_extrude on the Manifold engine', () => {
  beforeAll(async () => {
    await initScadRuntime()
  })

  const square = (size: number) => j$.square({ size, center: true })
  // Integral over the height of the area scaled by (1 + (sx - 1) t)(1 + (sy - 1) t)
  const scaledVolume = (area: number, h: number, sx: number, sy: number) =>
    area * h * (1 + ((sx - 1) + (sy - 1)) / 2 + (sx - 1) * (sy - 1) / 3)

  // Every directed edge once, and its reverse once: a closed, consistently wound mesh
  const openEdges = (faces: number[][]) => {
    const seen = new Map<string, number>()
    for (const f of faces) f.forEach((a, i) => { const k = a + '>' + f[(i + 1) % 3]; seen.set(k, (seen.get(k) ?? 0) + 1) })
    return [...seen].filter(([k, n]) => { const [a, b] = k.split('>'); return n !== 1 || seen.get(b + '>' + a) !== 1 }).length
  }

  // bend_extrude fragments of dotSCAD hypnotic_squares: nine nested outlines
  // (a hole two levels in was bridged to the outermost outline), and one where
  // a hole corner lies on a line through two other outlines.
  const fragments = [
    {"p": {"vector": [0, 0, 1], "center": false, "scaleX": 0.9654907939863305, "scaleY": 1, "twist": 0, "hasTwist": false, "fn": 12, "fa": 12, "fs": 2}, "o": [[[-7.5, 16], [-7.5, 0], [7.5, 0], [7.5, 16]], [[7, 15], [7, 1], [-7, 1], [-7, 15]], [[-6.25, 14.5], [-6.25, 1.5], [6.75, 1.5], [6.75, 14.5]], [[5.75, 13.5], [5.75, 2.5], [-5.25, 2.5], [-5.25, 13.5]], [[-4.450000002980232, 13], [-4.450000002980232, 3], [5.549999997019768, 3], [5.549999997019768, 13]], [[4.549999997019768, 12], [4.549999997019768, 4], [-3.4500000029802322, 4], [-3.4500000029802322, 12]], [[-2.5750000029802322, 11.5], [-2.5750000029802322, 4.5], [4.424999997019768, 4.5], [4.424999997019768, 11.5]], [[3.4249999970197678, 10.5], [3.4249999970197678, 10], [-0.5750000029802322, 10], [-0.5750000029802322, 6], [3.4249999970197678, 6], [3.4249999970197678, 5.5], [-1.5750000029802322, 5.5], [-1.5750000029802322, 10.5]], [[2.4249999970197678, 9], [2.4249999970197678, 7], [0.42499999701976776, 7], [0.42499999701976776, 9]]]},
    {"p": {"vector": [0, 0, 1], "center": false, "scaleX": 0.9654907939863305, "scaleY": 1, "twist": 0, "hasTwist": false, "fn": 12, "fa": 12, "fs": 2}, "o": [[[-7, 16], [-7.5, 16], [-7.5, 0], [7.5, 0], [7.5, 16]], [[7, 15], [7, 1], [-7, 1], [-7, 15]], [[-6.5, 14.5], [-6.5, 1.5], [6.5, 1.5], [6.5, 14.5]], [[5.5, 13.5], [5.5, 2.5], [-5.5, 2.5], [-5.5, 13.5]], [[-5, 13], [-5, 3], [5, 3], [5, 13]], [[4, 12], [4, 4], [-4, 4], [-4, 12]], [[-3.5, 11.5], [-3.5, 4.5], [3.5, 4.5], [3.5, 11.5]], [[2.5, 10.5], [2.5, 5.5], [-2.5, 5.5], [-2.5, 10.5]], [[-2, 10], [-2, 6], [2, 6], [2, 10]], [[1, 9], [1, 7], [-1, 7], [-1, 9]]]},
  ]

  it('builds closed meshes for outlines nested several deep (dotSCAD hypnotic_squares)', () => {
    for (const { p, o } of fragments) {
      const mesh = linearExtrudeMesh(p, o, jscad.extrusions.slice)
      expect(openEdges(mesh!.faces)).toBe(0)
    }
  })

  it('closes the caps when a row of holes lines up (dotSCAD stereographic_projection)', () => {
    let g = square(50)
    for (const x of [-18, -6, 6, 18]) g = j$.subtract(g, j$.translate([x, 10], square(8)))
    const area = 50 * 50 - 4 * 64
    const e = j$.linearExtrude({ height: 10, scale: [0.5, 0.25] }, g) as Geom
    expect(e).toBeDefined()
    expect(e.volume()).toBeCloseTo(scaledVolume(area, 10, 0.5, 0.25), 3)
  })

  it('stacked uniform-scale extrusions meet without a sliver (dotSCAD ellipse_extrude)', () => {
    const f = 0.9705621066687931, h = 5.780423646136447
    const pentagon = () => j$.circle({ r: 20, $fn: 5 })
    const lower = j$.linearExtrude({ height: h, slices: 1, scale: f }, pentagon())
    const upper = j$.translate([0, 0, h], j$.linearExtrude({ height: 4, slices: 1, scale: 0.9 }, j$.scale([f, f], pentagon())))
    // Two frustums fused: 10 + 10 side triangles and 3 + 3 cap triangles
    expect((j$.union(lower, upper) as Geom).manifold.numTri()).toBe(26)
  })

  it('extrudes circle(0) to nothing, as OpenSCAD does', () => {
    expect(j$.linearExtrude({ h: 1 }, j$.circle({ r: 0 }))).toBeUndefined()
  })
})
