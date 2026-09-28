import { describe, expect, it } from 'vitest'
import { buildMessages, CONTEXT_BUDGET } from '../src/context.js'

const turn = (n, size) => [
  { role: 'user', content: `u${n}`.padEnd(size / 2, '.') },
  { role: 'assistant', content: `a${n}`.padEnd(size / 2, '.') },
]
const heads = (messages) => messages.map((m) => m.content.slice(0, 2))
const three = [...turn(1, 100), ...turn(2, 100), ...turn(3, 100)]

describe('buildMessages', () => {
  it('uses a 24,000 character budget by default', () => {
    expect(CONTEXT_BUDGET).toBe(24_000)
  })

  it('keeps the newest whole turns that fit', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 200 }))).toEqual(['S', 'u2', 'a2', 'u3', 'a3', 'ne'])
  })

  it('keeps a turn that lands exactly on the budget', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 300 }))).toEqual(['S', 'u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'ne'])
  })

  it('drops a turn whole rather than splitting it', () => {
    expect(heads(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 250 }))).toEqual(['S', 'u2', 'a2', 'u3', 'a3', 'ne'])
  })

  it('stops at the first turn that does not fit', () => {
    const transcript = [...turn(1, 10), ...turn(2, 500), ...turn(3, 10)]
    expect(heads(buildMessages({ systemPrompt: 'S', transcript, message: 'new', budget: 100 }))).toEqual(['S', 'u3', 'a3', 'ne'])
  })

  it('always sends the new message, even past the budget', () => {
    expect(buildMessages({ systemPrompt: 'S', transcript: three, message: 'new', budget: 0 })).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'new' },
    ])
  })

  it('counts a user message without a reply as its own turn', () => {
    const transcript = [{ role: 'user', content: 'x' }, { role: 'user', content: 'y' }, { role: 'assistant', content: 'z' }]
    expect(heads(buildMessages({ systemPrompt: 'S', transcript, message: 'new', budget: 2 }))).toEqual(['S', 'y', 'z', 'ne'])
  })

  it('puts project files after the history, outside the budget, sorted by path', () => {
    const messages = buildMessages({ systemPrompt: 'S', transcript: three, files: { 'b.js': 'B', 'a.js': 'A' }, message: 'new', budget: 0 })
    expect(messages).toHaveLength(3)
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('### a.js\n\n```js\nA\n```')
    expect(messages[1].content.indexOf('### a.js')).toBeLessThan(messages[1].content.indexOf('### b.js'))
    expect(messages[2]).toEqual({ role: 'user', content: 'new' })
  })

  it('omits the files message for an empty project and skips binary files', () => {
    expect(buildMessages({ systemPrompt: 'S', files: { 'part.stl': new ArrayBuffer(4) }, message: 'new' })).toHaveLength(2)
  })

  it('fences a file containing backticks with a longer fence', () => {
    const [, files] = buildMessages({ systemPrompt: 'S', files: { 'n.md': 'a\n```\nb' }, message: 'new' })
    expect(files.content).toContain('````md\na\n```\nb\n````')
  })
})
