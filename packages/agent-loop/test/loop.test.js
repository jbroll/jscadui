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

  it('answers a call whose arguments were not JSON with a tool error the model can retry, and goes on', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'measure', input: {}, badArguments: '{"parts":["0"]}{"x', finishReason: 'length' }, { type: 'done', stopReason: 'length' }],
      [{ type: 'tool_use', id: 't2', name: 'check', input: {}, badArguments: '{"bed' }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const requestTool = vi.fn()
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    const { messages } = await runTurn({ conversation, provider, requestTool })
    expect(requestTool).not.toHaveBeenCalled()
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))
    expect(results).toEqual([
      { ok: false, error: { name: 'ArgumentsError', message: 'arguments for measure were not valid JSON (finish_reason length); call it again with a JSON object: {"parts":["0"]}{"x' } },
      { ok: false, error: { name: 'ArgumentsError', message: 'arguments for check were not valid JSON (finish_reason tool_use); call it again with a JSON object: {"bed' } },
    ])
    expect(messages[1]).toEqual({ role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'measure', input: {} }] })
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done' })
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

  it('rejects a refused round with the provider refusal, not as an empty reply', async () => {
    const provider = roundsProvider([
      [{ type: 'refusal', text: "I'm sorry, " }, { type: 'refusal', text: "but I can't help with that request." }, { type: 'done', stopReason: 'completed' }],
    ])
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    const error = await runTurn({ conversation, provider, requestTool: vi.fn() }).catch((e) => e)
    expect(error).toMatchObject({ name: 'RefusalError', refusal: "I'm sorry, but I can't help with that request.", message: "the provider refused: I'm sorry, but I can't help with that request." })
    expect(error.messages.map((m) => m.role)).toEqual(['user'])
  })

  it('reads an anthropic refusal stop reason as a refusal', async () => {
    const provider = roundsProvider([[{ type: 'done', stopReason: 'refusal' }]])
    const error = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool: vi.fn() }).catch((e) => e)
    expect(error).toMatchObject({ name: 'RefusalError', message: 'the provider refused to answer' })
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
    const formats = ['stl', '3mf', 'obj', 'svg']
    const provider = roundsProvider([
      // Distinct arguments each round: identical repeats would trip the doom-loop guard instead.
      ...Array.from({ length: calls }, (_, i) => [{ type: 'tool_use', id: `t${i}`, name: 'export', input: { format: formats[i % formats.length], round: Math.floor(i / formats.length) } }, { type: 'done', stopReason: 'tool_use' }]),
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

  it('reports thinking, text, tool and done through onStatus as the turn moves', async () => {
    const provider = roundsProvider([
      [
        { type: 'reasoning', text: 'let me see' },
        { type: 'reasoning', text: ' more' },
        { type: 'text', text: 'Writing' },
        { type: 'text', text: ' it' },
        { type: 'tool_use', id: 't1', name: 'write', input: { path: 'main.js', content: 'x' } },
        { type: 'tool_use', id: 't2', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'Done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const statuses = []
    await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: async () => '{"ok":true}',
      onStatus: (s) => statuses.push(s),
    })
    expect(statuses).toEqual([
      { phase: 'thinking' },
      { phase: 'thinking', reasoningChars: 10 },
      { phase: 'thinking', reasoningChars: 15 },
      { phase: 'text' },
      { phase: 'tool', tool: 'measure' },
      { phase: 'tool', tool: 'write', detail: 'main.js' },
      { phase: 'thinking' },
      { phase: 'text' },
      { phase: 'done' },
    ])
  })

  it('hands each reasoning delta to onReasoning, in order with the text, and keeps it out of the messages', async () => {
    const provider = roundsProvider([
      [
        { type: 'reasoning', text: 'let me see' },
        { type: 'reasoning', text: ' more' },
        { type: 'tool_use', id: 't1', name: 'measure', input: {} },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'reasoning', text: 'fits' }, { type: 'text', text: 'Done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const heard = []
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: async () => '{"ok":true}',
      onText: (t) => heard.push(['text', t]),
      onReasoning: (t) => heard.push(['reasoning', t]),
    })
    expect(heard).toEqual([['reasoning', 'let me see'], ['reasoning', ' more'], ['reasoning', 'fits'], ['text', 'Done']])
    expect(JSON.stringify(messages)).not.toMatch(/let me see|fits/)
    expect(provider.sent[1].some((m) => 'reasoning' in m)).toBe(false)
  })

  it('reports a provider retry with the attempt it is making, then the output that follows', async () => {
    const provider = roundsProvider([
      [
        { type: 'retry', attempt: 1, maxAttempts: 4, status: 503, reason: 'busy', delayMs: 2000 },
        { type: 'retry', attempt: 2, maxAttempts: 4, status: 503, reason: 'busy', delayMs: 5000 },
        { type: 'text', text: 'ok' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const statuses = []
    await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool: vi.fn(), onStatus: (s) => statuses.push(s) })
    expect(statuses).toEqual([
      { phase: 'thinking' },
      { phase: 'retry', attempt: 2, maxAttempts: 4 },
      { phase: 'retry', attempt: 3, maxAttempts: 4 },
      { phase: 'text' },
      { phase: 'done' },
    ])
  })

  it('forwards provider usage to onUsage and onStatus without touching the messages', async () => {
    const provider = roundsProvider([
      [
        { type: 'text', text: 'hi' },
        { type: 'usage', inputTokens: 42, outputTokens: 7, reasoningTokens: null },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ])
    const heard = []
    const statuses = []
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: vi.fn(),
      onUsage: (u) => heard.push(u),
      onStatus: (s) => statuses.push(s),
    })
    expect(heard).toEqual([{ inputTokens: 42, outputTokens: 7, reasoningTokens: null }])
    expect(statuses).toContainEqual({ phase: 'usage', inputTokens: 42, outputTokens: 7, reasoningTokens: null })
    expect(JSON.stringify(messages)).not.toContain('42')
  })

  it('shortens a long tool argument in the status and reports done on a failed turn too', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'docs', input: { query: 'q'.repeat(60) } }, { type: 'done', stopReason: 'tool_use' }],
    ])
    const statuses = []
    const error = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: () => new Promise(() => {}),
      toolTimeoutMs: 25,
      onStatus: (s) => statuses.push(s),
    }).catch((e) => e)
    expect(error.name).toBe('ToolTimeoutError')
    expect(statuses).toEqual([
      { phase: 'thinking' },
      { phase: 'tool', tool: 'docs', detail: `${'q'.repeat(39)}…` },
      { phase: 'done' },
    ])
  })

  it('goes on when an onStatus callback throws', async () => {
    const provider = roundsProvider([[{ type: 'text', text: 'hi' }, { type: 'done', stopReason: 'end_turn' }]])
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: vi.fn(),
      onStatus: () => {
        throw new Error('display broke')
      },
    })
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'hi' })
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

  it('stops after maxRounds provider rounds and reports it', async () => {
    const toolRound = () => [
      { type: 'tool_use', id: `t${Math.random()}`, name: 'check', input: {} },
      { type: 'done', stopReason: 'tool_use' },
    ]
    const provider = roundsProvider([toolRound(), toolRound(), toolRound()])
    const conversation = { messages: [{ role: 'user', content: 'hi' }] }
    const result = await runTurn({ conversation, provider, requestTool: async () => '{"ok":true}', maxRounds: 2 })
    expect(result.rounds).toBe(2)
    expect(result.stopped).toBe('max_rounds')
    expect(result.messages.filter((m) => m.role === 'assistant')).toHaveLength(2)
  })

  it('caps at 32 rounds by default', async () => {
    expect((await import('../src/loop.js')).DEFAULT_MAX_ROUNDS).toBe(32)
  })

  it('asks once more with tools off at the round cap and keeps the final answer', async () => {
    const seen = []
    const provider = {
      async *send(_messages, tools, opts) {
        seen.push({ tools, toolChoice: opts?.toolChoice })
        if (seen.length <= 2) {
          yield { type: 'tool_use', id: `t${seen.length}`, name: 'check', input: { n: seen.length } }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'text', text: 'out of steps, here is what I have' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    const texts = []
    const result = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: async () => '{"ok":true}',
      maxRounds: 2,
      onText: (t) => texts.push(t),
    })
    expect(result.stopped).toBe('max_rounds')
    expect(result.rounds).toBe(2)
    expect(seen[2]).toEqual({ tools: [], toolChoice: 'none' })
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'out of steps, here is what I have' })
    expect(texts).toContain('out of steps, here is what I have')
  })

  it('still reports max_rounds when the final answer comes back empty', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'check', input: { n: 1 } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 't2', name: 'check', input: { n: 2 } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'done', stopReason: 'end_turn' }],
    ])
    const result = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool: async () => '{"ok":true}', maxRounds: 2 })
    expect(result.stopped).toBe('max_rounds')
    expect(result.messages.filter((m) => m.role === 'assistant')).toHaveLength(2)
  })

  it('sends nothing more at the cap when capFinalAnswer is off', async () => {
    let sends = 0
    const provider = {
      async *send() {
        sends += 1
        yield { type: 'tool_use', id: `t${sends}`, name: 'check', input: { n: sends } }
        yield { type: 'done', stopReason: 'tool_use' }
      },
    }
    const result = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool: async () => '{"ok":true}', maxRounds: 2, capFinalAnswer: false })
    expect(result.stopped).toBe('max_rounds')
    expect(sends).toBe(2)
  })

  it('stops the turn when the model repeats the identical call a third time', async () => {
    const call = (id) => ({ type: 'tool_use', id, name: 'measure', input: { target: 'part1' } })
    const provider = roundsProvider([[call('t1'), { type: 'done', stopReason: 'tool_use' }], [call('t2'), { type: 'done', stopReason: 'tool_use' }], [call('t3'), { type: 'done', stopReason: 'tool_use' }]])
    const requestTool = vi.fn(async () => '{"ok":true}')
    const statuses = []
    const result = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool, onStatus: (s) => statuses.push(s) })
    expect(requestTool).toHaveBeenCalledTimes(2)
    expect(result.stopped).toBe('doom_loop')
    const results = result.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))
    expect(results).toHaveLength(3)
    expect(results[2]).toMatchObject({ ok: false, error: { name: 'DoomLoopError' } })
    expect(statuses.at(-1)).toEqual({ phase: 'done', stopped: 'doom_loop' })
  })

  it('goes on when the third round calls a different tool or arguments', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'measure', input: { target: 'a' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 't2', name: 'measure', input: { target: 'a' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 't3', name: 'measure', input: { target: 'b' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const requestTool = vi.fn(async () => '{"ok":true}')
    const result = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool })
    expect(requestTool).toHaveBeenCalledTimes(3)
    expect(result.stopped).toBeUndefined()
  })

  it('hashes calls by argument value, not key order', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'write', input: { path: 'm.js', content: 'x' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 't2', name: 'write', input: { content: 'x', path: 'm.js' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', id: 't3', name: 'write', input: { path: 'm.js', content: 'x' } }, { type: 'done', stopReason: 'tool_use' }],
    ])
    const result = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool: async () => '{"ok":true}' })
    expect(result.stopped).toBe('doom_loop')
  })

  it('runs read-only tools concurrently and commits results in call order', async () => {
    const provider = roundsProvider([
      [
        { type: 'tool_use', id: 'a', name: 'read', input: { path: 'a.js' } },
        { type: 'tool_use', id: 'b', name: 'read', input: { path: 'b.js' } },
        { type: 'tool_use', id: 'c', name: 'write', input: { path: 'c.js', content: 'x' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    let active = 0
    let peak = 0
    const requestTool = async (name, input) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, input.path === 'a.js' ? 30 : 5))
      active -= 1
      return `content-of-${input.path ?? name}`
    }
    const { messages } = await runTurn({ conversation: { messages: [{ role: 'user', content: 'hi' }] }, provider, requestTool })
    expect(peak).toBeGreaterThan(1)
    expect(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual(['a', 'b', 'c'])
  })

  it('blocks a denied tool call with a result and goes on without running it', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'write', input: { path: 'm.js', content: 'x' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'fine, reading instead' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const requestTool = vi.fn(async () => '{"ok":true}')
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool,
      beforeToolCall: async (name) => (name === 'write' ? { decision: 'deny', reason: 'no writes here' } : undefined),
    })
    expect(requestTool).not.toHaveBeenCalled()
    expect(messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))).toEqual([
      { ok: false, error: { name: 'DeniedError', message: 'no writes here' } },
    ])
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'fine, reading instead' })
  })

  it('runs the tool with the hook-rewritten input', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.js' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const requestTool = vi.fn(async () => '{"ok":true}')
    await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool,
      beforeToolCall: async (_name, input) => ({ updatedInput: { ...input, path: 'b.js' } }),
    })
    expect(requestTool).toHaveBeenCalledWith('read', { path: 'b.js' })
  })

  it('turns a throwing hook into a tool error instead of failing the turn', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.js' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const requestTool = vi.fn(async () => '{"ok":true}')
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool,
      beforeToolCall: async () => {
        throw new Error('hook broke')
      },
    })
    expect(requestTool).not.toHaveBeenCalled()
    expect(messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content))[0]).toMatchObject({ ok: false })
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done' })
  })

  it('lets afterToolCall rewrite the result the model sees', async () => {
    const provider = roundsProvider([
      [{ type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.js' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'done' }, { type: 'done', stopReason: 'end_turn' }],
    ])
    const { messages } = await runTurn({
      conversation: { messages: [{ role: 'user', content: 'hi' }] },
      provider,
      requestTool: async () => '{"original":true}',
      afterToolCall: async () => ({ result: '{"rewritten":true}' }),
    })
    expect(messages.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(['{"rewritten":true}'])
  })
})
