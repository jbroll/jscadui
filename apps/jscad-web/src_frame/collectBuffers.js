/**
 * Collect the ArrayBuffers behind a relayed message so it can cross the hop
 * zero-copy, the way it crossed the previous one. Both shapes appear: geometry
 * arrives as typed arrays, jscadExportData's data as bare ArrayBuffers.
 * @param {unknown} value
 * @returns {ArrayBuffer[]}
 */
export const collectBuffers = (value, out = [], seen = new Set()) => {
  if (value === null || typeof value !== 'object') return out
  if (seen.has(value)) return out
  seen.add(value)
  if (value instanceof ArrayBuffer) {
    out.push(value)
    return out
  }
  if (ArrayBuffer.isView(value)) {
    if (!seen.has(value.buffer)) {
      seen.add(value.buffer)
      out.push(value.buffer)
    }
    return out
  }
  for (const v of Object.values(value)) collectBuffers(v, out, seen)
  return out
}
