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
 * Serializer configuration - the single source of truth for export formats.
 * This defines all metadata needed for both the UI menu and the worker.
 *
 * @typedef {Object} SerializerConfig
 * @property {string} id - Format identifier (e.g., 'stla', 'stlb')
 * @property {string} label - Display label for UI (e.g., 'STL (ascii)')
 * @property {string} extension - File extension without dot (e.g., 'stl')
 * @property {string} serializerKey - Key to look up serializer in jscad_io
 * @property {Object} [defaultOptions] - Default options to pass to serializer
 */

/**
 * @typedef {Object} ExportFormatInfo
 * @property {string} id - Format identifier
 * @property {string} label - Display label for UI
 * @property {string} extension - File extension
 */

/**
 * Default serializer configurations for common export formats.
 * Apps can use this as a template or define their own configurations.
 * Uses ExportFormats constants for IDs to ensure consistency.
 * @type {SerializerConfig[]}
 */
export const defaultSerializerConfigs = [
  { id: ExportFormats.STL_ASCII, label: 'STL (ascii)', extension: 'stl', serializerKey: 'stlSerializer', defaultOptions: { binary: false } },
  { id: ExportFormats.STL_BINARY, label: 'STL (binary)', extension: 'stl', serializerKey: 'stlSerializer', defaultOptions: { binary: true } },
  { id: ExportFormats.AMF, label: 'AMF', extension: 'amf', serializerKey: 'amfSerializer', defaultOptions: {} },
  { id: ExportFormats.JSON, label: 'JSON', extension: 'json', serializerKey: 'jsonSerializer', defaultOptions: {} },
  { id: ExportFormats.OBJ, label: 'OBJ', extension: 'obj', serializerKey: 'objSerializer', defaultOptions: {} },
  { id: ExportFormats.X3D, label: 'X3D', extension: 'x3d', serializerKey: 'x3dSerializer', defaultOptions: {} },
  { id: ExportFormats.SVG, label: 'SVG', extension: 'svg', serializerKey: 'svgSerializer', defaultOptions: {} },
  { id: ExportFormats.THREE_MF, label: '3MF', extension: '3mf', serializerKey: 'm3fSerializer', defaultOptions: {} },
]

/**
 * Export format metadata for building UI menus.
 * @deprecated Use defaultSerializerConfigs or fetch formats from worker via jscadGetExportFormats
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
