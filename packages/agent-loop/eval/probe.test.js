import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { footprint, holeLoops, nesting, outerLoops, runProbe, turnOf } from './probe.js'

const { booleans, extrusions, primitives: p, transforms } = createRequire(import.meta.url)('@jscad/modeling')

const cup = booleans.subtract(p.cuboid({ size: [40, 30, 20] }), transforms.translateZ(2, p.cuboid({ size: [36, 26, 20] })))

describe('runProbe', () => {
  it('splits a section into an outer loop and its hole, with signed areas', () => {
    const [section] = runProbe([cup], { sections: [{ axis: 'z', at: [0.5] }] }).sections
    expect(section.loopCount).toBe(2)
    const [outer] = outerLoops(section)
    const [hole] = holeLoops(section)
    expect(outer.area).toBeCloseTo(1200, 6)
    expect(hole.area).toBeCloseTo(-936, 6)
    expect(footprint(outer, 'z')).toEqual([expect.closeTo(30, 6), expect.closeTo(40, 6)])
    expect(footprint(hole, 'z')).toEqual([expect.closeTo(26, 6), expect.closeTo(36, 6)])
  })

  it('cuts at millimetres above the minimum and leaves a cut outside the model empty', () => {
    const sections = runProbe([cup], { sections: [{ axis: 'z', above: [1, 50] }] }).sections
    expect(sections.map((s) => s.loops.length)).toEqual([1, 0])
    expect(sections[0].above).toBe(1)
  })

  it('counts each separate part of one solid as a body, with its volume and sections', () => {
    const two = booleans.union(p.cube({ size: 10 }), transforms.translateX(30, p.cube({ size: 4 })))
    const { bodies } = runProbe([two, p.sphere({ radius: 3, center: [0, 40, 0] })], { bodies: { sections: [{ axis: 'x', at: [0.5] }] } })
    expect(bodies).toHaveLength(3)
    expect(bodies.slice(0, 2).map((b) => Math.round(b.volume))).toEqual([1000, 64])
    expect(bodies[2].volume).toBeGreaterThan(100)
    expect(bodies[0].sections[0].loops).toHaveLength(1)
  })

  it('groups nearby loops, each group with its area and the area of its convex hull', () => {
    const plate = p.cuboid({ size: [80, 80, 5] })
    const slotted = booleans.subtract(plate, p.cuboid({ size: [12, 90, 10] }))
    const far = transforms.translateY(100, p.cuboid({ size: [80, 8, 5] }))
    const [section] = runProbe([slotted, far], { sections: [{ axis: 'z', at: [0.5], groupGap: 20 }] }).sections
    expect(section.loops).toHaveLength(3)
    const groups = [...section.groups].sort((a, b) => b.area - a.area)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ loopCount: 2, area: expect.closeTo(5440, 6), hullArea: expect.closeTo(6400, 6) })
    expect(groups[1]).toMatchObject({ loopCount: 1, area: expect.closeTo(640, 6), hullArea: expect.closeTo(640, 6) })
    expect(runProbe([cup], { sections: [{ axis: 'z', at: [0.5] }] }).sections[0].groups).toBeUndefined()
  })

  it("counts each body's polygons, and the volume each pair of bodies with overlapping boxes shares", () => {
    const [a, b, far] = [p.cube({ size: 10 }), p.cube({ size: 10, center: [8, 0, 0] }), p.cube({ size: 10, center: [40, 0, 0] })]
    const { bodies, overlaps } = runProbe([a, b, far], { bodies: { overlaps: true } })
    expect(bodies.map((body) => body.polygonCount)).toEqual([6, 6, 6])
    expect(overlaps).toEqual([{ a: 0, b: 1, volume: expect.closeTo(200, 6) }])
    const touching = runProbe([a, p.cube({ size: 10, center: [10, 0, 0] })], { bodies: { overlaps: true } })
    expect(touching.overlaps).toEqual([])
    expect(runProbe([a], { bodies: {} })).not.toHaveProperty('overlaps')
  })

  it("gives each loop of an outline cut its centroid, perimeter, radius range about the cut's largest loop, and lobe count", () => {
    const square = transforms.translate([5, -3, 0], p.cuboid({ size: [20, 20, 10] }))
    const [section] = runProbe([square], { sections: [{ axis: 'z', at: [0.5], outline: true }] }).sections
    const [loop] = section.loops
    expect(section.centre).toEqual([expect.closeTo(5, 6), expect.closeTo(-3, 6)])
    expect(loop.centroid).toEqual([expect.closeTo(5, 6), expect.closeTo(-3, 6)])
    expect(loop.perimeter).toBeCloseTo(80, 6)
    expect(loop.radius).toEqual([expect.closeTo(10, 6), expect.closeTo(Math.SQRT2 * 10, 6)])
    expect(loop.lobes).toBe(4)
    expect(runProbe([cup], { sections: [{ axis: 'z', at: [0.5] }] }).sections[0].loops[0]).not.toHaveProperty('lobes')
  })

  it('counts the teeth of a star outline as lobes, and none on a round one', () => {
    const star = (n) => extrusions.extrudeLinear({ height: 5 }, p.star({ vertices: n, outerRadius: 20, innerRadius: 16 }))
    const lobes = (shape) => runProbe([shape], { sections: [{ axis: 'z', at: [0.5], outline: true }] }).sections[0].loops[0].lobes
    expect(lobes(star(20))).toBe(20)
    expect(lobes(star(7))).toBe(7)
    expect(lobes(p.cylinder({ radius: 10, height: 5, segments: 64 }))).toBe(0)
  })

  it("points a hole's first harmonic about the cut's largest loop toward the side the hole is offset", () => {
    const offset = (x, y) => booleans.subtract(p.cylinder({ radius: 15, height: 10, segments: 64 }), p.cylinder({ radius: 5, height: 20, center: [x, y, 0], segments: 64 }))
    const firstHarmonic = (shape) => holeLoops(runProbe([shape], { sections: [{ axis: 'z', at: [0.5], outline: true }] }).sections[0])[0].harmonics[0]
    expect(firstHarmonic(offset(3, 0))).toMatchObject({ k: 1, magnitude: expect.closeTo(0.375, 2), angle: expect.closeTo(0, 3) })
    expect(firstHarmonic(offset(0, 3)).angle).toBeCloseTo(90, 3)
  })

  it('follows a twisted outline through its cuts as a steady turn', () => {
    const twisted = extrusions.extrudeLinear({ height: 40, twistAngle: Math.PI / 2, twistSteps: 40 }, p.rectangle({ size: [30, 10] }))
    const at = Array.from({ length: 19 }, (_, k) => 0.05 + k * 0.05)
    const sections = runProbe([twisted], { sections: [{ axis: 'z', at, outline: true }] }).sections
    const turn = turnOf(sections.map((s) => s.loops[0]))
    expect(turn.k).toBe(2)
    expect(turn.degrees[0]).toBe(0)
    expect(turn.degrees.at(-1)).toBeCloseTo(81, 0)
    expect(turnOf(runProbe([p.cuboid({ size: [30, 10, 40] })], { sections: [{ axis: 'z', at, outline: true }] }).sections.map((s) => s.loops[0])).degrees.at(-1)).toBeCloseTo(0, 6)
  })

  it('finds how deep one tray nests into another and the play left around it', () => {
    const at = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)
    const bodies = (...shapes) => runProbe(shapes, { bodies: { sections: [{ axis: 'z', at }] } }).bodies
    const cavity = transforms.translateZ(12.5, p.cuboid({ size: [36, 36, 15] }))
    const footed = (foot) =>
      booleans.subtract(booleans.union(transforms.translateZ(11.5, p.cuboid({ size: [40, 40, 17] })), transforms.translateZ(1.5, p.cuboid({ size: [foot, foot, 3] }))), cavity)
    const [a, b] = bodies(footed(35.4), transforms.translateX(60, footed(35.4)))
    const fit = nesting(a, b, 'z')
    expect(fit.depth).toBeGreaterThanOrEqual(2.6)
    expect(fit.depth).toBeLessThanOrEqual(3.6)
    expect(fit.play).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.6, 6)])
    const [plainA, plainB] = bodies(footed(40), transforms.translateX(60, footed(40)))
    expect(nesting(plainA, plainB, 'z')).toEqual({ depth: 0, play: null })
    const [tightA, tightB] = bodies(footed(36.2), transforms.translateX(60, footed(36.2)))
    expect(nesting(tightA, tightB, 'z').depth).toBe(0)
  })

  it('nests a tray whose recessed bottom fits over the rim of the one below', () => {
    const at = Array.from({ length: 50 }, (_, k) => 0.01 + k * 0.02)
    const tray = booleans.subtract(
      booleans.union(transforms.translateZ(8.5, p.cuboid({ size: [44, 44, 17] })), transforms.translateZ(18.5, p.cuboid({ size: [40, 40, 3] }))),
      transforms.translateZ(1.5, p.cuboid({ size: [40.6, 40.6, 3] })),
      transforms.translateZ(13, p.cuboid({ size: [36, 36, 16] })),
    )
    const [a, b] = runProbe([tray, transforms.translateX(60, tray)], { bodies: { sections: [{ axis: 'z', at }] } }).bodies
    const fit = nesting(a, b, 'z')
    expect(fit.depth).toBeGreaterThanOrEqual(2.6)
    expect(fit.play).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.6, 6)])
  })

  it('reads geometry an array nests', () => {
    expect(runProbe([[cup]], { bodies: {} }).bodies).toHaveLength(1)
    expect(runProbe([], { sections: [{ axis: 'z', at: [0.5] }], bodies: {} })).toEqual({ sections: [], bodies: [] })
  })
})
