import { describe, expect, it, vi } from 'vitest'
import { CONTEXT_BUDGET } from '../src/context.js'
import { runTurn, TOOL_RESULT_CHARS, TOOL_RESULTS_PER_TURN_CHARS } from '../src/loop.js'
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
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    await runTurn({ conversation, provider, requestTool: vi.fn() })
    await runTurn({ conversation, provider, requestTool: vi.fn(), api: 'modeling' })
    expect(seen).toEqual([buildTools('fluent'), buildTools('modeling')])
  })

  it('rejects a round with neither text nor a tool call as an empty reply, with its stop reason', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'params', input: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'usage', inputTokens: 900, outputTokens: 4000, reasoningTokens: 4000 }, { type: 'done', stopReason: 'length' }],
    ])
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    const error = await runTurn({ conversation, provider, requestTool: vi.fn(async () => '{"ok":true}') }).catch((e) => e)
    expect(error).toMatchObject({ name: 'EmptyReplyError', stopReason: 'length', message: 'the model stopped without answering (stop reason: length)' })
    expect(error.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
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

  it('caps a tool result at the context budget and tells the model', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 'tool_1', name: 'export', input: {} }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 'tool_2', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'ok' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const big = 'x'.repeat(TOOL_RESULT_CHARS + 500)
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'export it' }] },
      provider,
      requestTool: (name) => Promise.resolve(name === 'export' ? big : '{"volume": 42}'),
    })
    const [capped, small] = messages.filter((m) => m.role === 'tool').map((m) => m.content)
    expect(TOOL_RESULT_CHARS).toBe(CONTEXT_BUDGET)
    expect(capped.startsWith('x'.repeat(TOOL_RESULT_CHARS))).toBe(true)
    expect(capped.slice(TOOL_RESULT_CHARS)).toBe(`\n… [tool result truncated: ${TOOL_RESULT_CHARS} of ${big.length} characters shown]`)
    expect(small).toBe('{"volume": 42}')
  })

  it('replaces tool results past the turn total with a short note and goes on', async () => {
    const calls = Math.ceil(TOOL_RESULTS_PER_TURN_CHARS / TOOL_RESULT_CHARS) + 2
    const provider = roundsProvider([
      ...Array.from({ length: calls }, (_, i) => [{ type: 'tool_use', id: `t${i}`, name: 'export', input: {} }, { type: 'done', stopReason: 'tool_use' }]),
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'export it' }] },
      provider,
      requestTool: () => Promise.resolve('x'.repeat(TOOL_RESULT_CHARS)),
    })
    const results = messages.filter((m) => m.role === 'tool').map((m) => m.content)
    expect(results).toHaveLength(calls)
    const kept = results.filter((r) => r === 'x'.repeat(TOOL_RESULT_CHARS))
    expect(kept.length * TOOL_RESULT_CHARS).toBeLessThanOrEqual(TOOL_RESULTS_PER_TURN_CHARS)
    for (const note of results.slice(kept.length)) {
      expect(note).toBe(`[tool result omitted: this turn's tool results passed ${TOOL_RESULTS_PER_TURN_CHARS} characters]`)
    }
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done' })
  })

  it('carries the messages so far on a rejected turn', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 'tool_1', name: 'measure', input: {} }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 'tool_2', name: 'check', input: {} }, { type: 'done', stopReason: 'tool_use' }],
    ])
    const error = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'measure it' }] },
      provider,
      requestTool: (name) => (name === 'measure' ? Promise.resolve('{"volume": 42}') : new Promise(() => {})),
      toolTimeoutMs: 25,
    }).catch((e) => e)
    expect(error.name).toBe('ToolTimeoutError')
    expect(error.messages.map((m) => m.toolCallId ?? m.role)).toEqual(['user', 'assistant', 'tool_1', 'assistant'])
  })
})