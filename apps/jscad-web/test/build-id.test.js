import { describe, it, expect } from 'vitest'
import { entryHash } from '../src_build/buildId.js'

describe('entryHash', () => {
  it('reads the hashed app entry from index.html', () => {
    const html = '<link rel="stylesheet" href="main.1a2b3c4d.css">\n<script type="module" src="./main.0f9e8d7c.js"></script>'
    expect(entryHash(html, 'main')).toBe('0f9e8d7c')
  })
  it('reads the hashed frame entry', () => {
    expect(entryHash('<script type="module" src="./frame.deadbeef.js"></script>', 'frame')).toBe('deadbeef')
  })
  it('returns null for an unhashed build', () => {
    expect(entryHash('<script type="module" src="./main.js"></script>', 'main')).toBeNull()
  })
  it('does not match a longer name ending in the entry', () => {
    expect(entryHash('<script src="./notmain.0f9e8d7c.js"></script>', 'main')).toBeNull()
  })
})
