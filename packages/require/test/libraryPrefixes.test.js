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
})
