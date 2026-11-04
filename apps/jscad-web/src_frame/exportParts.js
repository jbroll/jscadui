import { withTransferable } from '@jscadui/postmessage'
import { exportableSolids } from '@jscadui/worker/src/exportable.js'
import { isEmptyShape } from '@jscadui/agent-loop/src/optionChecks.js'

// Pinned to src/projectExport.js by test: importing it would pull fflate into the frame bundle.
export const CAPTURES = '__jscadExportCaptures'

// The STL serializer takes only what geom3.isA accepts; ManifoldGeom3 passes it through its lazy polygons.
const is3D = (solid) => solid?.isManifoldGeom3 === true || Array.isArray(solid?.polygons)

export const exportParts = async ({ toSolids, serialize }) => {
  const captures = globalThis[CAPTURES] ?? []
  delete globalThis[CAPTURES]
  const parts = []
  for (const { maker, file, value } of captures) {
    const solids = exportableSolids(await toSolids(value)).filter((solid) => is3D(solid) && !isEmptyShape(solid))
    if (!solids.length) continue
    const { data } = serialize(solids)
    parts.push({ maker, file, data: new Uint8Array(await new Blob(data).arrayBuffer()) })
  }
  return withTransferable({ parts }, parts.map((part) => part.data.buffer))
}
