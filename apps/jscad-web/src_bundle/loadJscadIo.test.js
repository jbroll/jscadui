import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { require as jscadRequire, requireCache, clearAllCaches } from '@jscadui/require'
import { moduleResolver } from '@jscadui/require/src/resolution/moduleResolver.js'

import { loadJscadIo } from './loadJscadIo.js'

const IO_URL = 'http://viewer.test/build/bundle.jscad_io.abc123.js'

beforeEach(() => {
  requireCache.bundleAlias['@jscad/io'] = IO_URL
  clearAllCaches()
  moduleResolver.clearCache()
})

afterEach(() => {
  delete requireCache.bundleAlias['@jscad/io']
  clearAllCaches()
  moduleResolver.clearCache()
})

describe('loadJscadIo', () => {
  it('reads the io bundle at its registered /build/ URL, with no base', () => {
    const readFile = vi.fn(() => 'module.exports = { serializers: { stla: {} } }')

    const jscad_io = loadJscadIo(jscadRequire, readFile)

    expect(readFile).toHaveBeenCalledWith(IO_URL)
    expect(jscad_io.serializers.stla).toBeDefined()
  })
})
