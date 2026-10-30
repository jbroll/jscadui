import { describe, expect, it, vi } from 'vitest'
import { PRESET_DIRS } from '../src/viewSpec.js'
import { NO_TRIANGLES } from './mesh.js'
import { createEvalView, viewStub, withoutImages } from './view.js'

// A 10-unit cube's corners as two triangles, centred on [5, 5, 5].
const cube = [{ color: null, positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 10, 0, 0, 0, 10, 10, 10, 0, 10, 10]) }]

const camera = (i) => ({ position: [i, 0, 0], target: [0, 0, 0], up: [0, 0, 1] })

const fakeRenderer = () =>
  vi.fn(async (_parts, plan) => plan.shots.map((_shot, i) => ({ pngDataUrl: `data:image/png;base64,shot${i}`, camera: camera(i) })))

// measure as the eval backend answers it: JSON text, the last build's error when nothing built.
const fakeBackend = ({ built = true, anchors = [], centers = {} } = {}) => ({
  mesh: vi.fn(async () => (built ? { parts: cube } : { error: NO_TRIANGLES })),
  requestTool: vi.fn(async (name, input) => {
    expect(name).toBe('measure')
    if (!built) return JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: the last build failed (boom)' } })
    if (input.parts) return JSON.stringify({ ok: true, parts: input.parts.map((part) => ({ part, center: centers[part] })) })
    return JSON.stringify({ ok: true, anchors })
  }),
})

const viewOf = (backend, renderShots = fakeRenderer()) => ({ view: createEvalView({ ...backend, renderShots }), renderShots })

describe('createEvalView', () => {
  it('renders a preset in the loop image shape', async () => {
    const { view, renderShots } = viewOf(fakeBackend())
    const out = await view({ views: [{ preset: 'top' }], size: { w: 320, h: 240 } })
    expect(out).toEqual({ ok: true, shots: [{ image: { dataUrl: 'data:image/png;base64,shot0', mime: 'image/png' }, camera: camera(0) }] })
    expect(renderShots.mock.calls[0].slice(0, 2)).toEqual([cube, { shots: [{ dir: PRESET_DIRS.top.dir, up: PRESET_DIRS.top.up }], size: { w: 320, h: 240 } }])
  })

  it('renders one iso-front at the default size for an empty call', async () => {
    const { view, renderShots } = viewOf(fakeBackend())
    await view({})
    expect(renderShots.mock.calls[0][1]).toEqual({ shots: [{ dir: PRESET_DIRS['iso-front'].dir, up: PRESET_DIRS['iso-front'].up }], size: { w: 640, h: 480 } })
  })

  it('answers a bad call with an ArgumentsError tool error and renders nothing', async () => {
    const { view, renderShots } = viewOf(fakeBackend())
    const out = JSON.parse(await view({ views: [{ preset: 'sideways' }] }))
    expect(out).toMatchObject({ ok: false, error: { name: 'ArgumentsError' } })
    expect(renderShots).not.toHaveBeenCalled()
  })

  it('answers the last build own no-geometry error when nothing built', async () => {
    const { view, renderShots } = viewOf(fakeBackend({ built: false }))
    const out = JSON.parse(await view({}))
    expect(out).toEqual({ ok: false, error: { name: 'NoGeometryError', message: 'NoGeometryError: no geometry: the last build failed (boom)' } })
    expect(renderShots).not.toHaveBeenCalled()
  })

  it('answers a mesh that could not be sent as a ViewRenderError', async () => {
    const backend = { ...fakeBackend(), mesh: async () => ({ error: 'the mesh is 30000000 bytes, over the 25165824-byte limit' }) }
    const out = JSON.parse(await viewOf(backend).view({}))
    expect(out.error.name).toBe('ViewRenderError')
    expect(out.error.message).toMatch(/over the 25165824-byte limit/)
  })

  it('aims at a part name through measure anchors and at an index through its centre', async () => {
    const backend = fakeBackend({
      anchors: [{ part: '0', anchors: { lid: { origin: [0, 0, 30] } } }, { part: '1', anchors: {} }],
      centers: { 1: [7, 8, 9] },
    })
    const { view, renderShots } = viewOf(backend)
    await view({ views: [{ lookAt: 'lid' }, { preset: 'left', lookAt: 1 }] })
    expect(renderShots.mock.calls[0][1].shots).toEqual([
      { dir: PRESET_DIRS['iso-front'].dir, up: PRESET_DIRS['iso-front'].up, target: [0, 0, 30] },
      { dir: PRESET_DIRS.left.dir, up: PRESET_DIRS.left.up, target: [7, 8, 9] },
    ])
    expect(backend.requestTool).toHaveBeenCalledWith('measure', { anchors: true })
    expect(backend.requestTool).toHaveBeenCalledWith('measure', { parts: ['1'] })
  })

  it('answers a part the build lacks with PartNotFoundError', async () => {
    const out = JSON.parse(await viewOf(fakeBackend({ anchors: [{ part: '0', anchors: {} }] })).view({ lookAt: 'wheel' }))
    expect(out.error.name).toBe('PartNotFoundError')
  })

  it('looks from a position at the centre of the triangles', async () => {
    const { view, renderShots } = viewOf(fakeBackend())
    await view({ position: [100, 5, 5] })
    expect(renderShots.mock.calls[0][1].shots[0]).toEqual({ dir: [1, 0, 0], up: [0, 0, 1], target: [5, 5, 5] })
  })

  it('answers a renderer failure as a tool error, never a throw', async () => {
    const out = JSON.parse(await viewOf(fakeBackend(), async () => Promise.reject(new Error('browser closed'))).view({}))
    expect(out).toEqual({ ok: false, error: { name: 'Error', message: 'browser closed' } })
  })
})

describe('viewStub and withoutImages', () => {
  it('keep the cameras and drop every data URL', () => {
    const result = { ok: true, shots: [{ image: { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png' }, camera: camera(1) }] }
    expect(viewStub(result)).toBe(JSON.stringify({ ok: true, cameras: [camera(1)] }))
    expect(viewStub('{"ok":false}')).toBe('{"ok":false}')
    const message = { role: 'tool', toolCallId: 'c1', content: viewStub(result), images: [result.shots[0].image] }
    expect(withoutImages(message)).toEqual({ role: 'tool', toolCallId: 'c1', content: viewStub(result) })
    const user = { role: 'user', content: 'hi' }
    expect(withoutImages(user)).toBe(user)
  })
})
