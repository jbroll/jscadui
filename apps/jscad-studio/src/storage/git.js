// Git-backed storage: one connected repo path hosts one project, through the
// server's /api/git routes (the App private key never leaves the server). A
// dotfile in the path carries the name, entry and conversation, mirroring the
// folder mode; versions are the path's real commits, newest first.
import { kindFromEntry } from './cloud.js'
import { withZip } from './index.js'

const META_PATH = '.jscad-studio.json'

export class GitStorageError extends Error {
  constructor(message) {
    super(`git storage: ${message}`)
    this.name = 'GitStorageError'
  }
}

export function createGitStorage(options) {
  const { apiBase, installationId, owner, repo, branch = 'main', path = '', fetchFn = fetch } = options
  if (!apiBase || !installationId || !owner || !repo) throw new GitStorageError('apiBase, installationId, owner and repo are required')

  const id = `${owner}/${repo}:${path === '' ? '@root' : path}`

  const call = async (url, init) => {
    const res = await fetchFn(`${apiBase}${url}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (res.status === 409) throw new GitStorageError('branch moved since the read; reload and retry the turn')
    if (!res.ok) throw new GitStorageError(`${init?.method ?? 'GET'} ${url} failed (${res.status})`)
    return res.json()
  }

  const filesUrl = (ref) => {
    const query = new URLSearchParams({ installationId: String(installationId), path })
    if (ref) query.set('ref', ref)
    return `/api/git/${owner}/${repo}/files?${query}`
  }

  const readMeta = (files) => {
    if (!files[META_PATH]) return {}
    try {
      return JSON.parse(files[META_PATH])
    } catch {
      return {}
    }
  }

  const withoutMeta = (files) => {
    const out = { ...files }
    delete out[META_PATH]
    return out
  }

  const readProject = async () => {
    const { files } = await call(filesUrl())
    const meta = readMeta(files)
    const entry = meta.entry ?? 'main.js'
    return {
      id,
      name: meta.name ?? `${repo}/${path === '' ? 'root' : path}`,
      entry,
      kind: kindFromEntry(entry),
      mode: 'git',
      files: withoutMeta(files),
    }
  }

  const listProjects = async () => {
    const { id: pid, name, entry, kind, mode } = await readProject()
    return [{ id: pid, name, entry, kind, mode }]
  }

  const headSha = async () => {
    const query = new URLSearchParams({ installationId: String(installationId), path, branch })
    const versions = await call(`/api/git/${owner}/${repo}/versions?${query}`)
    if (versions.length === 0) throw new GitStorageError('branch has no commits yet; push an initial commit first')
    return versions[0].sha
  }

  const writeFiles = async (projectId, files, options = {}) => {
    const project = await readProject()
    const entry = options.entry ?? project.entry
    const name = options.name ?? project.name
    const meta = { name, entry }
    const { commitSha } = await call(`/api/git/${owner}/${repo}/write`, {
      method: 'POST',
      body: JSON.stringify({
        installationId,
        path,
        branch,
        files: { ...withoutMeta(files), [META_PATH]: JSON.stringify(meta) },
        message: options.message || 'agent: update model',
        expectedSha: await headSha(),
      }),
    })
    void projectId
    return { id, entry, kind: kindFromEntry(entry), commitSha }
  }

  const listVersions = async () => {
    const query = new URLSearchParams({ installationId: String(installationId), path, branch })
    const versions = await call(`/api/git/${owner}/${repo}/versions?${query}`)
    return versions.map(({ sha, message, created }) => ({ versionId: sha, message, created }))
  }

  const readVersion = async (projectId, versionId) => {
    const { files } = await call(filesUrl(versionId))
    const meta = readMeta(files)
    void projectId
    return { files: withoutMeta(files), entry: meta.entry ?? 'main.js' }
  }

  const readConversation = async () => {
    const { files } = await call(filesUrl())
    const meta = readMeta(files)
    if (!meta.messages) return null
    return { messages: meta.messages, updated: meta.updated ?? 0 }
  }

  const writeConversation = async (projectId, messages) => {
    const project = await readProject()
    const meta = { name: project.name, entry: project.entry, messages, updated: Date.now() }
    await call(`/api/git/${owner}/${repo}/write`, {
      method: 'POST',
      body: JSON.stringify({
        installationId,
        path,
        branch,
        files: { [META_PATH]: JSON.stringify(meta) },
        message: 'agent: save conversation',
        expectedSha: await headSha(),
      }),
    })
    void projectId
  }

  return withZip({
    sync: async () => {},
    listProjects,
    readProject,
    writeFiles,
    listVersions,
    readVersion,
    readConversation,
    writeConversation,
  })
}
