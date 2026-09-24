import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStreamHook, withStreamHook } from './stream.js'

const mesh = () => ({ type: 'mesh', vertices: new Float32Array(9), normals: new Float32Array(9) })

describe('stream hook', () => {
  afterEach(() => { delete globalThis.__jscadStream })

  it('posts each batch as jscadCells with its buffers for transfer', () => {
    const post = vi.fn()
    const { hook, emitted } = createStreamHook({ post, userInstances: false })
    const a = mesh()
    hook.emit([a])
    expect(emitted()).toBe(true)
    const [message, transfer] = post.mock.calls[0]
    expect(message.method).toBe('jscadCells')
    expect(message.params[0].entities).toHaveLength(1)
    expect(transfer).toContain(a.vertices.buffer)
    expect(transfer).toContain(a.normals.buffer)
    expect(new Set(transfer).size).toBe(transfer.length)
  })

  it('tags each batch with the run it belongs to', () => {
    const post = vi.fn()
    createStreamHook({ post, runId: 7 }).hook.emit([mesh()])
    expect(post.mock.calls[0][0].params[0].runId).toBe(7)
  })

  it('forces manifold evaluation before converting', () => {
    const numTri = vi.fn()
    const solid = { ...mesh(), isManifoldGeom3: true, manifold: { numTri } }
    createStreamHook({ post: vi.fn() }).hook.emit([solid])
    expect(numTri).toHaveBeenCalled()
  })

  it('posts progress with no geometry', () => {
    const post = vi.fn()
    const { hook, emitted } = createStreamHook({ post })
    hook.progress()
    expect(post).toHaveBeenCalledWith({ method: 'jscadProgress', params: [] })
    expect(emitted()).toBe(false)
  })

  it('sets the hook for the run and clears it after, even on a throw', async () => {
    const hook = {}
    let seen
    await withStreamHook(hook, async () => { seen = globalThis.__jscadStream })
    expect(seen).toBe(hook)
    expect(globalThis.__jscadStream).toBeNull()
    await expect(withStreamHook(hook, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(globalThis.__jscadStream).toBeNull()
  })
})
