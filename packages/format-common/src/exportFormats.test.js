import { describe, it, expect } from 'vitest'
import { ExportFormats, ExportFormatMeta } from './exportFormats.js'

describe('ExportFormats', () => {
  it('defines all expected format identifiers', () => {
    expect(ExportFormats.STL_ASCII).toBe('stla')
    expect(ExportFormats.STL_BINARY).toBe('stlb')
    expect(ExportFormats.AMF).toBe('amf')
    expect(ExportFormats.JSON).toBe('json')
    expect(ExportFormats.OBJ).toBe('obj')
    expect(ExportFormats.X3D).toBe('x3d')  // Fixed from 'x3b' typo
    expect(ExportFormats.SVG).toBe('svg')
    expect(ExportFormats.THREE_MF).toBe('3mf')
  })

  it('has metadata for every format', () => {
    const formatIds = Object.values(ExportFormats)
    for (const id of formatIds) {
      expect(ExportFormatMeta[id]).toBeDefined()
      expect(ExportFormatMeta[id].label).toBeTruthy()
      expect(ExportFormatMeta[id].extension).toBeTruthy()
    }
  })

  it('has correct file extensions', () => {
    expect(ExportFormatMeta[ExportFormats.STL_ASCII].extension).toBe('stl')
    expect(ExportFormatMeta[ExportFormats.STL_BINARY].extension).toBe('stl')
    expect(ExportFormatMeta[ExportFormats.AMF].extension).toBe('amf')
    expect(ExportFormatMeta[ExportFormats.JSON].extension).toBe('json')
    expect(ExportFormatMeta[ExportFormats.OBJ].extension).toBe('obj')
    expect(ExportFormatMeta[ExportFormats.X3D].extension).toBe('x3d')
    expect(ExportFormatMeta[ExportFormats.SVG].extension).toBe('svg')
    expect(ExportFormatMeta[ExportFormats.THREE_MF].extension).toBe('3mf')
  })

  it('X3D format is correctly named (not x3b typo)', () => {
    // This test documents the fix for the x3b vs x3d typo
    expect(ExportFormats.X3D).toBe('x3d')
    expect(ExportFormats.X3D).not.toBe('x3b')
  })
})
