// Stays only until aiDeps moves to the write/edit tools, where a write is a save.
const sinceSave = (evals) => (evals > 0 ? ` (${evals} eval${evals === 1 ? '' : 's'} since the last save)` : '')

export const notSavedNotice = ({ evals = 0, clean = false } = {}) =>
  clean
    ? `checks clean and not saved${sinceSave(evals)}: save it now with writeModel, then refine`
    : `not saved${sinceSave(evals)}; call writeModel to keep it`

// A check result with nothing wrong: the moment to save. A 2D outline is never clean here.
export const checksClean = (result) =>
  result?.ok !== false &&
  result?.empty === false &&
  result.watertight === true &&
  result.manifold === true &&
  result.insideOut !== true &&
  result.selfIntersecting !== true &&
  result.fitsBed !== false

// eval, measure and check results say so while the model they describe is not the one last written.
export const withSaveState = (result, unsaved, { evals = 0, clean = false } = {}) =>
  unsaved ? { ...result, notSaved: notSavedNotice({ evals, clean }) } : result

// Unsaved: the open project no longer holds every file the agent's last real
// eval used, so a change to any of them, or a switch to another project,
// reads unsaved. Before the agent's first eval the open project is its own
// saved model. Binary files are skipped: the agent cannot write them.
// `evals` counts the model evals since the last successful save.
export const createSaveTracker = () => {
  let evaluatedFiles = null
  let evals = 0

  return {
    recordEval: (files) => {
      evaluatedFiles = files
      evals += 1
    },
    recordSave: (files) => {
      evaluatedFiles = files
      evals = 0
    },
    evalsSinceSave: () => evals,
    isUnsaved: (projectFiles) =>
      evaluatedFiles !== null &&
      !Object.entries(evaluatedFiles).every(([path, source]) => typeof source !== 'string' || projectFiles[path] === source),
  }
}
