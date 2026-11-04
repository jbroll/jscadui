import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { CAPTURES, exportParams, exportScript, makerFiles, partName, stlEntries, unsavedEdits, zipProject } from '../src/projectExport.js'

const a = new Uint8Array([1, 2, 3])
const a2 = new Uint8Array([1, 2, 3])
const b = new Uint8Array([4, 5])
const part = (maker, data, file = 'main.js') => ({ maker, file, data })

describe('partName', () => {
  it('drops the make prefix and lowercases the first letter', () => {
    expect(partName('makeTruck')).toBe('truck')
    expect(partName('makeSideFrame')).toBe('sideFrame')
  })
})

describe('stlEntries', () => {
  it('names a single output after its maker', () => {
    expect(stlEntries([part('makeTruck', a)])).toEqual({ 'stl/truck.stl': a })
  })

  it('folds byte-identical outputs into one xN entry', () => {
    const parts = [part('makeWheel', a), part('makeWheel', a2), part('makeWheel', a)]
    expect(stlEntries(parts)).toEqual({ 'stl/wheel-x3.stl': a })
  })

  it('numbers distinct outputs in first-seen order', () => {
    const parts = [part('makeWheel', a), part('makeWheel', b), part('makeWheel', a)]
    expect(stlEntries(parts)).toEqual({ 'stl/wheel-1-x2.stl': a, 'stl/wheel-2.stl': b })
  })

  it('keeps the number and adds the count when identical and distinct mix', () => {
    const parts = [part('makeWheel', a), part('makeWheel', a), part('makeWheel', b)]
    expect(Object.keys(stlEntries(parts))).toEqual(['stl/wheel-1-x2.stl', 'stl/wheel-2.stl'])
  })

  it('prefixes the file base name when two files export the same maker name', () => {
    const parts = [part('makeSideFrame', a, 'truck.js'), part('makeSideFrame', b, 'lib/frame.js')]
    expect(stlEntries(parts)).toEqual({
      'stl/truck-sideFrame.stl': a,
      'stl/frame-sideFrame.stl': b,
    })
  })

  it('prefixes the folder path when two files share a base name and a maker name', () => {
    const parts = [part('makeSideFrame', a, 'a/frame.js'), part('makeSideFrame', b, 'b/frame.js')]
    expect(stlEntries(parts)).toEqual({
      'stl/a-frame-sideFrame.stl': a,
      'stl/b-frame-sideFrame.stl': b,
    })
  })
})

describe('zipProject', () => {
  const files = { 'main.js': 'export const main = 1', 'lib/data.bin': new Uint8Array([9, 8, 7]) }
  const params = { width: 3, label: 'x' }
  const assembly = new Uint8Array([7, 7])

  it('holds code, params.json, the assembly and every part', () => {
    const parts = { 'stl/wheel.stl': a }
    const out = unzipSync(zipProject({ name: 'truck', files, params, assembly, parts }))
    expect(Object.keys(out).sort()).toEqual(
      ['lib/data.bin', 'main.js', 'params.json', 'stl/truck.stl', 'stl/wheel.stl'].sort(),
    )
    expect(strFromU8(out['main.js'])).toBe('export const main = 1')
    expect(Array.from(out['lib/data.bin'])).toEqual([9, 8, 7])
    expect(strFromU8(out['params.json'])).toBe(JSON.stringify(params, null, 2))
    expect(Array.from(out['stl/truck.stl'])).toEqual([7, 7])
    expect(Array.from(out['stl/wheel.stl'])).toEqual([1, 2, 3])
  })

  it('writes the assembly as <name>-assembly.stl when a part has the project name', () => {
    const parts = { 'stl/truck.stl': a }
    const out = unzipSync(zipProject({ name: 'truck', files, params, assembly, parts }))
    expect(Array.from(out['stl/truck.stl'])).toEqual([1, 2, 3])
    expect(Array.from(out['stl/truck-assembly.stl'])).toEqual([7, 7])
  })

  it('keeps the bytes of a binary file read as an ArrayBuffer', () => {
    const stl = new Uint8Array([5, 6, 7, 8])
    const out = unzipSync(zipProject({ name: 'truck', files: { 'a.stl': stl.buffer }, params, assembly, parts: {} }))
    expect(Array.from(out['a.stl'])).toEqual([5, 6, 7, 8])
  })

  it('works with no parts', () => {
    const out = unzipSync(zipProject({ name: 'truck', files, params, assembly, parts: {} }))
    expect(Object.keys(out).sort()).toEqual(['lib/data.bin', 'main.js', 'params.json', 'stl/truck.stl'])
  })
})

