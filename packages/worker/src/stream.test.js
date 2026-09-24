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
    const [entity] = message.params[0].entities
    expect(transfer).toContain(entity.vertices.buffer)
    expect(transfer).toContain(entity.normals.buffer)
    expect(new Set(transfer).size).toBe(transfer.length)
  })

  it('posts copies of the arrays, one per distinct array, leaving the solid and cached entity intact', () => {
    const post = vi.fn()
    const a = mesh()
    const { hook } = createStreamHook({ post })
    hook.emit([a, { ...a, transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }])
    const [message, transfer] = post.mock.calls[0]
    const [first, second] = message.params[0].entities
    expect(first.vertices).not.toBe(a.vertices)
    expect(first.vertices).toEqual(a.vertices)
    expect(second.vertices).toBe(first.vertices)
    expect(transfer).not.toContain(a.vertices.buffer)
    expect(transfer).toHaveLength(2)
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

  it('offers claim only when given one, passing the runId and marking the run emitted', async () => {
    expect(createStreamHook({ post: vi.fn() }).hook.claim).toBeUndefined()
    const claim = vi.fn(async () => false)
    const { hook, emitted } = createStreamHook({ post: vi.fn(), runId: 3, claim })
    await expect(hook.claim('0/1', './a.scad')).resolves.toBe(false)
    expect(claim).toHaveBeenCalledWith('0/1', './a.scad', 3)
    expect(emitted()).toBe(true)
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
