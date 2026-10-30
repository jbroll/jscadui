import { describe, expect, it } from 'vitest'
import { PRESET_DIRS } from './viewSpec.js'
import { clipPlanes, frameCamera, frameShot } from './viewFrame.js'

// A 64-unit cube centred on the origin, in the shape @jscadui/format-common's
// boundingBox hands back (min/max as {x, y, z}).
const cube64 = { min: { x: -32, y: -32, z: -32 }, max: { x: 32, y: 32, z: 32 } }
const size = { w: 640, h: 480 }

const RADIUS = Math.hypot(64, 64, 64)

const toArr = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z])
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

const corners = ({ min, max }) => {
  const lo = toArr(min)
  const hi = toArr(max)
  const out = []
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push([x, y, z])
  return out
}

// Rebuilds the frustum from the returned camera alone and checks every box
// corner projects inside it, independent of what frameCamera computed.
const projectedCornersInside = (cam, bbox) => {
  const eye = cam.position
  const z = unit(sub(eye, cam.target))
  const x = unit(cross(cam.up, z))
  const y = cross(z, x)
  const tanV = Math.tan((cam.fov * Math.PI) / 180 / 2)
  const tanH = tanV * cam.aspect
  return corners(bbox).every((p) => {
    const d = sub(p, eye)
    const depth = -dot(d, z)
    return depth > 0 && Math.abs(dot(d, x)) <= depth * tanH && Math.abs(dot(d, y)) <= depth * tanV
  })
}

const framePreset = (preset, at = size) => frameCamera(cube64, PRESET_DIRS[preset].dir, PRESET_DIRS[preset].up, at)

describe('frameCamera', () => {
  it('aspect follows the requested size', () => {
    expect(framePreset('iso-front').aspect).toBeCloseTo(640 / 480)
  })

  it('640x480 framing contains the whole bbox with margin', () => {
    expect(projectedCornersInside(framePreset('iso-front'), cube64)).toBe(true)
  })

  it('every preset frames the whole bbox at square and non-square sizes', () => {
    for (const preset of Object.keys(PRESET_DIRS)) {
      expect(projectedCornersInside(framePreset(preset, { w: 768, h: 768 }), cube64)).toBe(true)
      expect(projectedCornersInside(framePreset(preset, { w: 640, h: 480 }), cube64)).toBe(true)
      expect(projectedCornersInside(framePreset(preset, { w: 480, h: 640 }), cube64)).toBe(true)
    }
  })

  it('all nine presets produce distinct positions but side aliases front', () => {
    const positions = new Set(Object.keys(PRESET_DIRS).map((preset) => framePreset(preset).position.join(',')))
    expect(Object.keys(PRESET_DIRS)).toHaveLength(9)
    expect(positions.size).toBe(8)
  })

  it('aims at the bbox centre from three radii away', () => {
    const cam = framePreset('iso-front')
    expect(cam.target).toEqual([0, 0, 0])
    expect(Math.hypot(...sub(cam.position, cam.target))).toBeCloseTo(RADIUS * 3, 6)
  })

  it('opens the horizontal field wider than the vertical in a 4:3 frame', () => {
    const cam = framePreset('front')
    const tanV = Math.tan((cam.fov * Math.PI) / 180 / 2)
    expect(tanV * cam.aspect).toBeGreaterThan(tanV)
  })

  it('returns the app camera shape with a unit up squared off the direction', () => {
    const cam = framePreset('top')
    expect(Object.keys(cam).sort()).toEqual(['aspect', 'fov', 'position', 'target', 'up'])
    expect(Math.hypot(...cam.up)).toBeCloseTo(1, 9)
    expect(dot(cam.up, unit(sub(cam.position, cam.target)))).toBeCloseTo(0, 9)
  })

  it('rejects a bbox or direction that is not three finite numbers', () => {
    expect(() => frameCamera({ min: [0, 0], max: [1, 1, 1] }, [1, 0, 0], [0, 0, 1], size)).toThrowError(/three/)
    expect(() => frameCamera(cube64, [1, 0, NaN], [0, 0, 1], size)).toThrowError(/three/)
  })
})

describe('frameShot', () => {
  const { dir, up } = PRESET_DIRS['iso-front']

  it('frames the model box at its centre when the shot names neither bbox nor target', () => {
    expect(frameShot({ dir, up }, cube64, size)).toEqual(framePreset('iso-front'))
  })

  it('keeps the target and still fits every corner of the model', () => {
    const cam = frameShot({ dir, up, target: [32, 0, 0] }, cube64, size)
    expect(cam.target).toEqual([32, 0, 0])
    expect(projectedCornersInside(cam, cube64)).toBe(true)
  })

  it("frames the shot's own bbox over the model's", () => {
    const part = { min: [0, 0, 0], max: [4, 4, 4] }
    const cam = frameShot({ dir, up, bbox: part }, cube64, size)
    expect(cam.target).toEqual([2, 2, 2])
    expect(projectedCornersInside(cam, part)).toBe(true)
  })
})

describe('clipPlanes', () => {
  it('sits a hundredfold either side of the target distance', () => {
    expect(clipPlanes({ position: [0, 0, 300], target: [0, 0, 0] })).toEqual({ near: 3, far: 30000 })
  })

  it('falls back to the viewer planes for a zero distance', () => {
    expect(clipPlanes({ position: [1, 1, 1], target: [1, 1, 1] })).toEqual({ near: 1, far: 50000 })
  })
})
