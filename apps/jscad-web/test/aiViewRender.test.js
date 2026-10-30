import { describe, expect, it } from 'vitest'
import { PRESET_DIRS, VIEW_PRESETS } from '@jscadui/agent-loop/src/viewSpec.js'

import { resolveThree } from '../src/aiViewRender.js'

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
