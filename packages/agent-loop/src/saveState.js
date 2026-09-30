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
