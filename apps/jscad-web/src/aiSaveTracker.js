// Unsaved: the open project no longer holds every file the agent's last real
// eval used, so a change to any of them, or a switch to another project,
// reads unsaved. Before the agent's first eval the open project is its own
// saved model. Binary files are skipped: the agent cannot write them.
export const createSaveTracker = () => {
  let evaluatedFiles = null

  return {
    recordEval: (files) => {
      evaluatedFiles = files
    },
    isUnsaved: (projectFiles) =>
      evaluatedFiles !== null &&
      !Object.entries(evaluatedFiles).every(([path, source]) => typeof source !== 'string' || projectFiles[path] === source),
  }
}
