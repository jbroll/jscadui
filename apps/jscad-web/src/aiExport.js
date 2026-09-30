import { exportConfig, exportedSize } from '@jscadui/agent-loop'

/** @param {unknown} chunk */
const bytesOf = (chunk) => {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return new Uint8Array(/** @type {ArrayBuffer} */ (chunk))
}

/** @param {unknown} data */
const joinChunks = (data) => {
  const chunks = [data].flat().map(bytesOf)
  const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

// Agent export metadata: total the exported bytes for the model to see,
// but keep the bytes themselves out of the tool result. `save` writes them
// where the open project lives, when it can, and answers the path.
/**
 * @param {(args:{format:string}) => Promise<{data?:unknown}>} exportData
 * @param {{ save?: (format:string, bytes:Uint8Array) => Promise<string|undefined> }} [options]
 */
export const createExport = (exportData, { save } = {}) => async ({ format }) => {
  const { id } = exportConfig(format)
  const { data = [] } = await exportData({ format: id })
  const path = save ? await save(format, joinChunks(data)) : undefined
  return { ok: true, format, size: exportedSize(data), ...(path ? { path } : {}) }
}
