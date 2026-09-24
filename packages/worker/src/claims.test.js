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
      { method: 'jscadClaim', id: 'id1', params: [{ key: '0', url: './a.scad', runId: 7 }] },
      { method: 'jscadClaim', id: 'id2', params: [{ key: '1', url: './b.scad', runId: 7 }] },
    ])
    claims.answer({ id: 'id2', won: false })
    claims.answer({ id: 'id1', won: true })
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(false)
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
})
