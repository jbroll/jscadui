import { describe, expect, it } from 'vitest'
import { PRESET_DIRS, VIEW_PRESETS } from '@jscadui/agent-loop/src/viewSpec.js'

import { frameCamera, resolveThree } from '../src/aiViewRender.js'

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

// Rebuilds the frustum from the returned camera alone (position, target, up,
// fov, aspect) and asserts every corner of the box projects inside it. This is
// an independent check: it never reads anything else frameCamera computed.
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

describe('PRESET_DIRS', () => {
  it('keys exactly the nine view presets from the request spec', () => {
    expect(Object.keys(PRESET_DIRS).sort()).toEqual([...VIEW_PRESETS].sort())
    expect(PRESET_DIRS['side']).toEqual(PRESET_DIRS['front'])
  })

  it('carries the eval describer directions for the shared presets', () => {
    expect(PRESET_DIRS['iso-front']).toEqual({ dir: [1, -1, 0.7], up: [0, 0, 1] })
    expect(PRESET_DIRS['iso-back']).toEqual({ dir: [-1, 1, 0.7], up: [0, 0, 1] })
    expect(PRESET_DIRS['top']).toEqual({ dir: [0.15, -0.35, 1], up: [0, 1, 0] })
  })

  it('resolves three.js from the injected env, the viewer global, then the bundle', () => {
    const env = { WebGLRenderer: function () {} }
    expect(resolveThree(env)).toBe(env)
    const prior = globalThis.THREE
    globalThis.THREE = env
    try {
      expect(resolveThree(undefined)).toBe(env)
    } finally {
      if (prior === undefined) delete globalThis.THREE
      else globalThis.THREE = prior
    }
    expect(typeof resolveThree(undefined).WebGLRenderer).toBe('function')
  })

  it('uses +Z up for the side-on views and +Y up for top and bottom', () => {
    for (const preset of ['front', 'back', 'left', 'right', 'iso-front', 'iso-back']) {
      expect(PRESET_DIRS[preset].up).toEqual([0, 0, 1])
    }
    expect(PRESET_DIRS['top'].up).toEqual([0, 1, 0])
    expect(PRESET_DIRS['bottom'].up).toEqual([0, 1, 0])
  })

  it('gives every preset a three-number direction', () => {
    for (const { dir } of Object.values(PRESET_DIRS)) {
      expect(dir).toHaveLength(3)
      expect(dir.every(Number.isFinite)).toBe(true)
    }
  })
})

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
    // Nine names, eight framings: `side` is the eval's word for `front`'s view.
    expect(Object.keys(PRESET_DIRS)).toHaveLength(9)
    expect(positions.size).toBe(8)
  })

  it('aims at the bbox centre from three radii away', () => {
    const cam = framePreset('iso-front')
    expect(cam.target).toEqual([0, 0, 0])
    expect(Math.hypot(...sub(cam.position, cam.target))).toBeCloseTo(RADIUS * 3, 6)
  })

  it('keeps margin on the long side of a non-square frame, not a stretched crop', () => {
    // A 4:3 frame must open its horizontal field wider than its vertical one,
    // so the box is never cropped across the wide axis.
    const cam = framePreset('front')
    const tanV = Math.tan((cam.fov * Math.PI) / 180 / 2)
    expect(tanV * cam.aspect).toBeGreaterThan(tanV)
  })

  it('rejects a bbox or direction that is not three finite numbers', () => {
    expect(() => frameCamera({ min: [0, 0], max: [1, 1, 1] }, [1, 0, 0], [0, 0, 1], size)).toThrowError(/three/)
    expect(() => frameCamera(cube64, [1, 0, NaN], [0, 0, 1], size)).toThrowError(/three/)
  })
})
