// The `view` tool's app-side pipeline: normalize the request, resolve look-ats
// to measured centroids, render off-screen and hand the loop raw shots. The
// renderer and the worker are injected, so this suite runs in the node env and
// never touches WebGL; the live render itself is covered by the e2e spec.
import { describe, expect, it, vi } from 'vitest'
import { PRESET_DIRS } from '../src/aiViewRender.js'
import { createViewHandler, partPathsOf } from '../src/aiView.js'

const camera = (x) => ({ position: [x, 0, 0], target: [0, 0, 0], fov: 0.6, aspect: 4 / 3 })

// The mesh entities the viewer carries; the handler only checks it is a
// non-empty array and hands it to the renderer untouched.
const mesh = [{ type: 'mesh' }]

// A renderer stub in the shape of `renderViews`: one shot result per planned
// shot, with a data URL and the camera finally used.
const renderOf = (spy) =>
  vi.fn(async (_mesh, plan) => {
    spy?.push(plan)
    return plan.shots.map((_shot, i) => ({ pngDataUrl: `data:image/png;base64,shot${i}`, camera: camera(i) }))
  })

const handler = (over = {}) =>
  createViewHandler({
    getMesh: () => mesh,
    getPartPaths: () => [],
    measure: vi.fn(async () => ({ parts: [] })),
    noGeometry: async () => null,
    render: renderOf(),
    ...over,
  })

describe('view handler', () => {
  it('returns shots with their cameras and never moves the live camera', async () => {
    // The app's viewer state the handler is wired beside; the handler takes no
    // camera dependency, so this object is the observable proof it stays put.
    const live = { mesh, camera: { position: [180, -180, 220], target: [0, 0, 0] } }
    const before = structuredClone(live.camera)
    const view = handler({ getMesh: () => live.mesh })

    const res = await view({ views: [{ preset: 'top' }] })

    expect(res.ok).toBe(true)
    expect(res.shots).toHaveLength(1)
    expect(res.shots[0].camera.position).toBeDefined()
    expect(live.camera).toEqual(before)
  })

  it('maps the renderer PNG to the loop image shape', async () => {
    const res = await handler()({ views: [{ preset: 'top' }] })
    expect(res).toEqual({
      ok: true,
      shots: [{ image: { dataUrl: 'data:image/png;base64,shot0', mime: 'image/png' }, camera: camera(0) }],
    })
  })

  it('defaults to one iso-front shot at the preset direction', async () => {
    const plans = []
    await handler({ render: renderOf(plans) })(undefined)
    expect(plans[0].shots).toEqual([{ dir: PRESET_DIRS['iso-front'].dir, up: PRESET_DIRS['iso-front'].up }])
    expect(plans[0].size).toEqual({ w: 640, h: 480 })
  })

  it('carries every preset direction into the render plan', async () => {
    const plans = []
    await handler({ render: renderOf(plans) })({ views: [{ preset: 'top' }, { preset: 'left' }] })
    expect(plans[0].shots).toEqual([
      { dir: PRESET_DIRS.top.dir, up: PRESET_DIRS.top.up },
      { dir: PRESET_DIRS.left.dir, up: PRESET_DIRS.left.up },
    ])
  })

  it('errors with no images when the build has no geometry', async () => {
    const render = renderOf()
    const view = handler({ getMesh: () => [], render })
    await expect(view({ views: [{ preset: 'top' }] })).rejects.toThrowError(/geometry/i)
    expect(render).not.toHaveBeenCalled()
  })

  it('uses the last build no-geometry wording when one is available', async () => {
    const view = handler({
      getMesh: () => [],
      noGeometry: async () => ({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: the last build failed (boom); fix it first' } }),
    })
    await expect(view({ views: [{ preset: 'top' }] })).rejects.toThrowError(/the last build failed/)
  })

  it('fails the whole request atomically on one bad view, rendering nothing', async () => {
    const render = renderOf()
    const view = handler({ getPartPaths: () => [{ path: 'front.left', index: 0 }], render })
    await expect(view({ views: [{ preset: 'top' }, { lookAt: 'nope' }] })).rejects.toThrowError(/PartNotFound/)
    expect(render).not.toHaveBeenCalled()
  })

  it('aims a part look-at at its measured center and frames that part box', async () => {
    const measure = vi.fn(async () => ({
      parts: [{ part: '0', center: [7, 0, 2.5], boundingBox: [[6, -1, 0], [8, 1, 5]] }],
    }))
    const plans = []
    const view = handler({ getPartPaths: () => [{ path: 'front.left', index: 0 }], measure, render: renderOf(plans) })

    await view({ views: [{ lookAt: 'front.left' }] })

    expect(measure).toHaveBeenCalledWith({ parts: 'all' })
    expect(plans[0].shots[0]).toEqual({
      dir: PRESET_DIRS['iso-front'].dir,
      up: PRESET_DIRS['iso-front'].up,
      target: [7, 0, 2.5],
      bbox: { min: [6, -1, 0], max: [8, 1, 5] },
    })
  })

  it('does not measure the model for preset-only requests', async () => {
    const measure = vi.fn(async () => ({ parts: [] }))
    await handler({ measure })({ views: [{ preset: 'top' }] })
    expect(measure).not.toHaveBeenCalled()
  })

  it('aims a position spec from the model centre at the requested direction', async () => {
    // A 10-unit cube centred on the origin (`boundingBox` reads the vertices),
    // so the direction from the centre to the requested [100, 0, 0] is +x.
    const cube = [{ type: 'mesh', vertices: new Float32Array([-5, -5, -5, 5, 5, 5]) }]
    const plans = []
    const view = createViewHandler({
      getMesh: () => cube,
      getPartPaths: () => [],
      measure: vi.fn(async () => ({ parts: [] })),
      noGeometry: async () => null,
      render: renderOf(plans),
    })

    await view({ views: [{ position: [100, 0, 0], offset: [0, 0, 0] }] })

    expect(plans[0].shots[0].target).toEqual([0, 0, 0])
    expect(plans[0].shots[0].dir[0]).toBeGreaterThan(0)
    expect(plans[0].shots[0].dir[1]).toBe(0)
    expect(plans[0].shots[0].dir[2]).toBe(0)
  })
})

describe('partPathsOf', () => {
  it('numbers the typed part paths in the order the model created them', () => {
    expect(partPathsOf({ types: { body: 'part', 'front.left': 'part', 'rear.left': 'part' } })).toEqual([
      { path: 'body', index: 0 },
      { path: 'front.left', index: 1 },
      { path: 'rear.left', index: 2 },
    ])
  })

  it('is empty when the build reported no parts', () => {
    expect(partPathsOf(undefined)).toEqual([])
    expect(partPathsOf({ types: {} })).toEqual([])
  })
})
