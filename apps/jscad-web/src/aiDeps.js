import { createEvaluate } from './aiEvaluate.js'
import { createSaveTracker } from './aiSaveTracker.js'

const PROJECT_ENTRY = 'main.js'

// Mirrors packages/agent-loop/eval/grade.js's projectEntry: writing any file
// re-runs the project's established real entry, not just the file that was
// written, so a helper write is validated (and keeps `saved` in sync)
// through the model that actually renders.
const projectEntry = (files, lastWritten) => (Object.hasOwn(files, PROJECT_ENTRY) ? PROJECT_ENTRY : lastWritten)

/**
 * The eval/measure/check/save tool deps, tracking whether the agent's last
 * real eval matches what writeModel has saved for every file it used — not
 * just the one it last touched — the way the eval harness's `saved` does.
 * `save` re-runs the project the same way writeModel does in the harness, so
 * an entry with no main() fails to save with the same error text.
 * @param {{workerApi:object, handleEntities:Function, editor:{setSource:Function}, recordEdit:(source:string,entry:string)=>Promise<unknown>}} args
 */
export const createSavedDeps = ({ workerApi, handleEntities, editor, recordEdit }) => {
  const saveTracker = createSaveTracker()
  const evaluateModel = createEvaluate(workerApi, handleEntities)

  const evaluate = async (source, entry = PROJECT_ENTRY) => {
    const files = { ...saveTracker.files(), [entry]: source }
    const result = await evaluateModel(source, entry, files)
    // A scratch run (no main) neither changes the model nor is a save candidate.
    if (result.scratch) return result
    if (result.ok !== false) saveTracker.recordEval(files)
    return { ...result, saved: saveTracker.isSaved() }
  }

  const measure = async (options) => ({ ...(await workerApi.jscadMeasure({ options })), saved: saveTracker.isSaved() })

  const check = async (input) => ({
    ...(await workerApi.jscadCheck({ bed: input?.bed, options: input ?? {} })),
    saved: saveTracker.isSaved(),
  })

  const save = async (source, entry = PROJECT_ENTRY) => {
    editor.setSource(source, entry)
    await recordEdit(source, entry)
    saveTracker.recordSave(entry, source)
    const files = saveTracker.files()
    const realEntry = projectEntry(files, entry)
    const result = await evaluateModel(files[realEntry], realEntry, files)
    if (result.scratch) throw new Error('model exports no main()')
    if (result.ok === false) throw Object.assign(new Error(result.error.message), { name: result.error.name })
    saveTracker.recordEval(files)
    return { ok: true, entry }
  }

  return { evaluate, measure, check, save }
}
