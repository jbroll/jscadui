import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStreamHook, withStreamHook } from './stream.js'

const mesh = () => ({ type: 'mesh', vertices: new Float32Array(9), normals: new Float32Array(9) })

describe('stream hook', () => {
  afterEach(() => { delete globalThis.__jscadStream })

  it('posts each batch as jscadCells with its buffers for transfer', async () => {
    const post = vi.fn()
    const { hook, emitted } = createStreamHook({ post, userInstances: false })
    const a = mesh()
    await hook.emit([a])
    expect(emitted()).toBe(true)
    const [message, transfer] = post.mock.calls[0]
    expect(message.method).toBe('jscadCells')
    const [entity] = message.params[0].entities
    expect(transfer).toContain(entity.vertices.buffer)
    expect(transfer).toContain(entity.normals.buffer)
    expect(new Set(transfer).size).toBe(transfer.length)
  })

  it('posts copies of the arrays, one per distinct array, leaving the solid and cached entity intact', async () => {
    const post = vi.fn()
    const a = mesh()
    const { hook } = createStreamHook({ post })
    await hook.emit([a, { ...a, transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }])
    const [message, transfer] = post.mock.calls[0]
    const [first, second] = message.params[0].entities
    expect(first.vertices).not.toBe(a.vertices)
    expect(first.vertices).toEqual(a.vertices)
    expect(second.vertices).toBe(first.vertices)
    expect(transfer).not.toContain(a.vertices.buffer)
    expect(transfer).toHaveLength(2)
  })

  it('tags each batch with the run it belongs to', async () => {
    const post = vi.fn()
    await createStreamHook({ post, runId: 7 }).hook.emit([mesh()])
    expect(post.mock.calls[0][0].params[0].runId).toBe(7)
  })

  it('forces manifold evaluation before converting', async () => {
    const numTri = vi.fn()
    const solid = { ...mesh(), isManifoldGeom3: true, manifold: { numTri } }
    await createStreamHook({ post: vi.fn() }).hook.emit([solid])
    expect(numTri).toHaveBeenCalled()
  })

  it('evaluates tree nodes through the injected evaluator before converting', async () => {
    const post = vi.fn()
    const node = { op: 'transforms.translate', params: [1, 2, 3], children: [], isTreeNode: true, dim: 3 }
    const solid = mesh()
    const evaluate = vi.fn(async (_nodes) => ({ solids: [solid], ghosts: [] }))
    const { hook, emitted } = createStreamHook({ post, evaluate })
    await hook.emit([node])
    expect(evaluate).toHaveBeenCalledWith([node])
    expect(emitted()).toBe(true)
    const [message] = post.mock.calls[0]
    const [entity] = message.params[0].entities
    expect(entity.vertices).toEqual(solid.vertices)
    expect(entity.type).not.toBe('unknown')
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
