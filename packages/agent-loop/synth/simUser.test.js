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
    expect(req).toMatchObject({ model: 'mm', temperature: 0, maxTokens: 600 })
    expect(flat(req)).toContain('hobbyist building a display shelf model')
    expect(flat(req)).toContain('about 340 mm long')
    expect(flat(req)).toContain('How long?')
    expect(flat(req)).not.toMatch(/```/)
  })

  it.each([['ACCEPT', true], ['ACCEPT.', true], [' accept ', true], ['I accept the size but...', false]])(
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
