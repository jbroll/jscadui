// GitHub-backed storage against recorded API responses: fetch is stubbed at
// the global boundary, so no test touches the network. Each test queues the
// exact responses the flow needs and asserts the request sequence.
import { generateKeyPairSync } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GitHubConflictError,
  createGitHubApp,
  createInstallationStore,
  type GitHubApp,
  type InstallationStore,
} from '../src/git/github.js'
import { mountGitHubRoutes } from '../src/git/routes.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const APP = { appId: '1234', privateKey: PRIVATE_KEY, apiBase: 'https://api.test' }

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return handler(url, init)
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const b64 = (text: string) => Buffer.from(text).toString('base64')

describe('github app client', () => {
  it('reads a project files through the tree and blob APIs', async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith('/access_tokens')) return json(201, { token: 'tok', expires_at: '2999-01-01T00:00:00Z' })
      if (url.includes('/git/trees/main?recursive=1'))
        return json(200, {
          tree: [
            { path: 'proj/main.js', type: 'blob', sha: 'b1' },
            { path: 'proj/lib/t.js', type: 'blob', sha: 'b2' },
            { path: 'other/x.js', type: 'blob', sha: 'b3' },
          ],
        })
      if (url.endsWith('/git/blobs/b1')) return json(200, { content: b64('one'), encoding: 'base64' })
      if (url.endsWith('/git/blobs/b2')) return json(200, { content: b64('two'), encoding: 'base64' })
      throw new Error(`unexpected ${url}`)
    })
    const app = createGitHubApp(APP)
    const project = await app.readProject({ installationId: 9, owner: 'o', repo: 'r', path: 'proj' })
    expect(project.files).toEqual({ 'main.js': 'one', 'lib/t.js': 'two' })
    expect(calls.filter((c) => c.url.includes('/git/blobs/b3'))).toHaveLength(0)
  })

  it('writes with a single commit carrying the agent message', async () => {
    const seen: { method: string; url: string; body: unknown }[] = []
    stubFetch((url, init) => {
      seen.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url.endsWith('/access_tokens')) return json(201, { token: 'tok', expires_at: '2999-01-01T00:00:00Z' })
      if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'base1' } })
      if (url.includes('/git/commits/base1')) return json(200, { tree: { sha: 'tree0' } })
      if (url.endsWith('/git/blobs')) return json(201, { sha: `blob-${seen.length}` })
      if (url.endsWith('/git/trees')) return json(201, { sha: 'tree9' })
      if (url.endsWith('/git/commits')) return json(201, { sha: 'commit9' })
      if (url.includes('/git/refs/heads/main')) return json(200, { ref: 'refs/heads/main' })
      throw new Error(`unexpected ${url}`)
    })
    const app = createGitHubApp(APP)
    const res = await app.writeFiles({
      installationId: 9,
      owner: 'o',
      repo: 'r',
      path: 'proj',
      branch: 'main',
      files: { 'main.js': 'one', 'lib/t.js': 'two' },
      message: 'agent: add teeth',
      expectedSha: 'base1',
    })
    expect(res.commitSha).toBe('commit9')
    const commits = seen.filter((s) => s.url.endsWith('/git/commits') && s.method === 'POST')
    expect(commits).toHaveLength(1)
    expect(commits[0].body).toMatchObject({ message: 'agent: add teeth', parents: ['base1'] })
    const refUpdate = seen.find((s) => s.url.includes('/git/refs/heads/main') && s.method === 'PATCH')
    expect(refUpdate?.body).toMatchObject({ sha: 'commit9', force: false })
  })

  it('fails with a conflict and writes nothing when the SHA moved', async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith('/access_tokens')) return json(201, { token: 'tok', expires_at: '2999-01-01T00:00:00Z' })
      if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'moved9' } })
      throw new Error(`unexpected ${url}`)
    })
    const app = createGitHubApp(APP)
    await expect(
      app.writeFiles({
        installationId: 9,
        owner: 'o',
        repo: 'r',
        path: 'proj',
        branch: 'main',
        files: { 'main.js': 'one' },
        message: 'agent: late write',
        expectedSha: 'base1',
      }),
    ).rejects.toBeInstanceOf(GitHubConflictError)
    expect(calls).toHaveLength(2)
  })

  it('refuses a write outside the project paths before any request', async () => {
    const calls = stubFetch(() => {
      throw new Error('must not be called')
    })
    const app = createGitHubApp(APP)
    await expect(
      app.writeFiles({
        installationId: 9,
        owner: 'o',
        repo: 'r',
        path: 'proj',
        branch: 'main',
        files: { '../evil.js': 'x' },
        message: 'escape',
        expectedSha: 'base1',
      }),
    ).rejects.toThrow(/outside|confined/)
    expect(calls).toHaveLength(0)
  })

  it('lists every repository an installation can reach, across pages', async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ full_name: `Org/repo${from + i}` }))
    const calls = stubFetch((url) => {
      if (url.endsWith('/access_tokens')) return json(201, { token: 'tok', expires_at: '2999-01-01T00:00:00Z' })
      if (url.endsWith('/installation/repositories?per_page=100&page=1'))
        return json(200, { total_count: 101, repositories: page(100, 0) })
      if (url.endsWith('/installation/repositories?per_page=100&page=2'))
        return json(200, { total_count: 101, repositories: page(1, 100) })
      throw new Error(`unexpected ${url}`)
    })
    const repos = await createGitHubApp(APP).listInstallationRepos(9)
    expect(repos).toHaveLength(101)
    expect(repos[100]).toBe('Org/repo100')
    expect(calls[1].url).toBe('https://api.test/installation/repositories?per_page=100&page=1')
  })

  it('mints one installation token and reuses it until expiry', async () => {
    let tokens = 0
    stubFetch((url) => {
      if (url.endsWith('/access_tokens')) {
        tokens += 1
        return json(201, { token: `tok${tokens}`, expires_at: '2999-01-01T00:00:00Z' })
      }
      if (url.includes('/git/ref/heads/main')) return json(200, { object: { sha: 'base1' } })
      if (url.includes('/git/trees/')) return json(200, { tree: [] })
      throw new Error(`unexpected ${url}`)
    })
    const app = createGitHubApp(APP)
    await app.readProject({ installationId: 9, owner: 'o', repo: 'r', path: 'proj', ref: 'base1' })
    await app.readProject({ installationId: 9, owner: 'o', repo: 'r', path: 'proj', ref: 'base1' })
    expect(tokens).toBe(1)
  })
})

