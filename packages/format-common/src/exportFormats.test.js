import { describe, it, expect } from 'vitest'
import { ExportFormats, ExportFormatMeta, defaultSerializerConfigs } from './exportFormats.js'

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

describe('defaultSerializerConfigs', () => {
  it('contains all export formats', () => {
    const formatIds = Object.values(ExportFormats)
    for (const id of formatIds) {
      const config = defaultSerializerConfigs.find(c => c.id === id)
      expect(config, `Missing config for format: ${id}`).toBeDefined()
    }
  })

  it('each config has required properties', () => {
    for (const config of defaultSerializerConfigs) {
      expect(config.id).toBeTruthy()
      expect(config.label).toBeTruthy()
      expect(config.extension).toBeTruthy()
      expect(config.serializerKey).toBeTruthy()
      expect(config.defaultOptions).toBeDefined()
    }
  })

  it('matches ExportFormatMeta for consistency', () => {
    // Ensure the new configs match the deprecated metadata
    for (const config of defaultSerializerConfigs) {
      const meta = ExportFormatMeta[config.id]
      if (meta) {
        expect(config.label).toBe(meta.label)
        expect(config.extension).toBe(meta.extension)
      }
    }
  })

  it('STL formats have correct binary options', () => {
    const stla = defaultSerializerConfigs.find(c => c.id === 'stla')
    const stlb = defaultSerializerConfigs.find(c => c.id === 'stlb')

    expect(stla.defaultOptions.binary).toBe(false)
    expect(stlb.defaultOptions.binary).toBe(true)
  })

  it('can be used to extract format info for UI', () => {
    // This tests the pattern used in bundle.worker.js
    const formatInfo = defaultSerializerConfigs.map(({ id, label, extension }) => ({ id, label, extension }))

    expect(formatInfo.length).toBe(defaultSerializerConfigs.length)
    for (const info of formatInfo) {
      expect(info).toHaveProperty('id')
      expect(info).toHaveProperty('label')
      expect(info).toHaveProperty('extension')
      // Should NOT have serializerKey or defaultOptions
      expect(info).not.toHaveProperty('serializerKey')
      expect(info).not.toHaveProperty('defaultOptions')
    }
  })
})
