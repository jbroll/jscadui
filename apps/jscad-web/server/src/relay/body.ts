import express from 'express'

// A single chat turn resends system + files + history + build every time;
// the 100KB express default 413s real turns as HTML. 1MB covers large
// projects while staying bounded; over-limit answers JSON so the agent
// loop surfaces `{error}` instead of an HTML page.
export const RELAY_JSON_LIMIT = '1mb'

export const relayJson = () => express.json({ limit: RELAY_JSON_LIMIT })

export const relayJsonError = () => (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = (err as { status?: number })?.status
  const type = (err as { type?: string })?.type
  const message = err instanceof Error ? err.message : ''
  if (status === 413 || type === 'entity.too.large' || /too large|too\.large|entity/i.test(`${type ?? ''} ${message}`)) {
    if (!res.headersSent) res.status(413).json({ error: 'payload too large' })
    return
  }
  next(err)
}
