import { describe, expect, it } from 'vitest'
import { buildMessages } from '../src/context.js'

const mention = (path) => ({ role: 'assistant', content: '', toolCalls: [{ id: path, name: 'write', input: { path } }] })

describe('context compression RED', () => {
  it('lists omitted files by name so the model can read them', () => {
    const files = { 'a.js': 'A'.repeat(100), 'b.js': 'B'.repeat(100), 'c.js': 'C'.repeat(100) }
    const transcript = [mention('a.js'), mention('b.js'), mention('c.js')]
    const project = buildMessages({ systemPrompt: 'S', transcript, files, message: 'new', projectBudget: 200 }).at(-2)
    // a.js content dropped (most recent are b,c) but name still visible
    expect(project.content).not.toContain('A'.repeat(20))
    expect(project.content).toContain('a.js')
  })

  it('bounds the build report so one large build cannot blow the wire limit', () => {
    const build = { ok: true, entry: 'main.js', console: ['x'.repeat(20000)], warnings: [], params: [] }
    const project = buildMessages({ systemPrompt: 'S', files: { 'main.js': 'M' }, build, message: 'new' }).at(-2)
    expect(project.content.length).toBeLessThan(12000)
    expect(project.content).toContain('main.js')
  })

  it('trims history when files+system already fill the total budget', () => {
    const t = (n) => [{ role: 'user', content: `u${n}${'.'.repeat(2000)}` }, { role: 'assistant', content: `a${n}${'.'.repeat(2000)}` }]
    const transcript = [...t(1), ...t(2), ...t(3)]
    const files = { 'big.js': 'B'.repeat(30000) }
    const messages = buildMessages({ systemPrompt: 'S'.repeat(20000), transcript, files, message: 'new' })
    const total = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
    expect(total).toBeLessThan(60000)
    // newest turn survives, oldest is evicted for summarization
    expect(messages.some((m) => m.content.startsWith('u1'))).toBe(false)
    expect(messages.some((m) => m.content.startsWith('u3'))).toBe(true)
  })
})
