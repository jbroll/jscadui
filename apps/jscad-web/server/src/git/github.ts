// GitHub App client for the connected-repository storage mode. Writes go
// through the Git Data API (blobs → tree → commit → ref update) so a whole
// project lands as ONE commit with the agent's message, and the ref update
// carries the expected SHA with force:false — a moved branch 422s instead of
// clobbering history. Every write is confined to the project's paths before
// any request leaves the process. No octokit dependency: global fetch plus a
// hand-rolled RS256 App JWT from node:crypto.
import { createSign } from 'node:crypto'

export interface GitHubAppConfig {
  appId: string
  privateKey: string
  apiBase?: string
}

export interface RepoRef {
  installationId: number
  owner: string
  repo: string
  /** Project root inside the repo; '' means the repo root. */
  path: string
  branch?: string
  ref?: string
}

export interface GitHubInstallation {
  installationId: number
  owner: string
  repo: string
  created: number
}

export class GitHubConflictError extends Error {
  constructor(message = 'github: branch moved since the read; retry the turn') {
    super(message)
    this.name = 'GitHubConflictError'
  }
}

export class GitHubPathError extends Error {
  constructor(path: string) {
    super(`github: write outside the project paths is refused (${path})`)
    this.name = 'GitHubPathError'
  }
}

type FetchFn = typeof fetch

const b64url = (text: string) => Buffer.from(text).toString('base64url')

// An App JWT is {iss: appId, iat-60s, exp+10m} RS256-signed; GitHub accepts it
// as the Bearer token for POST /app/installations/{id}/access_tokens.
function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000)
  const encoded =
    `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${b64url(JSON.stringify({ iss: appId, iat: now - 60, exp: now + 600 }))}`
  const signature = createSign('RSA-SHA256').update(encoded).sign(privateKey).toString('base64url')
  return `${encoded}.${signature}`
}

