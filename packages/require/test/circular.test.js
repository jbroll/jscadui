import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { require as jscadRequire, clearAllCaches } from '../src/require.js'
import { setLibraryPrefixes } from '../src/resolution/moduleResolver.js'

const base = 'fs:/'

const readerFor = (files) => (path) => {
  const key = path.slice(path.lastIndexOf('/') + 1)
  if (!(key in files)) throw new Error(`file not found ${path}`)
  return files[key]
}

beforeEach(() => clearAllCaches())

describe('circular require', () => {
  // NopSCADlib's screw.scad and nut.scad `use` each other; the transpiler emits
  // a top-level require for each and reads the namespace lazily.
  const mutual = {
    'a.js': `
      const b = require('./b.js')
      exports.name = 'a'
      exports.callB = () => b.name
    `,
    'b.js': `
      const a = require('./a.js')
      exports.name = 'b'
      exports.callA = () => a.name
    `,
  }

  it('resolves a mutual require instead of throwing', () => {
    const a = jscadRequire('./a.js', null, readerFor(mutual), base)
    expect(a.name).toBe('a')
    expect(a.callB()).toBe('b')
  })

  it('gives the re-entrant module the partial exports, filled in by the time it is read', () => {
    const b = jscadRequire('./b.js', null, readerFor(mutual), base)
    expect(b.callA()).toBe('a')
  })

  it('hands both sides the same module instance', () => {
    const a = jscadRequire('./a.js', null, readerFor(mutual), base)
    const b = jscadRequire('./b.js', null, readerFor(mutual), base)
    expect(b.callA()).toBe(a.name)
  })

  it('does not cache a module whose evaluation threw', () => {
    let attempts = 0
    const files = {
      'boom.js': `
        exports.attempt = globalThis.__attempts = (globalThis.__attempts ?? 0) + 1
        if (exports.attempt === 1) throw new Error('boom')
      `,
    }
    globalThis.__attempts = 0
    const readFile = (path) => { attempts++; return readerFor(files)(path) }

    expect(() => jscadRequire('./boom.js', null, readFile, base)).toThrow(/boom/)
    const second = jscadRequire('./boom.js', null, readFile, base)

    expect(second.attempt).toBe(2)
    expect(attempts).toBe(2)
    delete globalThis.__attempts
  })
})

describe('circular require across a library prefix', () => {
  // Reached one bare ('Lib/...') and one absolute ('/libs/Lib/...', as the
  // transpiler emits), cross-origin like production (root vs. library base).
  const libRoot = 'http://project.local/'
  const libBase = 'https://app.test/libs/Lib/'

  beforeEach(() => setLibraryPrefixes({ 'Lib/': libBase }))
  afterEach(() => setLibraryPrefixes({}))

  it('resolves the cycle instead of throwing', () => {
    const files = {
      'top.js': `
        const a = require('/libs/Lib/a.js')
        exports.callA = () => a.name
      `,
      'a.js': `
        const b = require('/libs/Lib/b.js')
        exports.name = 'a'
        exports.callB = () => b.name
      `,
      'b.js': `
        const a = require('/libs/Lib/a.js')
        exports.name = 'b'
        exports.callA = () => a.name
      `,
    }
    const top = jscadRequire('Lib/top.js', null, readerFor(files), 'http://project.local/main.js', libRoot)
    expect(top.callA()).toBe('a')
  })

  // MAX_MODULE_CACHE_SIZE is 50: a module mid-load must survive that many
  // sibling loads, or the LRU evicts its placeholder and this throws.
  it('does not evict a module mid-cycle behind 60 sibling loads', () => {
    const leafCount = 60
    const files = {
      'top.js': `
        const a = require('/libs/Lib/a.js')
        exports.callA = () => a.name
        exports.callBack = () => a.callBack()
      `,
      'a.js': `
        ${Array.from({ length: leafCount }, (_, i) => `require('/libs/Lib/leaf${i}.js')`).join('\n')}
        const back = require('/libs/Lib/back.js')
        exports.name = 'a'
        exports.callBack = () => back.name
      `,
      'back.js': `
        const a = require('/libs/Lib/a.js')
        exports.name = 'back'
        exports.callA = () => a.name
      `,
    }
    for (let i = 0; i < leafCount; i++) files[`leaf${i}.js`] = `exports.name = 'leaf${i}'`

    const top = jscadRequire('Lib/top.js', null, readerFor(files), 'http://project.local/main.js', libRoot)
    expect(top.callA()).toBe('a')
    expect(top.callBack()).toBe('back')
  })
})
