/**
 * Export format identifiers used across the codebase.
 * Centralizing these prevents typos like 'x3b' vs 'x3d'.
 * @type {const}
 */
export const ExportFormats = /** @type {const} */ ({
  STL_ASCII: 'stla',
  STL_BINARY: 'stlb',
  AMF: 'amf',
  JSON: 'json',
  OBJ: 'obj',
  X3D: 'x3d',
  SVG: 'svg',
  THREE_MF: '3mf',
})

/** @typedef {typeof ExportFormats[keyof typeof ExportFormats]} ExportFormat */

/**
 * Export format metadata for building UI menus.
 * @type {Record<ExportFormat, { label: string; extension: string }>}
 */
export const ExportFormatMeta = {
  [ExportFormats.STL_ASCII]: { label: 'STL (ascii)', extension: 'stl' },
  [ExportFormats.STL_BINARY]: { label: 'STL (binary)', extension: 'stl' },
  [ExportFormats.AMF]: { label: 'AMF', extension: 'amf' },
  [ExportFormats.JSON]: { label: 'JSON', extension: 'json' },
  [ExportFormats.OBJ]: { label: 'OBJ', extension: 'obj' },
  [ExportFormats.X3D]: { label: 'X3D', extension: 'x3d' },
  [ExportFormats.SVG]: { label: 'SVG', extension: 'svg' },
  [ExportFormats.THREE_MF]: { label: '3MF', extension: '3mf' },
}
