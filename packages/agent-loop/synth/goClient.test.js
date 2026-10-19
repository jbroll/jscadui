import { describe, expect, it } from 'vitest'
import { createGoClient } from './goClient.js'

const KEY = 'sk-secret-key-123'
const okFetch = (calls) => async (url, init) => {
  calls.push({ url, init })
  return new Response(
    JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
    { status: 200 },
  )
}

describe('createGoClient', () => {
  it('sends x-opencode-session, temperature and max_tokens', async () => {
    const calls = []
    const client = createGoClient({ apiKey: KEY, fetchImpl: okFetch(calls), session: 'sess-1' })
    await client.complete({ model: 'beam-free', messages: [{ role: 'user', content: 'x' }], temperature: 0, maxTokens: 50 })
    const { url, init } = calls[0]
    expect(url).toBe('https://opencode.ai/zen/go/v1/chat/completions')
    expect(init.headers['x-opencode-session']).toBe('sess-1')
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'beam-free', temperature: 0, max_tokens: 50 })
  })

  it('returns text and usage tokens', async () => {
    const client = createGoClient({ apiKey: KEY, fetchImpl: okFetch([]), session: 's' })
    const r = await client.complete({ model: 'beam-free', messages: [] })
    expect(r).toMatchObject({ text: 'hi', inputTokens: 12, outputTokens: 3, status: 200 })
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  it('rejects with status and provider message on 400, without the key', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'Beam supports text input only' } }), { status: 400 })
    const client = createGoClient({ apiKey: KEY, fetchImpl, session: 's' })
    const err = await client.complete({ model: 'beam-free', messages: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('beam-free')
    expect(err.message).toContain('400')
    expect(err.message).toContain('Beam supports text input only')
    expect(err.message).not.toContain(KEY)
  })

  it('rejects when content is missing', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 })
    const client = createGoClient({ apiKey: KEY, fetchImpl, session: 's' })
    await expect(client.complete({ model: 'm', messages: [] })).rejects.toThrow(/m.*200/)
  })

  it('rejects a hung connection after timeoutMs, naming the model', async () => {
    const fetchImpl = (url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    const client = createGoClient({ apiKey: KEY, fetchImpl, session: 's', timeoutMs: 20 })
    const err = await client.complete({ model: 'beam-free', messages: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('beam-free')
    expect(err.message).toContain('timeout')
  })
})
