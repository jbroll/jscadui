import { describe, it, expect, vi } from 'vitest'
import { handleToolRequest } from '../src/toolBridge.js'

const fakeFrame = (overrides = {}) => ({
  load: vi.fn(async () => ({ ok: true, result: { params: {}, entities: [] } })),
  params: vi.fn(async () => ({ ok: true, result: { entities: [] } })),
  measure: vi.fn(async () => ({ ok: true, result: { size: [10, 10, 10] } })),
  check: vi.fn(async () => ({ ok: true, result: { fits: true } })),
  export: vi.fn(async () => ({ ok: true, result: { data: [] } })),
  ...overrides,
})

const fakeViewer = () => ({
  getCamera: vi.fn(() => ({ position: [180, -180, 220], target: [0, 0, 0] })),
  setCamera: vi.fn(),
  capture: vi.fn(async () => 'data:image/png;base64,AAAA'),
})

describe('handleToolRequest', () => {
  it('routes measure to the frame with the measure options', async () => {
    const frame = fakeFrame()
    const result = await handleToolRequest('measure', { parts: 'body' }, { frame, viewer: fakeViewer(), save: vi.fn() })
    expect(frame.measure).toHaveBeenCalledWith({ options: { parts: 'body' } })
    expect(result).toEqual({ ok: true, result: { size: [10, 10, 10] } })
  })

  it('translates eval into a frame load of the given source', async () => {
    const frame = fakeFrame()
    await handleToolRequest('eval', { source: 'const a = 1', entry: 'part.js' }, { frame, viewer: fakeViewer(), save: vi.fn() })
    expect(frame.load).toHaveBeenCalledWith({ files: { 'part.js': 'const a = 1' }, entry: 'part.js' })
  })

  it('serves view from the viewer and returns a PNG data URL', async () => {
    const frame = fakeFrame()
    const viewer = fakeViewer()
    const result = await handleToolRequest(
      'view',
      { camera: { position: [1, 2, 3], target: [0, 0, 0] } },
      { frame, viewer, save: vi.fn() },
    )
    expect(viewer.setCamera).toHaveBeenCalledWith({ position: [1, 2, 3], target: [0, 0, 0] })
    expect(viewer.capture).toHaveBeenCalled()
    expect(result.image).toMatch(/^data:image\/png/)
    expect(frame.measure).not.toHaveBeenCalled()
  })

  it('resolves a view preset to a camera at the current distance', async () => {
    const viewer = fakeViewer()
    await handleToolRequest('view', { preset: 'T' }, { frame: fakeFrame(), viewer, save: vi.fn() })
    const [camera] = viewer.setCamera.mock.calls[0]
    expect(camera.target).toEqual([0, 0, 0])
    // Top view looks down the Z axis, so the position sits above the target.
    expect(camera.position[2]).toBeGreaterThan(300)
  })

  it('routes writeModel to the storage seam', async () => {
    const frame = fakeFrame()
    const save = vi.fn(async () => ({ version: 1 }))
    const result = await handleToolRequest(
      'writeModel',
      { source: 'const a = 1', entry: 'part.js', message: 'first' },
      { frame, viewer: fakeViewer(), save },
    )
    expect(save).toHaveBeenCalledWith('const a = 1', 'part.js')
    expect(result.ok).toBe(true)
    expect(result.entry).toBe('part.js')
    expect(result.message).toBe('first')
  })

  it('returns an error result for an unknown tool rather than throwing', async () => {
    const result = await handleToolRequest('explode', {}, { frame: fakeFrame(), viewer: fakeViewer(), save: vi.fn() })
    expect(result.ok).toBe(false)
    expect(result.error.message).toMatch(/explode/)
  })

  it('turns a frame rejection into an error result', async () => {
    const frame = fakeFrame({
      measure: vi.fn(async () => {
        throw new Error('frame timed out')
      }),
    })
    const result = await handleToolRequest('measure', {}, { frame, viewer: fakeViewer(), save: vi.fn() })
    expect(result.ok).toBe(false)
    expect(result.error.message).toBe('frame timed out')
  })
})
