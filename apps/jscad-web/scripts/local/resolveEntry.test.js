// apps/jscad-web/scripts/local/resolveEntry.test.js
import { describe, expect, it } from 'vitest'
import { resolveEntry } from './resolveEntry.js'

const files = (names, json = null) => ({
  readDir: async () => names,
  readText: async (p) => (p === 'package.json' && json ? JSON.stringify(json) : ''),
})

describe('resolveEntry', () => {
  it('explicit file wins', async () => {
    const r = await resolveEntry('/m', { explicitFile: 'foo.js', ...files(['foo.js']) })
    expect(r).toEqual({ entryFile: 'foo.js', urlPath: '/models/foo.js' })
  })
  it('package.json main, then index.js, then main.js, then <dirname>.js, then first *.js', async () => {
    expect((await resolveEntry('/m', files(['a.js', 'main.js', 'package.json'], { main: 'a.js' }))).entryFile).toBe('a.js')
    expect((await resolveEntry('/m', files(['index.js', 'b.js']))).entryFile).toBe('index.js')
    expect((await resolveEntry('/moo', files(['moo.js', 'main.js']))).entryFile).toBe('main.js')
    expect((await resolveEntry('/moo', files(['moo.js', 'z.js']))).entryFile).toBe('moo.js')
    expect((await resolveEntry('/m', files(['z.js', 'a.js']))).entryFile).toBe('a.js')
  })
  it('opens a package.json main in a subdirectory', async () => {
    const r = await resolveEntry('/m', files(['package.json', 'src', 'index.js'], { main: 'src/box.js' }))
    expect(r).toEqual({ entryFile: 'src/box.js', urlPath: '/models/src/box.js' })
  })
  it('throws when no entry exists', async () => {
    await expect(resolveEntry('/m', files(['README.md']))).rejects.toThrow(/no entry/i)
  })
})
