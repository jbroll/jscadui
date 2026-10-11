export function createSession({ local, rowboat, getRowboat, getBackend, disk = null }) {
  const resolveRowboat = getRowboat ?? (() => rowboat ?? null)
  const backendFor = (projectId, path) => {
    const mode = getBackend?.(projectId, path)
    if (mode === 'disk' && disk) return disk
    return mode === 'rowboat' && resolveRowboat() ? resolveRowboat() : local
  }

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
    } catch (err) {
      // A project the backend never saw starts fresh; any other read
      // failure fails the save, so one offline blob fetch cannot delete
      // the rest of the project.
      if (err?.name !== 'NotFoundError') throw err
      files = {}
    }
    files[path] = content
    return store.writeFiles(projectId, files, options)
  }

  // A version row of what the project's backend holds now.
  const snapshot = (projectId, options = {}) => backendFor(projectId).snapshot(projectId, options)

  const readConversation = (projectId) => backendFor(projectId).readConversation(projectId)
  const writeConversation = (projectId, messages) => backendFor(projectId).writeConversation(projectId, messages)

  return { readThrough, writeThrough, snapshot, readConversation, writeConversation }
}
