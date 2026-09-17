// Mixed local/rowboat models merge at load time: manifest files come from
// their tagged backend, unlisted sibling requires resolve local-first.
import { describe, expect, it } from 'vitest'
import { assembleFileMap, resolveRequire } from '../src/storage/map.js'

describe('mixed-manifest map assembly', () => {
  it('takes each manifest path from its tagged backend', () => {
    const files = assembleFileMap(
      { 'main.js': 'local', 'lib/gear.js': 'rowboat' },
      { local: { 'main.js': 'local-main' }, rowboat: { 'lib/gear.js': 'rowboat-gear' } },
    )
    expect(files).toEqual({ 'main.js': 'local-main', 'lib/gear.js': 'rowboat-gear' })
  })

  it('throws naming the path and backend when a manifest file is absent', () => {
    expect(() => assembleFileMap({ 'main.js': 'local' }, { local: {}, rowboat: {} })).toThrow(
      /main\.js.*local/,
    )
  })

  it('resolves unlisted siblings local-first then rowboat', () => {
    const maps = { local: { 'util.js': 'local-util' }, rowboat: { 'util.js': 'rowboat-util', 'only.js': 'r' } }
    expect(resolveRequire('util.js', maps)).toBe('local-util')
    expect(resolveRequire('only.js', maps)).toBe('r')
    expect(resolveRequire('missing.js', maps)).toBeUndefined()
  })
})
