import { expect, it, vi } from 'vitest'
import { buildSummaryPrompt, summarizeTranscript, summarizeWithProvider } from '../src/summarize.js'

const turns = [[{ role: 'user', content: 'make a cube' }, { role: 'assistant', content: 'saved main.js', toolCalls: [] }]]

it('folds the prior summary and truncates long messages', () => {
  const long = 'x'.repeat(5000)
  const prompt = buildSummaryPrompt([[{ role: 'user', content: long }]], 'old work')
  expect(prompt).toContain('old work')
  expect(prompt.length).toBeLessThan(3000)
})

it('delegates to the injected model', async () => {
  const callModel = vi.fn(async () => 'did things')
  await expect(summarizeTranscript({ turns, priorSummary: '' }, callModel)).resolves.toBe('did things')
  expect(callModel).toHaveBeenCalledOnce()
})

it('collects provider text until done', async () => {
  const provider = { async *send() { yield { type: 'text', text: 'a ' }; yield { type: 'text', text: 'b' }; yield { type: 'done', stopReason: 'end_turn' } } }
  await expect(summarizeWithProvider(provider)('prompt')).resolves.toBe('a b')
})
