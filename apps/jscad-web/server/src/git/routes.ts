// GitHub storage routes: the browser adapter talks to the repo through these,
// so the App private key never leaves the server. Every route is session-gated
// and every installation lookup is author-scoped — one author's connection
// never resolves another's — and bound to the owner/repo saved with it.
import type { Express, Request, Response } from 'express'
import {
  GitHubConflictError,
  createGitHubApp,
  createInstallationStore,
  type GitHubApp,
  type GitHubAppConfig,
  type InstallationStore,
} from './github.js'

export interface GitHubRouteOptions {
  getAuthor?: (req: Request) => string | null | Promise<string | null>
  installationStore?: InstallationStore
  /** Test seam: stands in for the live App client without any network. */
  createApp?: (config: GitHubAppConfig) => GitHubApp
  appConfig?: GitHubAppConfig | null
  appSlug?: string
}

export function mountGitHubRoutes(app: Express, options: GitHubRouteOptions = {}): void {
  const getAuthor = options.getAuthor
  const store = options.installationStore ?? createInstallationStore()
  const makeApp = options.createApp ?? createGitHubApp

  const authorFor = async (req: Request): Promise<string | null> =>
    getAuthor ? await getAuthor(req) : null

  const requireAuthor = async (req: Request, res: Response): Promise<string | null> => {
    const author = await authorFor(req)
    if (getAuthor && author === null) {
      res.status(401).json({ error: 'unauthorized' })
      return null
    }
    return author
  }

  const appFor = (res: Response): GitHubApp | null => {
    if (!options.appConfig) {
      res.status(501).json({ error: 'github app not configured' })
      return null
    }
    return makeApp(options.appConfig)
  }

  app.get('/api/git/install-url', async (req: Request, res: Response) => {
    const author = await requireAuthor(req, res)
    if (author === null && getAuthor) return
    if (!options.appSlug || !options.appConfig) {
      res.status(501).json({ error: 'github app not configured' })
      return
    }
    res.json({ url: `https://github.com/apps/${options.appSlug}/installations/new` })
  })

  app.post('/api/git/installations', async (req: Request, res: Response) => {
    const author = await requireAuthor(req, res)
    if (author === null && getAuthor) return
    const client = appFor(res)
    if (!client || author === null) return
    const { installationId, owner, repo } = (req.body ?? {}) as {
      installationId?: number
      owner?: string
      repo?: string
    }
    if (!installationId || !owner || !repo) {
      res.status(400).json({ error: 'installationId, owner and repo are required' })
      return
    }
    const wanted = `${owner}/${repo}`.toLowerCase()
    const repos = await client.listInstallationRepos(installationId)
    if (!repos.some((name) => name.toLowerCase() === wanted)) {
      res.status(403).json({ error: 'repository not accessible to this installation' })
      return
    }
    store.save(author, { installationId, owner, repo, created: Date.now() })
    res.json({ ok: true })
  })

  app.delete('/api/git/installations/:installationId', async (req: Request, res: Response) => {
    const author = await requireAuthor(req, res)
    if (author === null && getAuthor) return
    if (author === null) return
    const installationId = Number((req.params as Record<string, string>).installationId)
    if (!store.remove(author, installationId)) {
      res.status(404).json({ error: 'unknown installation' })
      return
    }
    res.json({ ok: true })
  })

  const installationFor = async (
    req: Request,
    res: Response,
  ): Promise<{ author: string; installationId: number } | null> => {
    const author = await requireAuthor(req, res)
    if (author === null && getAuthor) return null
    if (author === null) return null
    const installationId = Number(req.query.installationId ?? req.body?.installationId)
    const record = store.get(author, installationId)
    if (!record) {
      res.status(404).json({ error: 'unknown installation' })
      return null
    }
    const { owner, repo } = req.params as Record<string, string>
    if (`${owner}/${repo}`.toLowerCase() !== `${record.owner}/${record.repo}`.toLowerCase()) {
      res.status(403).json({ error: 'repository does not match the installation' })
      return null
    }
    return { author, installationId }
  }

  app.get('/api/git/:owner/:repo/files', async (req: Request, res: Response) => {
    const found = await installationFor(req, res)
    const client = appFor(res)
    if (!found || !client) return
    const { owner, repo } = req.params as Record<string, string>
    const { path = '', ref } = req.query as Record<string, string>
    const project = await client.readProject({ installationId: found.installationId, owner, repo, path, ref })
    res.json(project)
  })

  app.post('/api/git/:owner/:repo/write', async (req: Request, res: Response) => {
    const found = await installationFor(req, res)
    if (!found) return
    const client = appFor(res)
    if (!client) return
    const { installationId } = found
    const { owner, repo } = req.params as Record<string, string>
    const { path = '', branch = 'main', files, message, expectedSha } = (req.body ?? {}) as {
      path?: string
      branch?: string
      files?: Record<string, string>
      message?: string
      expectedSha?: string
    }
    if (!files || !message || !expectedSha) {
      res.status(400).json({ error: 'files, message and expectedSha are required' })
      return
    }
    try {
      const result = await client.writeFiles({ installationId, owner, repo, path, branch, files, message, expectedSha })
      res.json(result)
    } catch (err) {
      if (err instanceof GitHubConflictError) {
        res.status(409).json({ error: err.message })
        return
      }
      throw err
    }
  })

  app.get('/api/git/:owner/:repo/versions', async (req: Request, res: Response) => {
    const found = await installationFor(req, res)
    const client = appFor(res)
    if (!found || !client) return
    const { owner, repo } = req.params as Record<string, string>
    const { path = '', branch } = req.query as Record<string, string>
    res.json(await client.listVersions({ installationId: found.installationId, owner, repo, path, branch }))
  })
}
