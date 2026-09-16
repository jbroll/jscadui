import { randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { createProvider, type Provider, type ProviderConfig } from '../providers/types.js'
import { runTurn, type Conversation } from './loop.js'

interface PendingToolCall {
  author: string | null
  resolve(value: string): void
}

// Conversations live behind a store seam. The durable per-user store is the
// rowboat `conversations` table, owned by the browser storage layer and synced
// by it; the default keeps the in-memory behavior until a server-side rowboat
// sync client exists to back the seam.
export interface ConversationStore {
  load(key: string): Conversation | undefined
  save(key: string, conversation: Conversation): void
}

export interface AgentRouteOptions {
  /** Test seam: lets a fake provider stand in for a real one without any network. */
  createProvider?: (config: ProviderConfig) => Provider
  /** Resolves the acting user from the session; a null answer rejects with 401. */
  getAuthor?: (req: Request) => string | null | Promise<string | null>
  conversationStore?: ConversationStore
}

// The chat transport. A turn streams SSE events (text, tool_request, done, error) to the browser;
// the browser executes the tool and POSTs the result back to /tool/:callId, which resolves the
// promise the loop is awaiting. Conversations and pending tool calls are keyed per author so one
// user's turns never see another's.
export function mountAgentRoutes(app: Express, options: AgentRouteOptions = {}): void {
  const makeProvider = options.createProvider ?? createProvider
  const getAuthor = options.getAuthor
  const conversations = new Map<string, Conversation>()
  const store: ConversationStore = options.conversationStore ?? {
    load: (key) => conversations.get(key),
    save: (key, conversation) => {
      conversations.set(key, conversation)
    },
  }
  const activeTurns = new Set<string>()
  const pending = new Map<string, PendingToolCall>()

  const authorFor = async (req: Request): Promise<string | null> =>
    getAuthor ? await getAuthor(req) : null

  app.post('/api/chat/:projectId', async (req: Request, res: Response) => {
    const { projectId } = req.params as Record<string, string>
    const author = await authorFor(req)
    if (getAuthor && author === null) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const key = author ? `${author}:${projectId}` : projectId
    if (activeTurns.has(key)) {
      res.status(409).json({ error: 'a turn is already running for this project' })
      return
    }
    const { message, provider: providerConfig } = (req.body ?? {}) as {
      message?: unknown
      provider?: ProviderConfig
    }
    if (typeof message !== 'string' || message.length === 0) {
      res.status(400).json({ error: 'message is required' })
      return
    }
    if (!providerConfig) {
      res.status(400).json({ error: 'provider is required' })
      return
    }

    res.setHeader('content-type', 'text/event-stream')
    res.setHeader('cache-control', 'no-cache')
    res.setHeader('connection', 'keep-alive')
    res.flushHeaders()

    // Writes to a socket the client already dropped emit 'error'; the disconnect path owns cleanup.
    res.on('error', () => {})
    const send = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // req 'close' fires once the POST body is read, so it cannot detect a disconnect; the response
    // stream is what stays open for the turn, and its 'close' is the client going away.
    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const turnCallIds = new Set<string>()
    activeTurns.add(key)
    const prior = store.load(key)
    const conversation: Conversation = {
      messages: [...(prior?.messages ?? []), { role: 'user', content: message }],
    }
    try {
      const provider = makeProvider(providerConfig)
      const next = await runTurn({
        conversation,
        provider,
        requestTool: (name, input) =>
          new Promise<string>((resolve) => {
            const callId = randomUUID()
            turnCallIds.add(callId)
            pending.set(callId, { author, resolve })
            send('tool_request', { callId, name, input })
          }),
        onText: (text) => send('text', { text }),
        signal: ac.signal,
      })
      store.save(key, next)
      send('done', {})
      res.end()
    } catch (err) {
      // Only report the failure if the client is still connected to hear it.
      if (!res.destroyed && !res.writableEnded) {
        send('error', { message: err instanceof Error ? err.message : String(err) })
        res.end()
      }
    } finally {
      activeTurns.delete(key)
      // Never-answered calls must not linger: a late browser POST then gets a 404.
      for (const callId of turnCallIds) pending.delete(callId)
    }
  })

  app.post('/api/chat/:projectId/tool/:callId', async (req: Request, res: Response) => {
    const author = await authorFor(req)
    if (getAuthor && author === null) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const { callId } = req.params as Record<string, string>
    const entry = pending.get(callId)
    if (!entry) {
      res.status(404).json({ error: 'unknown tool call' })
      return
    }
    // A tool call belongs to the author whose turn requested it; another
    // author resolving it could inject forged results into their turn.
    if (entry.author !== author) {
      res.status(403).json({ error: 'tool call belongs to another session' })
      return
    }
    pending.delete(callId)
    const result = (req.body as { result?: unknown } | undefined)?.result
    // The provider conversation stores tool results as a string; the browser may return any JSON.
    const content = typeof result === 'string' ? result : JSON.stringify(result ?? null)
    entry.resolve(content)
    res.json({ ok: true })
  })
}
