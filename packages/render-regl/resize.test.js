import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RenderRegl } from './index.js'

const fakeExternal = renders => ({
  prepareRender: () => () => renders.push('render'),
  drawCommands: {},
  cameras: {
    perspective: {
      defaults: { position: [0, 0, 1] },
      update: () => {},
      setProjection: (_c, _s, { width, height }) => renders.push(`size ${width}x${height}`),
    },
  },
  controls: {
    orbit: { defaults: {}, update: ({ camera }) => ({ controls: {}, camera }) },
  },
})

const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ({}) })

describe('resize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { createElement: fakeCanvas })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders in the same call so the cleared buffer is never shown', () => {
    const renders = []
    const viewer = RenderRegl(fakeExternal(renders))({ appendChild() {} })
    vi.runAllTimers()
    renders.length = 0

    viewer.resize({ width: 300, height: 200 })
    expect(renders).toEqual(['size 300x200', 'render'])
    expect(viewer.state.canvas.width).toBe(300)
  })

  it('cancels a pending deferred render instead of rendering twice', () => {
    const renders = []
    const viewer = RenderRegl(fakeExternal(renders))({ appendChild() {} })
    vi.runAllTimers()
    renders.length = 0

    viewer.setBg([0, 0, 0])
    viewer.resize({ width: 300, height: 200 })
    vi.runAllTimers()
    expect(renders).toEqual(['size 300x200', 'render'])
  })
})
