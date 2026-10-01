import { afterEach, describe, expect, it } from 'vitest'

import { setLibraryPrefixes } from '../src/resolution/moduleResolver.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'

afterEach(() => setLibraryPrefixes({}))

describe('library prefixes', () => {
  it('maps a bare specifier under a library name to its base URL', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'https://app.test/libs/NopSCADlib/' })
    const { url } = moduleResolver.resolve('NopSCADlib/vitamins/nuts.scad', 'http://project.local/', 'http://project.local/')
    expect(url).toBe('https://app.test/libs/NopSCADlib/vitamins/nuts.scad')
  })

  it('leaves other bare specifiers on the CDN', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'https://app.test/libs/NopSCADlib/' })
    const { url } = moduleResolver.resolve('lodash/fp.js', 'http://project.local/', 'http://project.local/')
    expect(url).toContain('cdn.jsdelivr.net/npm/lodash/')
  })

  it('prefers the longest matching prefix', () => {
    setLibraryPrefixes({
      'BOSL2/': 'https://app.test/libs/BOSL2/',
      'BOSL2/vendor/': 'https://app.test/libs/_catalog/BOSL2-vendor/',
    })
    const { url } = moduleResolver.resolve('BOSL2/vendor/screws.scad', 'http://project.local/', 'http://project.local/')
    expect(url).toBe('https://app.test/libs/_catalog/BOSL2-vendor/screws.scad')
  })

  // The transpiler's own `use` requires emit the library file's absolute
  // path (e.g. '/libs/NopSCADlib/vitamins/nut.scad'), not the bare
  // 'NopSCADlib/...' specifier a project file would write. Both have to
  // resolve to the same cache bucket (isRelativeFile) or a module reachable
  // both ways loads twice, and a mutual `use` between two such files (like
  // NopSCADlib's nut.scad/screw.scad) trips the circular-load guard on the
  // second path instead of finding the pending placeholder from the first.
  it('resolves a bare specifier and the library\'s own absolute path to the same cache bucket', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'http://project.local/libs/NopSCADlib/' })
    const bare = moduleResolver.resolve('NopSCADlib/vitamins/nut.scad', 'http://project.local/main.js', 'http://project.local/')
    const absolute = moduleResolver.resolve(
      '/libs/NopSCADlib/vitamins/nut.scad',
      'http://project.local/libs/NopSCADlib/vitamins/screw.scad',
      'http://project.local/',
    )
    expect(absolute.url).toBe(bare.url)
    expect(absolute.isRelativeFile).toBe(bare.isRelativeFile)
    expect(bare.isRelativeFile).toBe(false)
  })
})
