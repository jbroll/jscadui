import { afterEach, describe, expect, it } from 'vitest'

import { setLibraryPrefixes } from '../src/resolution/moduleResolver.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'
import { cacheManager } from '../src/caching/cacheManager.js'

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

  // A project's bare 'Lib/...' require and the transpiler's own absolute
  // '/libs/Lib/...' `use` request must resolve to the same library url.
  it('resolves a bare specifier and the library\'s own absolute path to the same url', () => {
    setLibraryPrefixes({ 'NopSCADlib/': 'https://app.test/libs/NopSCADlib/' })
    const bare = moduleResolver.resolve('NopSCADlib/vitamins/nut.scad', 'http://project.local/main.js', 'http://project.local/')
    const absolute = moduleResolver.resolve(
      '/libs/NopSCADlib/vitamins/nut.scad',
      'https://app.test/libs/NopSCADlib/vitamins/screw.scad',
      'http://project.local/',
    )
    expect(absolute.url).toBe(bare.url)
    expect(cacheManager.isLibraryUrl(bare.url)).toBe(true)
  })
})