describe('github routes', () => {
  it('deletes the installation record on disconnect', async () => {
    const app = express()
    app.use(express.json())
    const store = createInstallationStore()
    mountGitHubRoutes(app, { getAuthor: () => 'u1', installationStore: store })
    store.save('u1', { installationId: 9, owner: 'o', repo: 'r' })
    const gone = await request(app).delete('/api/git/installations/9')
    expect(gone.status).toBe(200)
    expect(store.get('u1', 9)).toBeUndefined()
    const again = await request(app).delete('/api/git/installations/9')
    expect(again.status).toBe(404)
  })

  const fakeApp = (repos: string[]): GitHubApp => ({
    mintInstallationToken: async () => 'tok',
    listInstallationRepos: async () => repos,
    readProject: async () => ({ files: { 'main.js': 'one' } }),
    writeFiles: async () => ({ commitSha: 'c9' }),
    listVersions: async () => [],
  })

  const routesApp = (store: InstallationStore, repos: string[]) => {
    const app = express()
    app.use(express.json())
    mountGitHubRoutes(app, {
      getAuthor: () => 'u1',
      installationStore: store,
      appConfig: APP,
      createApp: () => fakeApp(repos),
    })
    return app
  }

  it('refuses to save an installation that cannot reach the requested repo', async () => {
    const store = createInstallationStore()
    const res = await request(routesApp(store, ['someone/else']))
      .post('/api/git/installations')
      .send({ installationId: 9, owner: 'o', repo: 'r' })
    expect(res.status).toBe(403)
    expect(store.get('u1', 9)).toBeUndefined()
  })

  it('saves an installation whose repositories include the requested repo', async () => {
    const store = createInstallationStore()
    const res = await request(routesApp(store, ['O/R']))
      .post('/api/git/installations')
      .send({ installationId: 9, owner: 'o', repo: 'r' })
    expect(res.status).toBe(200)
    expect(store.get('u1', 9)).toMatchObject({ owner: 'o', repo: 'r' })
  })

  it('refuses read, write and versions for a repo other than the saved one', async () => {
    const store = createInstallationStore()
    store.save('u1', { installationId: 9, owner: 'o', repo: 'r', created: 0 })
    const app = routesApp(store, ['o/r', 'o/other'])
    const files = await request(app).get('/api/git/o/other/files?installationId=9&path=proj')
    expect(files.status).toBe(403)
    const versions = await request(app).get('/api/git/o/other/versions?installationId=9&path=proj')
    expect(versions.status).toBe(403)
    const write = await request(app)
      .post('/api/git/o/other/write')
      .send({ installationId: 9, files: { 'main.js': 'x' }, message: 'm', expectedSha: 's' })
    expect(write.status).toBe(403)
    const ok = await request(app).get('/api/git/O/R/files?installationId=9&path=proj')
    expect(ok.status).toBe(200)
  })

  it('answers 401 without a session', async () => {
    const app = express()
    app.use(express.json())
    mountGitHubRoutes(app, {
      getAuthor: () => null,
      installationStore: createInstallationStore(),
    })
    const res = await request(app).get('/api/git/o/r/files?path=proj')
    expect(res.status).toBe(401)
  })
})

describe('github versions', () => {
  beforeEach(() => {
    stubFetch((url) => {
      if (url.endsWith('/access_tokens')) return json(201, { token: 'tok', expires_at: '2999-01-01T00:00:00Z' })
      if (url.includes('/commits?'))
        return json(200, [
          { sha: 'c2', commit: { message: 'second', author: { date: '2026-09-02T00:00:00Z' } } },
          { sha: 'c1', commit: { message: 'first', author: { date: '2026-09-01T00:00:00Z' } } },
        ])
      throw new Error(`unexpected ${url}`)
    })
  })

  it('lists versions newest first', async () => {
    const app = createGitHubApp(APP)
    const versions = await app.listVersions({ installationId: 9, owner: 'o', repo: 'r', path: 'proj' })
    expect(versions.map((v) => v.message)).toEqual(['second', 'first'])
  })
})
