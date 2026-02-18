import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

import { require as jscadRequire, requireHandlers, requireCache, jscadClearTempCache } from '../src/require.js'
import { makeReadFileNode } from '../src/readFileNode.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const base = 'fs:/'
const readFile = makeReadFileNode(join(__dirname, 'solo') + '/')

function resetCaches() {
  jscadClearTempCache()
  requireCache.module = Object.create(null)
  requireCache.moduleAccessOrder = []
}

beforeEach(() => {
  requireHandlers.clear()
  resetCaches()
})

afterEach(() => {
  requireHandlers.clear()
  resetCaches()
})

// ── registry ───────────────────────────────────────────────────────────────

describe('requireHandlers registry', () => {
  it('is exported and is a Map instance', () => {
    expect(requireHandlers).toBeInstanceOf(Map)
  })

  it('starts empty (after clear)', () => {
    expect(requireHandlers.size).toBe(0)
  })

  it('accepts set/get/delete like a normal Map', () => {
    const handler = () => 'module.exports = {}'
    requireHandlers.set('scad', handler)
    expect(requireHandlers.get('scad')).toBe(handler)
    requireHandlers.delete('scad')
    expect(requireHandlers.has('scad')).toBe(false)
  })
})

// ── dispatch ───────────────────────────────────────────────────────────────

describe('requireHandlers dispatch', () => {
  it('handler is called when requiring a file with a registered extension', () => {
    const handler = vi.fn(() => 'module.exports = { fromHandler: true }')
    requireHandlers.set('xyz', handler)

    const result = jscadRequire('./simple.xyz', null, readFile, base)

    expect(handler).toHaveBeenCalledOnce()
    expect(result.fromHandler).toBe(true)
  })

  it('handler receives (source, url, readFile) as arguments', () => {
    let captured
    requireHandlers.set('xyz', (source, url, rf) => {
      captured = { source, url, rf }
      return 'module.exports = {}'
    })

    jscadRequire('./simple.xyz', null, readFile, base)

    expect(typeof captured.source).toBe('string')
    expect(captured.source.trim()).toBe('hello world')
    expect(captured.url).toMatch(/simple\.xyz/)
    expect(typeof captured.rf).toBe('function')
  })

  it('handler return value is used as the module source (evaled)', () => {
    requireHandlers.set('xyz', (source) => {
      const val = JSON.stringify(source.trim())
      return `module.exports = { content: ${val} }`
    })

    const result = jscadRequire('./simple.xyz', null, readFile, base)

    expect(result.content).toBe('hello world')
  })

  it('handler can return any valid JS module source', () => {
    requireHandlers.set('xyz', () => 'module.exports = { magic: 42, arr: [1,2,3] }')

    const result = jscadRequire('./simple.xyz', null, readFile, base)

    expect(result.magic).toBe(42)
    expect(result.arr).toEqual([1, 2, 3])
  })

  it('handler is NOT called for .js files (normal flow)', () => {
    const handler = vi.fn(() => 'module.exports = {}')
    requireHandlers.set('xyz', handler)

    jscadRequire('./simple.js', null, readFile, base)

    expect(handler).not.toHaveBeenCalled()
  })

  it('handler is not called if extension does not match', () => {
    const handler = vi.fn(() => 'module.exports = {}')
    requireHandlers.set('abc', handler)   // register .abc, not .xyz

    requireHandlers.set('xyz', () => 'module.exports = {}') // need something to avoid crash
    jscadRequire('./simple.xyz', null, readFile, base)

    expect(handler).not.toHaveBeenCalled()
  })
})

// ── isJs bypass ────────────────────────────────────────────────────────────

describe('registered extensions bypass importData', () => {
  it('importData.deserialize is NOT called when a handler is registered for that extension', () => {
    const deserialize = vi.fn(() => ({ fromImportData: true }))
    const mockImportData = { isBinaryExt: () => false, deserialize }

    requireHandlers.set('xyz', () => 'module.exports = { handled: true }')

    const result = jscadRequire('./simple.xyz', null, readFile, base, base, mockImportData)

    expect(deserialize).not.toHaveBeenCalled()
    expect(result.handled).toBe(true)
  })

  it('importData.deserialize IS called for unknown extensions without a handler', () => {
    const deserialize = vi.fn(() => ({ fromImportData: true }))
    const mockImportData = { isBinaryExt: () => false, deserialize }

    // .xyz has no handler registered
    const result = jscadRequire('./simple.xyz', null, readFile, base, base, mockImportData)

    expect(deserialize).toHaveBeenCalledOnce()
    expect(result.fromImportData).toBe(true)
  })
})