describe('exportScript', () => {
  const g1 = { id: 1 }
  const g2 = { id: 2 }

  // A function stands for a module body: it runs on the first require, like a real load.
  const run = async (modules, makers, params = {}) => {
    const module = { exports: {} }
    const require = path => {
      if (typeof modules[path] === 'function') modules[path] = modules[path](require)
      return modules[path]
    }
    new Function('require', 'module', 'exports', `'use strict';${exportScript('main.js', makers)}`)(require, module, module.exports)
    const value = await module.exports.main(params)
    return { value, captures: globalThis[CAPTURES] }
  }

  it('captures a maker main calls directly', async () => {
    const a = { makeA: () => g1 }
    const modules = { './a.js': a, './main.js': { main: () => [a.makeA()] } }
    const { value, captures } = await run(modules, ['a.js'])
    expect(value).toEqual([g1])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })

  it('captures only the outer maker when one maker calls another', async () => {
    const b = { makeB: () => g2 }
    const a = { makeA: () => [g1, b.makeB()] }
    const modules = { './a.js': a, './lib/b.js': b, './main.js': { main: () => a.makeA() } }
    const { captures } = await run(modules, ['a.js', 'lib/b.js'])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: [g1, g2] }])
  })

  it('captures concurrent async makers', async () => {
    const a = { makeA: async () => g1, makeB: async () => g2 }
    const modules = { './a.js': a, './main.js': { main: async () => await Promise.all([a.makeA(), a.makeB()]) } }
    const { captures } = await run(modules, ['a.js'])
    expect(captures).toEqual([
      { maker: 'makeA', file: 'a.js', value: g1 },
      { maker: 'makeB', file: 'a.js', value: g2 },
    ])
  })

  it('captures an ESM-shaped module', async () => {
    const a = { __esModule: true, makeA: () => g1 }
    const modules = { './a.js': a, './main.js': { __esModule: true, main: () => a.makeA() } }
    const { captures } = await run(modules, ['a.js'])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })

  it('records a promised array as one capture', async () => {
    const a = { makeA: () => Promise.resolve([g1, g2]) }
    const modules = { './a.js': a, './main.js': { main: () => a.makeA() } }
    const { captures } = await run(modules, ['a.js'])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: [g1, g2] }])
  })

  it('restores the original makers after main resolves', async () => {
    const makeA = () => g1
    const a = { makeA }
    const modules = { './a.js': a, './main.js': { main: () => a.makeA() } }
    await run(modules, ['a.js'])
    expect(a.makeA).toBe(makeA)
  })

  it('restores the original makers after main rejects', async () => {
    const makeA = () => g1
    const makeBad = () => {
      throw new Error('bad')
    }
    const a = { makeA, makeBad }
    const modules = { './a.js': a, './main.js': { main: () => [a.makeA(), a.makeBad()] } }
    await expect(run(modules, ['a.js'])).rejects.toThrow('bad')
    expect(a.makeA).toBe(makeA)
    expect(a.makeBad).toBe(makeBad)
  })

  it('captures nothing from a maker file main never calls', async () => {
    const modules = { './a.js': { makeA: () => g1 }, './main.js': { main: () => g2 } }
    const { captures } = await run(modules, ['a.js'])
    expect(captures).toEqual([])
  })

  it('captures a maker the entry destructures at load', async () => {
    const modules = {
      './a.js': () => ({ makeA: () => g1 }),
      './main.js': require => {
        const { makeA } = require('./a.js')
        return { main: () => makeA() }
      },
    }
    const { captures } = await run(modules, ['a.js'])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })

  it('captures again when main reruns on the same load, as a param change or export rerun does', async () => {
    const modules = {
      './a.js': () => ({ makeA: () => g1 }),
      './main.js': require => {
        const { makeA } = require('./a.js')
        return { main: () => makeA() }
      },
    }
    const module = { exports: {} }
    const require = path => {
      if (typeof modules[path] === 'function') modules[path] = modules[path](require)
      return modules[path]
    }
    new Function('require', 'module', 'exports', `'use strict';${exportScript('main.js', ['a.js'])}`)(require, module, module.exports)
    await module.exports.main({})
    await module.exports.main({})
    expect(globalThis[CAPTURES]).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })

  it('captures a destructured maker when the entry is itself a maker file', async () => {
    const modules = {
      './main.js': require => {
        const { makeA } = require('./a.js')
        return { makeMain: () => g2, main: () => makeA() }
      },
      './a.js': () => ({ makeA: () => g1 }),
    }
    const { captures } = await run(modules, ['main.js', 'a.js'])
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })

  it('skips a getter-only re-export and captures through its source', async () => {
    const modules = {
      './a.js': () => ({ __esModule: true, makeB: () => g2 }),
      './c.js': require => {
        const a = require('./a.js')
        return Object.defineProperty({ __esModule: true }, 'makeB', { enumerable: true, get: () => a.makeB })
      },
      './main.js': require => {
        const c = require('./c.js')
        return { main: () => c.makeB() }
      },
    }
    const { captures } = await run(modules, ['c.js', 'a.js'])
    expect(captures).toEqual([{ maker: 'makeB', file: 'a.js', value: g2 }])
  })

  it('runs an entry that exports main as the module itself', async () => {
    const a = { makeA: () => g1 }
    const modules = { './a.js': a, './main.js': () => () => a.makeA() }
    const { value, captures } = await run(modules, ['a.js'])
    expect(value).toBe(g1)
    expect(captures).toEqual([{ maker: 'makeA', file: 'a.js', value: g1 }])
  })
})

