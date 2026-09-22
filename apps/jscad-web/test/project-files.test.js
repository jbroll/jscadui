import { describe, it, expect } from 'vitest'
import { collectProjectFiles, isBinaryPath, replaceProjectFiles } from '../src/projectFiles.js'

// Mirrors what the real Cache API does: addToCache() calls cache.put(new
// Request(path), ...) with a leading-slash, project-relative path, which
// resolves against the document origin with no swfs segment at all.
const fakeSw = (entries) => ({
  base: 'http://localhost:5120/swfs/',
  cache: {
    keys: async () => Object.keys(entries).map((path) => ({ url: new URL(`/${path}`, 'http://localhost:5120/').href })),
    match: async (request) => {
      const path = new URL(request.url ?? request).pathname.replace(/^\//, '')
      const body = entries[path]
      return {
        text: async () => String(body),
        arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new TextEncoder().encode(String(body)).buffer),
      }
    },
  },
})

describe('collectProjectFiles', () => {
  it('reads text entries as strings keyed by path', async () => {
    const files = await collectProjectFiles(fakeSw({ 'main.js': 'export const a = 1', 'lib/part.js': 'x' }))
    expect(files['main.js']).toBe('export const a = 1')
    expect(files['lib/part.js']).toBe('x')
  })

  it('reads binary entries as ArrayBuffer', async () => {
    const files = await collectProjectFiles(fakeSw({ 'part.stl': new ArrayBuffer(4) }))
    expect(files['part.stl']).toBeInstanceOf(ArrayBuffer)
  })

  it('returns an empty map with no handler', async () => {
    expect(await collectProjectFiles(undefined)).toEqual({})
  })

  it('keys carry no leading slash', async () => {
    const files = await collectProjectFiles(fakeSw({ 'index.js': 'x' }))
    expect(Object.keys(files)).toEqual(['index.js'])
    expect(files['/index.js']).toBeUndefined()
  })
})

describe('isBinaryPath', () => {
  it('classifies by extension', () => {
    expect(isBinaryPath('a/b/part.stl')).toBe(true)
    expect(isBinaryPath('a/b/model.js')).toBe(false)
  })
})

describe('replaceProjectFiles', () => {
  const fakeFileSystem = () => {
    const cached = new Map()
    return {
      cached,
      clearProjectCache: async () => cached.clear(),
      addToCacheWrapper: async (path, content) => { cached.set(path, content) },
    }
  }

  it('leaves the previous project out of the cache', async () => {
    const fs = fakeFileSystem()
    await replaceProjectFiles(fs, { 'main.js': 'first', 'only-in-first.js': 'x' })
    await replaceProjectFiles(fs, { 'main.js': 'second' })

    expect([...fs.cached.keys()]).toEqual(['main.js'])
    expect(fs.cached.get('main.js')).toBe('second')
  })

  it('clears before it writes', async () => {
    const order = []
    const fs = {
      clearProjectCache: async () => order.push('clear'),
      addToCacheWrapper: async (path) => order.push(`add ${path}`),
    }
    await replaceProjectFiles(fs, { 'a.js': '', 'b.js': '' })
    expect(order).toEqual(['clear', 'add a.js', 'add b.js'])
  })
})
