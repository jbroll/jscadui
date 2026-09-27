// apps/jscad-web/scripts/local/resolveEntry.test.js
import { describe, expect, it } from 'vitest'
import { resolveEntry } from './resolveEntry.js'

const files = (names, json = null) => ({
  readDir: async () => names,
  readJson: async (p) => (p.endsWith('package.json') ? json : null),
})

describe('resolveEntry', () => {
  it('explicit file wins', async () => {
    const r = await resolveEntry('/m', { explicitFile: 'foo.js', ...files(['foo.js']) })
    expect(r).toEqual({ entryFile: 'foo.js', urlPath: '/models/foo.js' })
  })
  it('package.json main, then index.js, then <dirname>.js, then first *.js', async () => {
    expect((await resolveEntry('/m', files(['a.js', 'main.js', 'package.json'], { main: 'main.js' }))).entryFile).toBe('main.js')
    expect((await resolveEntry('/m', files(['index.js', 'b.js']))).entryFile).toBe('index.js')
    expect((await resolveEntry('/moo', files(['moo.js', 'z.js']))).entryFile).toBe('moo.js')
    expect((await resolveEntry('/m', files(['z.js', 'a.js']))).entryFile).toBe('a.js')
  })
  it('throws when no entry exists', async () => {
    await expect(resolveEntry('/m', files(['README.md']))).rejects.toThrow(/no entry/i)
  })
})
