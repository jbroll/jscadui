import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { partName, stlEntries, zipProject } from '../src/projectExport.js'

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

  it('works with no parts', () => {
    const out = unzipSync(zipProject({ name: 'truck', files, params, assembly, parts: {} }))
    expect(Object.keys(out).sort()).toEqual(['lib/data.bin', 'main.js', 'params.json', 'stl/truck.stl'])
  })
})
