import { withTransferable } from '@jscadui/postmessage'
import { exportableSolids } from '@jscadui/worker/src/exportable.js'

// Pinned to src/projectExport.js by test: importing it would pull fflate into the frame bundle.
export const CAPTURES = '__jscadExportCaptures'

export const exportParts = async ({ toSolids, serialize }) => {
  const captures = globalThis[CAPTURES] ?? []
  delete globalThis[CAPTURES]
  const parts = []
  for (const { maker, file, value } of captures) {
    const solids = exportableSolids(await toSolids(value))
    if (!solids.length) continue
    const { data } = serialize(solids)
    parts.push({ maker, file, data: new Uint8Array(await new Blob(data).arrayBuffer()) })
  }
  return withTransferable({ parts }, parts.map((part) => part.data.buffer))
}
