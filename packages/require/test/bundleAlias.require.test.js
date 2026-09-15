import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { require as jscadRequire, requireCache, jscadClearTempCache } from '../src/require.js'
import { moduleResolver } from '../src/resolution/moduleResolver.js'
import { makeReadFileNode } from '../src/readFileNode.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const base = 'fs:/'
const readFile = makeReadFileNode(join(__dirname, 'solo') + '/')

function resetCaches() {
  jscadClearTempCache()
  requireCache.module = Object.create(null)
  requireCache.moduleAccessOrder = []
  moduleResolver.clearCache()
}

beforeEach(() => {
  delete requireCache.bundleAlias['@t/bundle-pkg']
  resetCaches()
})

afterEach(() => {
  delete requireCache.bundleAlias['@t/bundle-pkg']
  resetCaches()
})

// A local package build served as a bundle alias is a CommonJS bundle, but
// its file may not end in .js/.ts (e.g. the .cjs builds jscad-anchors and
// jscad-fluent produce). It must still be evaled as JavaScript, not routed
// through importData.deserialize as if it were a geometry file.
describe('bundle-aliased modules', () => {
  it('a bundle alias whose URL ends in .cjs is required as JavaScript', () => {
    requireCache.bundleAlias['@t/bundle-pkg'] = 'fs:/bundle.cjs'
    const deserialize = vi.fn(() => ({ fromImportData: true }))
    const mockImportData = { isBinaryExt: () => false, deserialize }

    const result = jscadRequire('@t/bundle-pkg', null, readFile, base, base, mockImportData)

    expect(deserialize).not.toHaveBeenCalled()
    expect(result.magic).toBe(99)
  })

  it('the same .cjs URL without a bundle alias falls through to importData.deserialize', () => {
    const deserialize = vi.fn(() => ({ fromImportData: true }))
    const mockImportData = { isBinaryExt: () => false, deserialize }

    const result = jscadRequire('fs:/bundle.cjs', null, readFile, base, base, mockImportData)

    expect(deserialize).toHaveBeenCalledOnce()
    expect(result.fromImportData).toBe(true)
  })
})
