import { DEFAULT_API, withErrorHint } from '@jscadui/agent-loop'
import apiIndex from '@jscadui/agent-loop/api/index.json'
import { capGeometry, DEFAULT_CAPS } from './caps.js'
import { PROJECT_BASE } from '../src_frame/fileMap.js'
import { sendScript } from './scriptRuns.js'

const DEFAULT_ENTRY = './jscad.model.js'

const toError = (error, api) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: withErrorHint(error?.message ?? String(error), { api, index: apiIndex }) },
})

/**
 * The agent's eval tool: run the source in the sandboxed frame, draw what came
 * back, and answer with the entity count.
 * @param {{jscadSetFiles:Function,jscadScript:Function}} workerApi
 * @param {(result:any, options:{skipLog?:boolean}) => void} handleEntities
 * @param {() => string} [getApi] the chat's API style, which warnings and error hints name
 */
export const createEvaluate = (workerApi, handleEntities, getApi = () => DEFAULT_API) => async (source, entry = DEFAULT_ENTRY, files = { [entry]: source }) => {
  const api = getApi()
  let result
  try {
    result = await sendScript(workerApi, files, {
      script: source,
      url: PROJECT_BASE + entry,
      base: PROJECT_BASE,
      root: PROJECT_BASE,
    }, api)
  } catch (error) {
    return toError(error, api)
  }
  if (result.scratch) {
    let out = { ok: true, scratch: true, message: result.message }
    if (result.console?.length) out = { ...out, console: result.console }
    return out
  }
  handleEntities(result, {})
  const raw = result.entities
  const entities = raw instanceof Array ? raw : [raw]
  // handleEntities only paints a cap violation, so re-check it here: the agent
  // must not be told a model evaluated when nothing was drawn.
  try {
    capGeometry(entities, DEFAULT_CAPS)
  } catch (error) {
    return toError(error, api)
  }
  let out = { entityCount: entities.length }
  if (result.warnings?.length) out = { ...out, warnings: result.warnings }
  if (result.console?.length) out = { ...out, console: result.console }
  return out
}
