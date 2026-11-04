import { CAPTURES } from './exportParts.js'

// The flip's re-runs rewrite the worker's solids, so they stay inside the
// withSolids queue; a measure or check in flight must not serialize a
// half-switched preview. The preview re-run refills a project export's
// captures, so the render run's are put back for jscadExportParts.
export const createRenderExport = ({ withSolids, jscadMain, currentSolids, currentParams, setScadPreview }) =>
  (renderMode, serialize) => withSolids(async (solids) => {
    if (!renderMode) return serialize(solids)
    let captures
    try {
      setScadPreview(false)
      await jscadMain({ params: currentParams() })
      captures = globalThis[CAPTURES]
      return serialize(currentSolids())
    } finally {
      setScadPreview(true)
      await jscadMain({ params: currentParams() })
      if (captures) globalThis[CAPTURES] = captures
    }
  })
