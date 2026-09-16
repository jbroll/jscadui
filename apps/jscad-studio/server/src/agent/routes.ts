import { randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { createProvider, type Provider, type ProviderConfig } from '../providers/types.js'
import { runTurn, type Conversation } from './loop.js'

interface PendingToolCall {
  resolve(value: string): void
}

export interface AgentRouteOptions {
  /** Test seam: lets a fake provider stand in for a real one without any network. */
  createProvider?: (config: ProviderConfig) => Provider
}

// The chat transport. A turn streams SSE events (text, tool_request, done, error) to the browser;
// the browser executes the tool and POSTs the result back to /tool/:callId, which resolves the
// promise the loop is awaiting. Conversations and pending tool calls live in memory here; Task 10
// moves them into per-user storage.
export function mountAgentRoutes(app: Express, options: AgentRouteOptions = {}): void {
  const makeProvider = options.createProvider ?? createProvider
  const conversations = new Map<string, Conversation>()
  const activeTurns = new Set<string>()
  const pending = new Map<string, PendingToolCall>()

  app.post('/api/chat/:projectId', async (req: Request, res: Response) => {
    const { projectId } = req.params as Record<string, string>
    if (activeTurns.has(projectId)) {
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
    activeTurns.add(projectId)
    const prior = conversations.get(projectId)
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
            pending.set(callId, { resolve })
            send('tool_request', { callId, name, input })
          }),
        onText: (text) => send('text', { text }),
        signal: ac.signal,
      })
      conversations.set(projectId, next)
      send('done', {})
      res.end()
    } catch (err) {
      // Only report the failure if the client is still connected to hear it.
      if (!res.destroyed && !res.writableEnded) {
        send('error', { message: err instanceof Error ? err.message : String(err) })
        res.end()
      }
    } finally {
      activeTurns.delete(projectId)
      // Never-answered calls must not linger: a late browser POST then gets a 404.
      for (const callId of turnCallIds) pending.delete(callId)
    }
  })

  app.post('/api/chat/:projectId/tool/:callId', (req: Request, res: Response) => {
    const { callId } = req.params as Record<string, string>
    const entry = pending.get(callId)
    if (!entry) {
      res.status(404).json({ error: 'unknown tool call' })
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