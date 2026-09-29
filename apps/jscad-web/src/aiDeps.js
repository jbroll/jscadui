import { createEvaluate } from './aiEvaluate.js'
import { createSaveTracker } from './aiSaveTracker.js'

const PROJECT_ENTRY = 'main.js'

// The entry the editor runs when the project declares one, else
// packages/agent-loop/eval/grade.js's projectEntry: main.js, or the file written last.
const projectEntry = (files, declared, lastWritten) => {
  const entry = declared?.replace(/^\//, '')
  if (entry && Object.hasOwn(files, entry)) return entry
  return Object.hasOwn(files, PROJECT_ENTRY) ? PROJECT_ENTRY : lastWritten
}

/**
 * The eval/measure/check/save tool deps over the open project's files, the
 * set the editor's runs send the frame. `save` writes the file into that set
 * and re-runs the project through its entry, as the eval harness's writeModel
 * does, so an entry with no main() fails with the harness's error text.
 * @param {{
 *   workerApi:object, handleEntities:Function, editor:{setSource:Function},
 *   recordEdit:(source:string,entry:string)=>Promise<unknown>,
 *   getProjectFiles:() => Promise<Record<string,string|ArrayBuffer>>,
 *   writeProjectFile:(path:string,source:string)=>Promise<void>,
 *   getProjectEntry?:() => string|undefined,
 *   getApi?:() => string, loadIndex?:() => Promise<Array<object>>
 * }} args
 */
export const createSavedDeps = ({ workerApi, handleEntities, editor, recordEdit, getProjectFiles, writeProjectFile, getProjectEntry = () => undefined, getApi, loadIndex }) => {
  const saveTracker = createSaveTracker()
  const evaluateModel = createEvaluate(workerApi, handleEntities, getApi, loadIndex)
  const isSaved = async () => saveTracker.isSaved(await getProjectFiles())

  const evaluate = async (source, entry = PROJECT_ENTRY) => {
    const files = { ...(await getProjectFiles()), [entry]: source }
    const result = await evaluateModel(source, entry, files)
    // A scratch run (no main) neither changes the model nor is a save candidate.
    if (result.scratch) return result
    if (result.ok !== false) saveTracker.recordEval(files)
    return { ...result, saved: await isSaved() }
  }

  const measure = async (options) => ({ ...(await workerApi.jscadMeasure({ options })), saved: await isSaved() })

  const check = async (input) => ({
    ...(await workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} })),
    saved: await isSaved(),
  })

  const save = async (source, entry = PROJECT_ENTRY) => {
    editor.setSource(source, entry)
    await writeProjectFile(entry, source)
    await recordEdit(source, entry)
    // The overlay covers a page with no file cache, where the write lands nowhere.
    const files = { ...(await getProjectFiles()), [entry]: source }
    const realEntry = projectEntry(files, getProjectEntry(), entry)
    const result = await evaluateModel(files[realEntry], realEntry, files)
    if (result.scratch) throw new Error('model exports no main()')
    if (result.ok === false) throw Object.assign(new Error(result.error.message), { name: result.error.name })
    saveTracker.recordEval(files)
    let out = { ok: true, entry }
    if (result.warnings) out = { ...out, warnings: result.warnings }
    if (result.console) out = { ...out, console: result.console }
    return out
  }

  return { evaluate, measure, check, save }
}
