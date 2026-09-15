import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { require as jscadRequire, requireCache, clearAllCaches } from '../src/require.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'

// Regression for the jscad-web export bug: bundle.worker.js requires the io
// bundle with no base/root. A relative path in that shape resolves to itself
// unchanged (see resolveUrl.js's `isRelativeFile && root` guard), which
// readFileWeb then resolves against the bare origin, dropping any path
// prefix like /build/. Requiring by the bundle's registered alias name
// sidesteps base/root resolution entirely.
describe('requiring a hashed build bundle with no base/root', () => {
  beforeEach(() => {
    delete requireCache.bundleAlias['@t/export-bundle']
    clearAllCaches()
    moduleResolver.clearCache()
  })
  afterEach(() => {
    delete requireCache.bundleAlias['@t/export-bundle']
    clearAllCaches()
    moduleResolver.clearCache()
  })

  it('a relative sibling path is passed to readFile unresolved', () => {
    const readFile = vi.fn(() => 'module.exports = {}')
    jscadRequire('./bundle.jscad_io.abc123.js', null, readFile)
    expect(readFile).toHaveBeenCalledWith('./bundle.jscad_io.abc123.js')
  })

  it('the same bundle required by its registered alias resolves to its absolute URL', () => {
    requireCache.bundleAlias['@t/export-bundle'] = 'https://example.com/build/bundle.jscad_io.abc123.js'
    const readFile = vi.fn(() => 'module.exports = {}')
    jscadRequire('@t/export-bundle', null, readFile)
    expect(readFile).toHaveBeenCalledWith('https://example.com/build/bundle.jscad_io.abc123.js')
  })
})
