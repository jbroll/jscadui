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
