import { describe, expect, it } from 'vitest'
import { exportConfig, exportedSize } from '../src/exportFormat.js'

describe('exportConfig', () => {
  it("names STL by the frame's binary serializer, and takes the frame's own ids", () => {
    expect(exportConfig('stl')).toMatchObject({ id: 'stlb', serializerKey: 'stlSerializer', defaultOptions: { binary: true } })
    expect(exportConfig('stla').id).toBe('stla')
    expect(exportConfig('3mf').id).toBe('3mf')
  })

  it('refuses a format with no serializer', () => {
    expect(() => exportConfig('step')).toThrow(expect.objectContaining({ name: 'ExportFormatError', message: 'Unknown export format: step; use stl, 3mf, obj or svg' }))
  })
})

describe('exportedSize', () => {
  it('totals text and binary chunks in bytes', () => {
    expect(exportedSize(['é', new ArrayBuffer(3), new Uint8Array(4)])).toBe(2 + 3 + 4)
    expect(exportedSize(new ArrayBuffer(5))).toBe(5)
  })
})