// Confinement is checked on normalized posix paths before any request: the
// joined path must stay under the project root, so '..' can never escape it.
function confinedPath(root: string, file: string): string {
  const parts: string[] = []
  for (const part of `${root}/${file}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const joined = parts.join('/')
  const prefix = root === '' ? '' : `${root}/`
  if (joined !== root && !joined.startsWith(prefix)) throw new GitHubPathError(file)
  if (joined === root) throw new GitHubPathError(file)
  return joined
}

async function api(fetchFn: FetchFn, apiBase: string, token: string, path: string, init?: RequestInit) {
  const res = await fetchFn(`${apiBase}/repos/${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 422) throw new GitHubConflictError()
  if (!res.ok) throw new Error(`github: ${init?.method ?? 'GET'} ${path} failed (${res.status})`)
  return res.json() as Promise<never>
}

export interface GitHubApp {
  mintInstallationToken(installationId: number): Promise<string>
  /** `owner/repo` names the installation can reach. */
  listInstallationRepos(installationId: number): Promise<string[]>
  readProject(ref: RepoRef): Promise<{ files: Record<string, string> }>
  writeFiles(args: RepoRef & { files: Record<string, string>; message: string; expectedSha: string }): Promise<{ commitSha: string }>
  listVersions(ref: RepoRef): Promise<{ sha: string; message: string; created: string }[]>
}

export function createGitHubApp(config: GitHubAppConfig, fetchFn: FetchFn = fetch): GitHubApp {
  const apiBase = config.apiBase ?? 'https://api.github.com'
  const tokens = new Map<number, { token: string; expiresAt: number }>()

  const mintInstallationToken = async (installationId: number): Promise<string> => {
    const cached = tokens.get(installationId)
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token
    const res = await fetchFn(`${apiBase}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${appJwt(config.appId, config.privateKey)}`,
        'content-type': 'application/json',
      },
    })
    if (!res.ok) throw new Error(`github: token mint failed (${res.status})`)
    const body = (await res.json()) as { token: string; expires_at: string }
    tokens.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) })
    return body.token
  }

  const listInstallationRepos = async (installationId: number): Promise<string[]> => {
    const token = await mintInstallationToken(installationId)
    const names: string[] = []
    for (let page = 1; ; page++) {
      const res = await fetchFn(`${apiBase}/installation/repositories?per_page=100&page=${page}`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`github: installation repositories failed (${res.status})`)
      const body = (await res.json()) as { total_count: number; repositories: { full_name: string }[] }
      for (const repo of body.repositories) names.push(repo.full_name)
      if (body.repositories.length < 100 || names.length >= body.total_count) return names
    }
  }

  const treeRef = (ref: RepoRef) => ref.ref ?? ref.branch ?? 'main'

  const readProject = async (ref: RepoRef): Promise<{ files: Record<string, string> }> => {
    const token = await mintInstallationToken(ref.installationId)
    const { owner, repo, path } = ref
    const tree = (await api(
      fetchFn,
      apiBase,
      token,
      `${owner}/${repo}/git/trees/${treeRef(ref)}?recursive=1`,
    )) as { tree: { path: string; type: string; sha: string }[] }
    const prefix = path === '' ? '' : `${path}/`
    const files: Record<string, string> = {}
    for (const entry of tree.tree) {
      if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue
      const blob = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/blobs/${entry.sha}`)) as {
        content: string
        encoding: string
      }
      files[entry.path.slice(prefix.length)] = Buffer.from(blob.content, 'base64').toString('utf8')
    }
    return { files }
  }

  const writeFiles = async (
    args: RepoRef & { files: Record<string, string>; message: string; expectedSha: string },
  ): Promise<{ commitSha: string }> => {
    const { installationId, owner, repo, path, message, expectedSha } = args
    const branch = args.branch ?? 'main'
    const confined = Object.entries(args.files).map(([file, content]) => ({
      path: confinedPath(path, file),
      content,
    }))
    const token = await mintInstallationToken(installationId)
    const ref = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/ref/heads/${branch}`)) as {
      object: { sha: string }
    }
    // The branch moved since the turn read it: fail before creating anything.
    if (ref.object.sha !== expectedSha) throw new GitHubConflictError()
    const base = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/commits/${expectedSha}`)) as {
      tree: { sha: string }
    }
    const tree: { path: string; mode: string; type: string; sha: string }[] = []
    for (const { path: filePath, content } of confined) {
      const blob = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
      })) as { sha: string }
      tree.push({ path: filePath, mode: '100644', type: 'blob', sha: blob.sha })
    }
    const newTree = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: base.tree.sha, tree }),
    })) as { sha: string }
    const commit = (await api(fetchFn, apiBase, token, `${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [expectedSha] }),
    })) as { sha: string }
    // force:false — a concurrent push 422s into GitHubConflictError via api();
    // the dangling commit is unreachable and history is never rewritten.
    await api(fetchFn, apiBase, token, `${owner}/${repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
    return { commitSha: commit.sha }
  }

  const listVersions = async (
    ref: RepoRef,
  ): Promise<{ sha: string; message: string; created: string }[]> => {
    const token = await mintInstallationToken(ref.installationId)
    const query = new URLSearchParams({ path: ref.path, sha: ref.branch ?? 'main', per_page: '50' })
    const commits = (await api(
      fetchFn,
      apiBase,
      token,
      `${ref.owner}/${ref.repo}/commits?${query}`,
    )) as { sha: string; commit: { message: string; author: { date: string } } }[]
    return commits.map((c) => ({ sha: c.sha, message: c.commit.message, created: c.commit.author.date }))
  }

  return { mintInstallationToken, listInstallationRepos, readProject, writeFiles, listVersions }
}

export interface InstallationStore {
  save(author: string, record: GitHubInstallation): void
  get(author: string, installationId: number): GitHubInstallation | undefined
  list(author: string): GitHubInstallation[]
  remove(author: string, installationId: number): boolean
}

// Installation records live in the caller's map by default; createServer backs
// this seam with sqlite so disconnects survive restarts.
export function createInstallationStore(): InstallationStore {
  const records = new Map<string, GitHubInstallation>()
  return {
    save: (author, record) => {
      records.set(`${author}:${record.installationId}`, record)
    },
    get: (author, installationId) => records.get(`${author}:${installationId}`),
    list: (author) =>
      [...records.entries()].filter(([key]) => key.startsWith(`${author}:`)).map(([, record]) => record),
    remove: (author, installationId) => records.delete(`${author}:${installationId}`),
  }
}
