import { capGeometry, DEFAULT_CAPS } from './caps.js'
import { PROJECT_BASE } from '../src_frame/fileMap.js'
import { sendScript } from './scriptRuns.js'

const DEFAULT_ENTRY = './jscad.model.js'

const toError = (error) => ({ ok: false, error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) } })

/**
 * The agent's eval tool: run the source in the sandboxed frame, draw what came
 * back, and answer with the entity count.
 * @param {{jscadSetFiles:Function,jscadScript:Function}} workerApi
 * @param {(result:any, options:{skipLog?:boolean}) => void} handleEntities
 */
export const createEvaluate = (workerApi, handleEntities) => async (source, entry = DEFAULT_ENTRY) => {
  let result
  try {
    result = await sendScript(workerApi, { [entry]: source }, {
      script: source,
      url: PROJECT_BASE + entry,
      base: PROJECT_BASE,
      root: PROJECT_BASE,
    })
  } catch (error) {
    return toError(error)
  }
  handleEntities(result, {})
  const raw = result.entities
  const entities = raw instanceof Array ? raw : [raw]
  // handleEntities only paints a cap violation, so re-check it here: the agent
  // must not be told a model evaluated when nothing was drawn.
  try {
    capGeometry(entities, DEFAULT_CAPS)
  } catch (error) {
    return toError(error)
  }
  return { entityCount: entities.length }
}
