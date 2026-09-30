export function createSession({ local, rowboat, getRowboat, getBackend }) {
  const resolveRowboat = getRowboat ?? (() => rowboat ?? null)
  const backendFor = (projectId, path) =>
    getBackend?.(projectId, path) === 'rowboat' && resolveRowboat() ? resolveRowboat() : local

  const readThrough = async (projectId, path) => {
    const store = backendFor(projectId, path)
    const project = await store.readProject(projectId)
    return project.files[path]
  }

  // One write, so one version row, per backend the changed paths belong to.
  const writeManyThrough = async (projectId, changed, options = {}) => {
    const byStore = new Map()
    for (const [path, content] of Object.entries(changed)) {
      const store = backendFor(projectId, path)
      if (!byStore.has(store)) byStore.set(store, {})
      byStore.get(store)[path] = content
    }
    let written
    for (const [store, files] of byStore) {
      let current
      try {
        current = (await store.readProject(projectId)).files
      } catch {
        current = {}
      }
      written = await store.writeFiles(projectId, { ...current, ...files }, options)
    }
    return written
  }

  const writeThrough = (projectId, path, content, options = {}) => writeManyThrough(projectId, { [path]: content }, options)

  return { readThrough, writeThrough, writeManyThrough }
}
