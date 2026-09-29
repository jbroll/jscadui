import { describe, expect, it, vi } from 'vitest'
import { runTurn } from '../src/loop.js'
import { buildTools } from '../src/tools.js'

const roundsProvider = (rounds) => {
  const sent = []
  return {
    sent,
    async *send(messages, _tools) {
      sent.push([...messages])
      for (const event of rounds.shift() ?? []) yield event
    },
  }
}

describe('runTurn', () => {
  it('streams text with no tool call and leaves the input untouched', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' there' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const requestTool = vi.fn()
    const texts = []
    const input = { messages: [{ role: 'user', content: 'hi' }] }
    const result = await runTurn({ conversation: input, provider, requestTool, onText: (t) => texts.push(t) })
    expect(texts).toEqual(['Hello', ' there'])
    expect(requestTool).not.toHaveBeenCalled()
    expect(result).not.toBe(input)
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there', toolCalls: [] },
    ])
  })

  it('sends the tools of the chosen API, fluent by default', async () => {
    const seen = []
    const provider = {
      async *send(_messages, tools) {
        seen.push(tools)
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    await runTurn({ conversation, provider, requestTool: vi.fn() })
    await runTurn({ conversation, provider, requestTool: vi.fn(), api: 'modeling' })
    expect(seen).toEqual([buildTools('fluent'), buildTools('modeling')])
  })

  it('resolves a tool call through requestTool and continues', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'Let me measure' },
        { type: 'tool_use', id: 'tool_1', name: 'measure', input: { target: 'part1' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'It fits' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    let resolveResult
    const gate = new Promise((r) => { resolveResult = r })
    const requestTool = vi.fn(() => gate)
    const texts = []
    const turn = runTurn({
      conversation: { messages: [{ role: 'user', content: 'measure part1' }] },
      provider,
      requestTool,
      onText: (t) => texts.push(t),
    })
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledTimes(1))
    resolveResult('{"volume": 42}')
    const result = await turn
    expect(texts).toEqual(['Let me measure', 'It fits'])
    expect(result.messages).toEqual([
      { role: 'user', content: 'measure part1' },
      {
        role: 'assistant',
        content: 'Let me measure',
        toolCalls: [{ id: 'tool_1', name: 'measure', input: { target: 'part1' } }],
      },
      { role: 'tool', toolCallId: 'tool_1', content: '{"volume": 42}' },
      { role: 'assistant', content: 'It fits', toolCalls: [] },
    ])
  })

  it('times out a tool result that never arrives', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 'tool_1', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
    ])
    await expect(
      runTurn({
        conversation: { messages: [{ role: 'user', content: 'measure it' }] },
        provider,
        requestTool: () => new Promise(() => {}),
        toolTimeoutMs: 25,
      }),
    ).rejects.toMatchObject({ name: 'ToolTimeoutError' })
  })
})