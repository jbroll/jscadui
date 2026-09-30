import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { footprint, holeLoops, outerLoops, runProbe } from './probe.js'

const { booleans, primitives: p, transforms } = createRequire(import.meta.url)('@jscad/modeling')

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

  it('reads geometry an array nests', () => {
    expect(runProbe([[cup]], { bodies: {} }).bodies).toHaveLength(1)
    expect(runProbe([], { sections: [{ axis: 'z', at: [0.5] }], bodies: {} })).toEqual({ sections: [], bodies: [] })
  })
})
