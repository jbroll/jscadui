import { describe, it, expect } from 'vitest'
import { createImportData } from '../src_frame/importData.js'

const BYTES = [0x00, 0x01, 0x7f, 0x80, 0xff]

describe('frame importData', () => {
  const importData = createImportData(() => ({}))

  it('reads font files as binary', () => {
    expect(importData.isBinaryExt('ttf')).toBe(true)
    expect(importData.isBinaryExt('OTF')).toBe(true)
    expect(importData.isBinaryExt('stl')).toBe(true)
    expect(importData.isBinaryExt('dxf')).toBe(false)
  })

  it('turns a fetched binary string into the font bytes', () => {
    // x-user-defined maps bytes 0x80-0xff to U+F780-U+F7FF
    const binaryString = String.fromCharCode(...BYTES.map((b) => (b < 0x80 ? b : 0xf700 + b)))
    const font = importData.deserialize({ url: '/f/Sans.ttf', filename: 'Sans.ttf', ext: 'ttf' }, binaryString)
    expect(font).toBeInstanceOf(Uint8Array)
    expect([...font]).toEqual(BYTES)
  })

  it('turns a project ArrayBuffer into the font bytes', () => {
    const font = importData.deserialize({ url: '/f/Sans.otf', filename: 'Sans.OTF', ext: 'OTF' }, new Uint8Array(BYTES).buffer)
    expect(font).toBeInstanceOf(Uint8Array)
    expect([...font]).toEqual(BYTES)
  })

  it('hands other formats to the @jscad/io deserializers', () => {
    const stl = createImportData(() => ({ stl: (options, content) => ({ options, content }) }))
      .deserialize({ url: '/p.stl', filename: 'p.stl', ext: 'stl' }, 'solid')
    expect(stl).toEqual({ options: { output: 'geometry', filename: 'p.stl' }, content: 'solid' })
    expect(() => importData.deserialize({ url: '/p.dxf', filename: 'p.dxf', ext: 'dxf' }, '')).toThrow('unsupported format in /p.dxf')
  })
})