describe('exportParams', () => {
  const worker = { params: { w: 3, h: 2, label: 'x' }, userInteractedPaths: ['w', 'label'] }

  it('holds the values the user changed when the entry is selected', () => {
    expect(exportParams(true, worker)).toEqual({ w: 3, label: 'x' })
  })

  it('is empty when a part is selected', () => {
    expect(exportParams(false, worker)).toEqual({})
  })
})

describe('makerFiles', () => {
  it('lists the text files that export a maker', () => {
    const mainSrc = 'const { makeTruck } = require("./truck.js")\nmodule.exports = { main: () => makeTruck() }'
    const files = {
      'main.js': mainSrc,
      'truck.js': 'module.exports = { makeTruck }',
      'lib/d.js': 'module.exports = { W: 1 }',
    }
    expect(makerFiles(files, 'main.js')).toEqual(['truck.js'])
  })

  it('leaves out a maker file the entry does not require', () => {
    const files = {
      'main.js': 'const { makeTruck } = require("./truck.js")\nmodule.exports = { main: () => makeTruck() }',
      'truck.js': 'module.exports = { makeTruck }',
      'draft.js': 'module.exports = { makeHalf(',
    }
    expect(makerFiles(files, 'main.js')).toEqual(['truck.js'])
  })
})

describe('unsavedEdits', () => {
  const files = { 'main.js': 'saved', 'lib/a.js': 'a' }

  it('is false when every dirty buffer matches its saved text', () => {
    expect(unsavedEdits([['/main.js', 'saved'], ['lib/a.js', 'a']], files)).toBe(false)
  })

  it('is true when any project buffer differs, including a kept buffer of another file', () => {
    expect(unsavedEdits([['/main.js', 'saved'], ['/lib/a.js', 'a2']], files)).toBe(true)
  })

  it('ignores buffers that are not project files, such as an example url', () => {
    expect(unsavedEdits([['https://example.com/x.js', 'x'], ['jscad.example.js', 'y']], files)).toBe(false)
  })
})
