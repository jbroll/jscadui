export function createSession({ local, rowboat, getBackend }) {
  const backendFor = (path) => (getBackend?.(path) === 'rowboat' && rowboat ? rowboat : local)

  const readThrough = async (projectId, path) => {
    const store = backendFor(path)
    const project = await store.readProject(projectId)
    return project.files[path]
  }

  const writeThrough = async (projectId, path, content, options = {}) => {
    const store = backendFor(path)
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
