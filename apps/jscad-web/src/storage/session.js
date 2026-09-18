export function createSession({ local, rowboat, getRowboat, getBackend }) {
  const resolveRowboat = getRowboat ?? (() => rowboat ?? null)
  const backendFor = (projectId, path) =>
    getBackend?.(projectId, path) === 'rowboat' && resolveRowboat() ? resolveRowboat() : local

  const readThrough = async (projectId, path) => {
    const store = backendFor(projectId, path)
    const project = await store.readProject(projectId)
    return project.files[path]
  }

  const writeThrough = async (projectId, path, content, options = {}) => {
    const store = backendFor(projectId, path)
    let files
    try {
      files = { ...(await store.readProject(projectId)).files }
    } catch {
      files = {}
    }
    files[path] = content
    return store.writeFiles(projectId, files, options)
  }

  return { readThrough, writeThrough }
}
