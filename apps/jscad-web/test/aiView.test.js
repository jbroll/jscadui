// The `view` tool's app-side pipeline: normalize the request, resolve look-ats
// and render off-screen, then hand the loop raw shots. The renderer is
// injected, so this suite runs in the node env and never touches WebGL; the
// live render itself is covered by the e2e spec.
//
// Part-name aims are refused here: nothing in a build reports which geometry
// item belongs to which typed param path, so a name cannot be mapped to a
// measured centre (test/aiViewProvenance.test.js pins that with a real model).
import { describe, expect, it, vi } from 'vitest'
import { PRESET_DIRS } from '../src/aiViewRender.js'
import { createViewHandler } from '../src/aiView.js'

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

  it('aims a lookAt point at that point', async () => {
    const plans = []
    await handler({ render: renderOf(plans) })({ views: [{ lookAt: [3, -4, 5] }] })

    expect(plans[0].shots[0]).toEqual({
      dir: PRESET_DIRS['iso-front'].dir,
      up: PRESET_DIRS['iso-front'].up,
      target: [3, -4, 5],
    })
  })

  it('refuses a part-name lookAt and renders nothing', async () => {
    const render = renderOf()
    const view = handler({ render })

    await expect(view({ views: [{ lookAt: 'front.left' }] })).rejects.toThrowError(/PartLookAtUnsupportedError/)
    expect(render).not.toHaveBeenCalled()
  })

  it('names the part and the coordinate route in the unsupported-part message', async () => {
    // The agent must be able to act on the error: the name it asked for, why it
    // cannot be resolved, and the measure-then-coordinates route that can.
    await expect(handler()({ views: [{ lookAt: 'body.cabin' }] })).rejects.toThrowError(
      /body\.cabin[\s\S]*measure[\s\S]*\[x, y, z\]/,
    )
  })

  it('fails the whole request atomically on an unsupported part aim, rendering nothing', async () => {
    const render = renderOf()
    const view = handler({ render })
    await expect(view({ views: [{ preset: 'top' }, { lookAt: 'nope' }] })).rejects.toThrowError(/PartLookAtUnsupported/)
    expect(render).not.toHaveBeenCalled()
  })

  it('aims a position spec from the model centre at the requested direction', async () => {
    // A 10-unit cube centred on the origin (`boundingBox` reads the vertices),
    // so the direction from the centre to the requested [100, 0, 0] is +x.
    const cube = [{ type: 'mesh', vertices: new Float32Array([-5, -5, -5, 5, 5, 5]) }]
    const plans = []
    const view = createViewHandler({
      getMesh: () => cube,
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
