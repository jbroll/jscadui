// The renderer is injected, so this suite never touches WebGL; the app's live
// render is covered by its e2e spec, the eval's by eval/render.test.js.
//
// A part-name aim resolves through the build's auto-attached anchors, injected
// as `measure({anchors: true})` frames (apps/jscad-web/test/aiViewProvenance.test.js
// pins that against the real model).
import { describe, expect, it, vi } from 'vitest'
import { PRESET_DIRS } from './viewSpec.js'
import { createViewHandler } from './viewHandler.js'

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

  it('aims a part-name lookAt at its auto-attached anchor frame', async () => {
    const plans = []
    const measure = vi.fn(async () => ({
      anchors: [
        { part: '0', anchors: { body: { origin: [0, 0, 4.5], z: [0, 0, 1], x: [1, 0, 0] } } },
        { part: '1', anchors: { 'front.left': { origin: [7, -6, 0], z: [0, 0, 1], x: [1, 0, 0] } } },
      ],
    }))
    const view = handler({ render: renderOf(plans), measure })

    await view({ views: [{ lookAt: 'front.left' }] })

    expect(plans[0].shots[0]).toEqual({
      dir: PRESET_DIRS['iso-front'].dir,
      up: PRESET_DIRS['iso-front'].up,
      target: [7, -6, 0],
    })
    // The frame map is built once for the whole call, not once per shot.
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith({ anchors: true })
  })

  // Answers as the frame's measure does: anchors per item, and each selector's
  // bounding-box center when `parts` is asked for.
  const indexedMeasure = () =>
    vi.fn(async (options) => {
      if (options.anchors) {
        return { anchors: [0, 1, 2].map((i) => ({ part: String(i), anchors: i === 0 ? { body: { origin: [0, 0, 4.5] } } : {} })) }
      }
      return { parts: options.parts.map((part) => ({ part, center: [Number(part.split('-').at(-1)) * 10, 0, 0] })) }
    })

  it('aims an index, a range or a whole-number lookAt at that selection, as measure and check number parts', async () => {
    const plans = []
    const measure = indexedMeasure()
    await handler({ render: renderOf(plans), measure })({ views: [{ lookAt: '1' }, { lookAt: '1-2' }, { lookAt: 2 }, { lookAt: 'body' }] })

    expect(plans[0].shots.map((shot) => shot.target)).toEqual([
      [10, 0, 0],
      [20, 0, 0],
      [20, 0, 0],
      [0, 0, 4.5],
    ])
    expect(measure).toHaveBeenCalledWith({ parts: ['1', '1-2', '2'] })
  })

  it('refuses an index past the last part, listing the forms lookAt takes', async () => {
    const render = renderOf()
    const view = handler({ render, measure: indexedMeasure() })
    const error = await view({ views: [{ lookAt: '51-54' }] }).catch((e) => e)
    expect(error.name).toBe('PartNotFoundError')
    expect(error.message).toMatch(/"51-54".*"0" to "2".*"1-3".*body/)
    expect(render).not.toHaveBeenCalled()
  })

  it('lists the indexes and names a build carries when a name misses', async () => {
    const error = await handler({ measure: indexedMeasure() })({ views: [{ lookAt: 'wheel' }] }).catch((e) => e)
    expect(error.name).toBe('PartNotFoundError')
    expect(error.message).toMatch(/"wheel".*"0" to "2".*"1-3".*body/)
  })

  it('never measures when no shot names a part', async () => {
    const measure = vi.fn(async () => ({ anchors: [] }))
    await handler({ measure })({ views: [{ preset: 'top' }, { lookAt: [1, 2, 3] }] })
    expect(measure).not.toHaveBeenCalled()
  })

  it('errors on a part name no build names, rendering nothing', async () => {
    const render = renderOf()
    const measure = async () => ({ anchors: [{ part: '0', anchors: { body: { origin: [0, 0, 4.5], z: [0, 0, 1], x: [1, 0, 0] } } }] })
    const view = handler({ render, measure })

    await expect(view({ views: [{ lookAt: 'ghost-part' }] })).rejects.toThrowError(/PartNotFound/)
    expect(render).not.toHaveBeenCalled()
  })

  it('fails the whole request atomically on an unknown part aim, rendering nothing', async () => {
    const render = renderOf()
    const measure = async () => ({ anchors: [{ part: '0', anchors: { body: { origin: [0, 0, 4.5], z: [0, 0, 1], x: [1, 0, 0] } } }] })
    const view = handler({ render, measure })
    await expect(view({ views: [{ preset: 'top' }, { lookAt: 'nope' }] })).rejects.toThrowError(/PartNotFound/)
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

  it('aims a preset direction at a lookAt point or part given beside it', async () => {
    const plans = []
    const measure = vi.fn(async () => ({ anchors: [{ part: '0', anchors: { lid: { origin: [0, 0, 30] } } }] }))
    await handler({ render: renderOf(plans), measure })({ views: [{ preset: 'top', lookAt: [3, -4, 5] }, { preset: 'left', lookAt: 'lid' }] })
    expect(plans[0].shots).toEqual([
      { dir: PRESET_DIRS.top.dir, up: PRESET_DIRS.top.up, target: [3, -4, 5] },
      { dir: PRESET_DIRS.left.dir, up: PRESET_DIRS.left.up, target: [0, 0, 30] },
    ])
  })

  it('looks from a position at a lookAt point given beside it', async () => {
    const plans = []
    await handler({ render: renderOf(plans) })({ views: [{ position: [10, 0, 5], lookAt: [0, 0, 5] }] })
    expect(plans[0].shots[0]).toEqual({ dir: [1, 0, 0], up: [0, 0, 1], target: [0, 0, 5] })
  })
})
