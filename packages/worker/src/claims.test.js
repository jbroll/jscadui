import { describe, it, expect, vi } from 'vitest'
import { createClaims } from './claims.js'

const counter = () => {
  let n = 0
  return () => `id${++n}`
}

describe('claims', () => {
  it('posts each claim under its own id and resolves it with the answer to that id', async () => {
    const post = vi.fn()
    const claims = createClaims({ post, randomId: counter() })
    const a = claims.claim('0', './a.scad', 7)
    const b = claims.claim('1', './b.scad', 7)
    expect(post.mock.calls.map(([message]) => message)).toEqual([
      { method: 'jscadClaim', id: 'id1', params: [{ key: '0', url: './a.scad', runId: 7, heap: 0 }] },
      { method: 'jscadClaim', id: 'id2', params: [{ key: '1', url: './b.scad', runId: 7, heap: 0 }] },
    ])
    claims.answer({ id: 'id2', won: false })
    claims.answer({ id: 'id1', won: true })
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(false)
  })

  it('reports the heap size the worker holds at each claim', () => {
    const post = vi.fn()
    let bytes = 1024
    const claims = createClaims({ post, randomId: counter(), heap: () => bytes })
    claims.claim('0', './a.scad', 7)
    bytes = 2 ** 30
    claims.claim('1', './b.scad', 7)
    expect(post.mock.calls.map(([message]) => message.params[0].heap)).toEqual([1024, 2 ** 30])
  })

  it('wins only on won === true and ignores unknown or repeated answers', async () => {
    const claims = createClaims({ post: vi.fn(), randomId: counter() })
    const a = claims.claim('0', './a.scad', 1)
    claims.answer({ id: 'nobody', won: true })
    claims.answer()
    claims.answer({ id: 'id1', won: 'yes' })
    claims.answer({ id: 'id1', won: true })
    await expect(a).resolves.toBe(false)
  })

  it('makes distinct string ids without crypto.randomUUID, which the frame worker lacks', () => {
    const realCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
    try {
      const post = vi.fn()
      const claims = createClaims({ post })
      for (let i = 0; i < 10; i++) claims.claim('k' + i, './a.scad', 1)
      const ids = post.mock.calls.map(([message]) => message.id)
      expect(new Set(ids).size).toBe(10)
      for (const id of ids) expect(typeof id).toBe('string')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
