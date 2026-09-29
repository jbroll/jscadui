// Tracks the project as writeModel has saved it, per entry path (like the eval
// harness's project map), plus the exact file set the agent's last real eval
// used. `isSaved` compares every file in that set against what is currently
// saved for it, so a change to any file the eval depended on — not just the
// one last touched — is what decides `saved`, matching the harness's
// "against the whole project" guarantee.
export const createSaveTracker = () => {
  const saved = new Map()
  let evaluatedFiles = null

  return {
    files: () => Object.fromEntries(saved),
    recordSave: (entry, source) => {
      saved.set(entry, source)
    },
    recordEval: (files) => {
      evaluatedFiles = files
    },
    isSaved: () =>
      evaluatedFiles !== null &&
      Object.entries(evaluatedFiles).every(([path, source]) => saved.get(path) === source),
  }
}
