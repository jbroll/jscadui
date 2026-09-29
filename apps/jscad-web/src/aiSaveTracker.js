// `saved` holds when the open project still has every file the agent's last
// real eval used, so a change to any of them, or a switch to another project,
// reads unsaved. Binary files are skipped: the agent cannot write them.
export const createSaveTracker = () => {
  let evaluatedFiles = null

  return {
    recordEval: (files) => {
      evaluatedFiles = files
    },
    isSaved: (projectFiles) =>
      evaluatedFiles !== null &&
      Object.entries(evaluatedFiles).every(([path, source]) => typeof source !== 'string' || projectFiles[path] === source),
  }
}
