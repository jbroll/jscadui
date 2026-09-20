import { capGeometry, DEFAULT_CAPS } from './caps.js'

const DEFAULT_ENTRY = './jscad.model.js'

/**
 * The agent's eval tool: run the source in the sandboxed frame, draw what came
 * back, and answer with the entity count.
 * @param {{load:(input:{files:Record<string,string>,entry:string}) => Promise<{ok:boolean,result?:any,error?:any}>}} frame
 * @param {(result:any, options:{skipLog?:boolean}) => void} handleEntities
 */
export const createEvaluate = (frame, handleEntities) => async (source, entry = DEFAULT_ENTRY) => {
  const loaded = await frame.load({ files: { [entry]: source }, entry })
  if (!loaded.ok) return { ok: false, error: loaded.error }
  handleEntities(loaded.result, {})
  const raw = loaded.result.entities
  const entities = raw instanceof Array ? raw : [raw]
  // handleEntities only paints a cap violation, so re-check it here: the agent
  // must not be told a model evaluated when nothing was drawn.
  try {
    capGeometry(entities, DEFAULT_CAPS)
  } catch (error) {
    return { ok: false, error: { name: error.name, message: error.message } }
  }
  return { entityCount: entities.length }
}
