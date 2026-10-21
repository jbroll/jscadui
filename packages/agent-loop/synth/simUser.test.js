import { describe, expect, it } from 'vitest'
import { ACCEPT, SYSTEM_RULES, createSimUser } from './simUser.js'

const scenario = { persona: 'hobbyist building a display shelf model', facts: ['about 340 mm long', 'display piece'] }
const history = [
  { role: 'user', text: 'make a jeep' },
  { role: 'question', text: 'How long?' },
  { role: 'assistant', text: 'Done.' },
]

const fakeClient = (text) => ({
  calls: [],
  async complete(req) {
    this.calls.push(req)
    return { text, ms: 5, inputTokens: 7, outputTokens: 2, status: 200 }
  },
})
const flat = (req) => JSON.stringify(req.messages)

describe('createSimUser', () => {
  it('answer sends persona and facts but never code', async () => {
    const client = fakeClient('about 340 mm')
    const user = createSimUser({ client, model: 'mm', maxTokens: 600, vision: true, scenario })
    const r = await user.answer('How long?', history)
    expect(r).toEqual({ text: 'about 340 mm', call: { ms: 5, inputTokens: 7, outputTokens: 2 } })
    const req = client.calls[0]
    expect(req).toMatchObject({ model: 'mm', temperature: 0, maxTokens: 600, reasoningEffort: 'low' })
    expect(flat(req)).toContain('hobbyist building a display shelf model')
    expect(flat(req)).toContain('about 340 mm long')
    expect(flat(req)).toContain('How long?')
    expect(flat(req)).not.toMatch(/```/)
  })

  it('asks again with twice the tokens after a cut-off reply, and again after a timeout', async () => {
    const failures = [Object.assign(new Error('cut'), { name: 'LengthError' }), Object.assign(new Error('slow'), { name: 'TimeoutError' })]
    const client = {
      calls: [],
      async complete(req) {
        this.calls.push(req)
        if (failures.length) throw failures.shift()
        return { text: 'about 340 mm', ms: 5, inputTokens: 7, outputTokens: 2, status: 200 }
      },
    }
    const user = createSimUser({ client, model: 'mm', maxTokens: 600, vision: false, scenario, retryDelayMs: 0 })
    expect((await user.answer('How long?', history)).text).toBe('about 340 mm')
    expect(client.calls.map((c) => c.maxTokens)).toEqual([600, 1200, 1200])
  })

  it('asks again after a 503 or 429, but not after a 400', async () => {
    const answers = (status) => {
      const client = {
        calls: 0,
        async complete() {
          this.calls += 1
          if (this.calls === 1) throw Object.assign(new Error(`HTTP ${status}`), { status })
          return { text: 'fine', ms: 1, inputTokens: 1, outputTokens: 1, status: 200 }
        },
      }
      return client
    }
    for (const status of [503, 429]) {
      const client = answers(status)
      expect((await createSimUser({ client, model: 'mm', maxTokens: 600, scenario, retryDelayMs: 0 }).answer('?', history)).text).toBe('fine')
      expect(client.calls).toBe(2)
    }
    const refused = answers(400)
    await expect(createSimUser({ client: refused, model: 'mm', maxTokens: 600, scenario }).answer('?', history)).rejects.toThrow('HTTP 400')
    expect(refused.calls).toBe(1)
  })

  it('gives up after three attempts, and at once on any other error', async () => {
    const failing = (name) => ({
      calls: 0,
      async complete() {
        this.calls += 1
        throw Object.assign(new Error(name), { name })
      },
    })
    const cut = failing('LengthError')
    await expect(createSimUser({ client: cut, model: 'mm', maxTokens: 600, scenario, retryDelayMs: 0 }).answer('?', history)).rejects.toThrow('LengthError')
    expect(cut.calls).toBe(3)
    const refused = failing('Error')
    await expect(createSimUser({ client: refused, model: 'mm', maxTokens: 600, scenario }).answer('?', history)).rejects.toThrow('Error')
    expect(refused.calls).toBe(1)
  })

  it.each([
    ['ACCEPT', true],
    ['ACCEPT.', true],
    [' accept ', true],
    ['**ACCEPT**', true],
    ['`ACCEPT`', true],
    ['"ACCEPT"', true],
    ['ACCEPT\n\nlooks good', true],
    ['\n**ACCEPT!**\nthanks', true],
    ['I accept the size but...', false],
    ['ACCEPTED, mostly', false],
    ['Not yet.\nACCEPT once the wheels are round', false],
  ])(
    'critique %j accepted=%s',
    async (reply, accepted) => {
      const user = createSimUser({ client: fakeClient(reply), model: 'm', maxTokens: 1, vision: false, scenario })
      const r = await user.critique({ history, finalText: 'Done.', report: {}, images: [] })
      expect(r.accepted).toBe(accepted)
      expect(r.text).toBe(accepted ? null : reply)
      expect(r.call).toEqual({ ms: 5, inputTokens: 7, outputTokens: 2 })
    },
  )

  it('critique omits images when vision is false', async () => {
    const client = fakeClient(ACCEPT)
    const user = createSimUser({ client, model: 'm', maxTokens: 1, vision: false, scenario })
    await user.critique({ history, finalText: 'Done.', report: {}, images: ['data:image/png;base64,AAA'] })
    expect(flat(client.calls[0])).not.toContain('image_url')
  })

  it('critique sends images when vision is true and clips the report', async () => {
    const client = fakeClient(ACCEPT)
    const user = createSimUser({ client, model: 'm', maxTokens: 1, vision: true, scenario })
    await user.critique({ history, finalText: 'Done.', report: { big: 'x'.repeat(9000) }, images: ['data:image/png;base64,AAA'] })
    const text = flat(client.calls[0])
    expect(text).toContain('image_url')
    expect(text).not.toContain('x'.repeat(4001))
  })

  it('system prompt forbids naming APIs or code', () => {
    expect(SYSTEM_RULES).toContain('Never name APIs, code, functions or tools')
    expect(SYSTEM_RULES).toContain('Never suggest how to fix')
    expect(SYSTEM_RULES).toContain('exactly ACCEPT')
  })
})
