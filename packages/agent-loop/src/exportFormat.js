import { defaultSerializerConfigs } from '@jscadui/format-common/src/exportFormats.js'

// The export tool offers `stl`; the frame's serializers name STL by its encoding.
const ALIASES = { stl: 'stlb' }

/**
 * The frame's serializer config for an export tool format, in the app and the eval.
 * @param {string} format
 */
export const exportConfig = (format) => {
  const config = defaultSerializerConfigs.find((c) => c.id === (ALIASES[format] ?? format))
  if (!config) throw Object.assign(new Error(`Unknown export format: ${format}; use stl, 3mf, obj or svg`), { name: 'ExportFormatError' })
  return config
}

/**
 * The byte size of a serializer's output: text chunks and binary ones.
 * @param {unknown} data
 */
export const exportedSize = (data) =>
  [data].flat().reduce((n, chunk) => n + (typeof chunk === 'string' ? new TextEncoder().encode(chunk).byteLength : (chunk?.byteLength ?? 0)), 0)
