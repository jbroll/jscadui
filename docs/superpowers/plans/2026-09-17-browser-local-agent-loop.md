# Browser-local agent loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing agent turn loop entirely in the browser against a CORS relay, removing the `/api/chat` server dependency from `apps/jscad-web`.

**Architecture:** New browser-safe `packages/agent-loop` ports `runTurn` and both provider adapters from the studio server to plain JS; `apps/jscad-web/src/aiChat.js` drives the loop directly and executes tools through the existing `aiBridge.js` bridge. Provider HTTP points at the relay base URL, which proxies path-preserving to the provider.

**Tech Stack:** ES modules, ES2022+, JSDoc-typed JS, `fetch` + `ReadableStream`, vitest, Playwright.

## Global Constraints

- ES2022+ with no polyfills and no compat shims.
- JSDoc-typed JS in apps and packages; no TypeScript in the new package.
- Comments say why, never what; one or two lines; default to none.
- Tool handlers never throw; failure is a JSON result `{ok:false, error:{name,message}}`.
- Provider config is fail-closed: no key or no model means no turn.
- No markdown fence extraction anywhere; prose is never parsed for code.
- Studio server loop and routes stay untouched for hosted use.
- Follow-on plans (not this one): prod relay service, rowboat storage.

---

### Task 1: Scaffold `packages/agent-loop` with types, tools, prompt

**Files:**
- Create: `packages/agent-loop/package.json`
- Create: `packages/agent-loop/index.js`
- Create: `packages/agent-loop/src/tools.js`
- Create: `packages/agent-loop/prompt.md`
- Test: `packages/agent-loop/test/tools.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `TOOLS` (array of `{name, description, inputSchema}`), `SYSTEM_PROMPT` (string), package `name` `@jscadui/agent-loop`.

- [ ] **Step 1: Write the failing test**

```js
// packages/agent-loop/test/tools.test.js
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../src/tools.js'

describe('agent tools', () => {
  it('exposes the seven browser tools with input schemas', async () => {
    const names = TOOLS.map((t) => t.name)
    expect(names).toEqual(['eval', 'params', 'measure', 'check', 'view', 'export', 'writeModel'])
    for (const tool of TOOLS) {
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('keeps prompt.js in sync with prompt.md', async () => {
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const dir = dirname(fileURLToPath(import.meta.url))
    const md = await readFile(join(dir, '..', 'prompt.md'), 'utf-8')
    const { SYSTEM_PROMPT } = await import('../src/prompt.js')
    expect(SYSTEM_PROMPT.trim()).toBe(md.trim().replace(/^<!--[\s\S]*?-->\n/, ''))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools.test.js`
Workdir: `packages/agent-loop`
Expected: FAIL with "Failed to resolve import ../src/tools.js" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```json
// packages/agent-loop/package.json
{
  "name": "@jscadui/agent-loop",
  "version": "0.1.0",
  "description": "Browser-local agent loop and provider adapters for JSCAD apps",
  "type": "module",
  "main": "index.js",
  "files": [
    "index.js",
    "src",
    "prompt.md"
  ],
  "scripts": {
    "test": "vitest run"
  },
  "license": "MIT"
}
```

```js
// packages/agent-loop/index.js
export { TOOLS } from './src/tools.js'
export { SYSTEM_PROMPT } from './src/prompt.js'
```

```js
// packages/agent-loop/src/tools.js
// Tool definitions the browser loop hands to the provider. Schemas match the
// studio server so prompts behave the same against either loop.
export const TOOLS = [
  {
    name: 'eval',
    description: 'Evaluate a new model source and return the resulting parameter definitions and geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The model source code to evaluate' },
        entry: { type: 'string', description: 'The entry file name (defaults to the current entry)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'params',
    description: 'Return the current model parameter definitions and their values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'measure',
    description: 'Measure the current model geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        parts: { type: 'string', description: 'The part or parts to measure' },
        between: { type: 'array', items: { type: 'string' }, description: 'Measure between named parts' },
        anchors: { type: 'array', items: { type: 'string' }, description: 'Anchor points to include' },
        section: { type: 'string', description: 'Section to measure' },
      },
    },
  },
  {
    name: 'check',
    description: 'Check the current model against a print bed.',
    inputSchema: {
      type: 'object',
      properties: {
        bed: { type: 'string', description: 'Bed name, e.g. mk3' },
        options: { type: 'object', description: 'Check options' },
      },
      required: ['bed'],
    },
  },
  {
    name: 'view',
    description: 'Render a view of the current model and return a screenshot the assistant can inspect.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', description: 'A camera preset name' },
        camera: { type: 'object', description: 'An explicit camera position' },
      },
    },
  },
  {
    name: 'export',
    description: 'Export the current model in the given format.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['stl', '3mf', 'obj', 'svg'], description: 'The export format' },
      },
      required: ['format'],
    },
  },
  {
    name: 'writeModel',
    description: 'Replace the model source and create a new version.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The full model source code' },
        entry: { type: 'string', description: 'The entry file name' },
        message: { type: 'string', description: 'A version message describing the change' },
      },
      required: ['source'],
    },
  },
]
```

```js
// packages/agent-loop/src/prompt.js
// Browser-safe string export of the versioned system prompt. The readable
// source lives in prompt.md; the test below fails if the two drift apart.
export const SYSTEM_PROMPT = `# JSCAD modeling assistant

You write JSCAD models as ES-module JavaScript. The entry file defaults to
\`main.js\`; sibling files resolve inside the project and bare package names
resolve to the package CDN.

## Parameters

Inline UI parameter definitions via proxy assignment on \`params\`:

\`\`\`javascript
params.radius = { type: 'slider', default: 5, min: 1, max: 20, step: 0.5 }
\`\`\`

\`params._type = 'Name'\` labels a UI section. Underscore-prefixed properties
(\`params._foo\`) hide a parameter from the UI.

## Tool policy

- Model code travels only in tool-call arguments, never in chat prose, and
  prose is never parsed for code. Always use tools.
- Try ideas with \`eval\`, verify with \`measure\`/\`check\`/\`view\` before claiming
  a result, persist with \`writeModel\`.
- A tool failure is a JSON result, not a dead end: read \`error.message\` and
  try again with corrected input.
`
```

```md
<!-- packages/agent-loop/prompt.md -->
# JSCAD modeling assistant

You write JSCAD models as ES-module JavaScript. The entry file defaults to
`main.js`; sibling files resolve inside the project and bare package names
resolve to the package CDN.

## Parameters

Inline UI parameter definitions via proxy assignment on `params`:

```javascript
params.radius = { type: 'slider', default: 5, min: 1, max: 20, step: 0.5 }
```

`params._type = 'Name'` labels a UI section. Underscore-prefixed properties
(`params._foo`) hide a parameter from the UI.

## Tool policy

- Model code travels only in tool-call arguments, never in chat prose, and
  prose is never parsed for code. Always use tools.
- Try ideas with `eval`, verify with `measure`/`check`/`view` before claiming
  a result, persist with `writeModel`.
- A tool failure is a JSON result, not a dead end: read `error.message` and
  try again with corrected input.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tools.test.js`
Workdir: `packages/agent-loop`
Expected: PASS (1 test file, 1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/package.json packages/agent-loop/index.js packages/agent-loop/src/tools.js packages/agent-loop/src/prompt.js packages/agent-loop/prompt.md packages/agent-loop/test/tools.test.js
git commit -m "feat(agent-loop): scaffold package with tool definitions and system prompt"
```

---

### Task 2: Port `runTurn` to `packages/agent-loop/src/loop.js`

**Files:**
- Create: `packages/agent-loop/src/loop.js`
- Modify: `packages/agent-loop/index.js` (add `runTurn`, `ToolTimeoutError` exports)
- Test: `packages/agent-loop/test/loop.test.js`

**Interfaces:**
- Consumes: `TOOLS` shape from Task 1 (provider `send(messages, tools)` yields `{type:'text'|'tool_use'|'done'}` events).
- Produces: `runTurn({conversation, provider, requestTool, onText, signal, toolTimeoutMs}) => Promise<Conversation>`; `ToolTimeoutError extends Error`; `Conversation` is `{messages: ProviderMessage[]}` where `ProviderMessage` is `{role:'system'|'user', content:string} | {role:'assistant', content:string|null, toolCalls:ToolCall[]} | {role:'tool', toolCallId:string, content:string}`.

- [ ] **Step 1: Write the failing test**

```js
// packages/agent-loop/test/loop.test.js
import { describe, expect, it, vi } from 'vitest'
import { runTurn } from '../src/loop.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/loop.test.js`
Workdir: `packages/agent-loop`
Expected: FAIL with "Failed to resolve import ../src/loop.js".

- [ ] **Step 3: Write minimal implementation**

```js
// packages/agent-loop/src/loop.js
// Browser-safe agent turn: streams provider text out, hands each tool_use to
// the caller's requestTool, feeds string results back, repeats until the
// provider answers with no tool calls. Ported from the studio server loop;
// the only runtime needs are AbortSignal/clearTimeout plus the fetch in providers.
import { TOOLS } from './tools.js'

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

export class ToolTimeoutError extends Error {
  constructor(callId, name, timeoutMs) {
    super(`tool ${name} (${callId}) timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
  }
}

const abortError = (message) => {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

// Races iterator.next() against the abort signal so a stalled provider stream
// cannot outlive a disconnected view.
const nextOrAbort = async (iterator, signal) => {
  if (!signal) return iterator.next()
  if (signal.aborted) throw abortError('turn aborted')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      iterator.return?.(undefined).catch(() => {})
      reject(abortError('turn aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    iterator.next().then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

// Races a tool result against its timeout and the abort signal.
const withTimeout = (promise, timeoutMs, signal, makeTimeoutError) =>
  new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(makeTimeoutError())
    }, timeoutMs)
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(abortError('turn aborted'))
    }
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(abortError('turn aborted'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      },
    )
  })

/**
 * @param {{conversation:{messages:Array<object>},provider:{send:Function},requestTool:Function,onText?:Function,signal?:AbortSignal,toolTimeoutMs?:number}} options
 * @returns {Promise<{messages:Array<object>}>} a NEW conversation; the input is never mutated.
 */
export const runTurn = (options) => {
  const { conversation, provider, requestTool, onText, signal } = options
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const messages = [...conversation.messages]

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('turn aborted'))
      return
    }
    let iterator
    let cancelled = false
    const cancel = () => {
      cancelled = true
      iterator?.return?.(undefined).catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()

    void (async () => {
      try {
        for (;;) {
          const text = []
          const toolCalls = []
          iterator = provider.send(messages, TOOLS)[Symbol.asyncIterator]()
          try {
            for (;;) {
              const { done, value } = await nextOrAbort(iterator, signal)
              if (done) break
              if (value.type === 'text') {
                text.push(value.text)
                onText?.(value.text)
              } else if (value.type === 'tool_use') {
                toolCalls.push({ id: value.id, name: value.name, input: value.input })
              } else if (value.type === 'done') {
                break
              }
            }
          } finally {
            iterator.return?.(undefined).catch(() => {})
          }
          if (cancelled) throw abortError('turn aborted')
          if (text.length > 0 || toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: text.length > 0 ? text.join('') : null,
              toolCalls,
            })
          }
          if (toolCalls.length === 0) break
          for (const call of toolCalls) {
            const content = await withTimeout(
              requestTool(call.name, call.input),
              toolTimeoutMs,
              signal,
              () => new ToolTimeoutError(call.id, call.name, toolTimeoutMs),
            )
            messages.push({ role: 'tool', toolCallId: call.id, content })
          }
        }
        resolve({ messages })
      } catch (err) {
        reject(err)
      } finally {
        signal?.removeEventListener('abort', cancel)
        if (cancelled) iterator?.return?.(undefined).catch(() => {})
      }
    })()
  })
}
```

Append to `packages/agent-loop/index.js`:

```js
export { runTurn, ToolTimeoutError } from './src/loop.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Workdir: `packages/agent-loop`
Expected: PASS (2 test files, all green).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/loop.js packages/agent-loop/index.js packages/agent-loop/test/loop.test.js
git commit -m "feat(agent-loop): port browser-safe runTurn with timeout and abort"
```

---

### Task 3: Port provider adapters with recorded-SSE tests

**Files:**
- Create: `packages/agent-loop/src/providers.js`
- Modify: `packages/agent-loop/index.js` (add `createProvider` export)
- Test: `packages/agent-loop/test/providers.test.js`

**Interfaces:**
- Consumes: `TOOLS` item shape from Task 1 for request bodies.
- Produces: `createProvider({kind:'anthropic'|'openai', apiKey, model, baseUrl?}) => {send(messages, tools): AsyncIterable<{type:'text',text}|{type:'tool_use',id,name,input}|{type:'done',stopReason}>}`. `baseUrl` points at the relay, which proxies path-preserving to the provider, so adapters need no relay-specific code.

- [ ] **Step 1: Write the failing test**

```js
// packages/agent-loop/test/providers.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider } from '../src/providers.js'

const TOOLS = [
  {
    name: 'measure',
    description: 'Measure the current model',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
  },
]

const sseBody = (text) =>
  new Response(text, { headers: { 'content-type': 'text/event-stream' } }).body

const anthropicToolUse =
  `event: message_start\ndata: {"type":"message_start"}\n\n` +
  `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"measure","input":{}}}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"target\\": \\""}}\n\n` +
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"part1\\"}"}}\n\n` +
  `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('providers', () => {
  it('anthropic: assembles split tool input and posts to baseUrl', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody(anthropicToolUse)))
    const provider = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.test/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events).toEqual([{ type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } }])
  })

  it('openai-compatible: streams text then tool_use then done', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"measure","arguments":""}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"target\\":\\"part1\\"}"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n` +
      `data: [DONE]\n\n`
    fetchMock.mockResolvedValue(new Response(sseBody(body)))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    const events = []
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(events[0]).toEqual({ type: 'text', text: 'Hi' })
    expect(events).toContainEqual({ type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'part1' } })
    expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'tool_calls' })
  })

  it('rejects unknown provider kinds', () => {
    expect(() => createProvider({ kind: 'other', apiKey: 'k', model: 'm' })).toThrow(/unknown kind/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/providers.test.js`
Workdir: `packages/agent-loop`
Expected: FAIL with "Failed to resolve import ../src/providers.js".

- [ ] **Step 3: Write minimal implementation**

```js
// packages/agent-loop/src/providers.js
// Provider adapters over fetch. baseUrl points at the relay, which proxies
// path-preserving to the provider host, so no relay-specific code lives here.
// Anthropic default base is the provider itself for non-browser use.
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com'

// Yields every `data:` payload of an SSE stream.
async function* ssePayloads(body) {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.startsWith('data:')) yield line.slice(5).trim()
    }
  }
  if (buffer.startsWith('data:')) yield buffer.slice(5).trim()
}

const toAnthropicMessage = (message) => {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }],
    }
  }
  if (message.role === 'assistant') {
    const content = []
    if (message.content) content.push({ type: 'text', text: message.content })
    for (const call of message.toolCalls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
    return { role: 'assistant', content }
  }
  return { role: message.role, content: message.content }
}

const toAnthropicTool = (tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })

const anthropicProvider = (config) => ({
  async *send(messages, tools) {
    const body = {
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: messages.map(toAnthropicMessage),
    }
    if (tools.length > 0) body.tools = tools.map(toAnthropicTool)
    const res = await fetch(`${config.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`anthropic: ${detail} (status ${res.status})`)
    }
    // Tool input JSON arrives split across input_json_delta events; hold it per block until stop.
    const toolInputs = new Map()
    for await (const payload of ssePayloads(res.body)) {
      let event
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        toolInputs.set(event.index ?? 0, {
          id: event.content_block.id ?? '',
          name: event.content_block.name ?? '',
          json: '',
        })
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = event.delta.text
        if (typeof text === 'string') yield { type: 'text', text }
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const acc = toolInputs.get(event.index ?? 0)
        if (acc) acc.json += event.delta.partial_json ?? ''
      } else if (event.type === 'content_block_stop') {
        const acc = toolInputs.get(event.index ?? 0)
        if (acc) {
          toolInputs.delete(event.index ?? 0)
          let input
          try {
            input = JSON.parse(acc.json || '{}')
          } catch {
            throw new Error(`anthropic: unparseable tool input for ${acc.name}`)
          }
          yield { type: 'tool_use', id: acc.id, name: acc.name, input }
        }
      } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
        yield { type: 'done', stopReason: event.delta.stop_reason }
      } else if (event.type === 'error') {
        throw new Error(`anthropic: ${event.error?.message ?? 'provider error'}`)
      }
    }
  },
})

const toOpenAIMessage = (message) => {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant' && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

const toOpenAITool = (tool) => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
})

const openaiProvider = (config) => ({
  async *send(messages, tools) {
    const body = {
      model: config.model,
      stream: true,
      messages: messages.map(toOpenAIMessage),
    }
    if (tools.length > 0) body.tools = tools.map(toOpenAITool)
    const res = await fetch(`${config.baseUrl ?? OPENAI_DEFAULT_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`openai: ${detail} (status ${res.status})`)
    }
    // Function arguments arrive split across chunks; hold each tool call by index until done.
    const toolCalls = new Map()
    let stopReason = ''
    for await (const payload of ssePayloads(res.body)) {
      if (payload === '[DONE]') break
      let chunk
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }
      const choice = chunk.choices?.[0]
      const delta = choice?.delta ?? {}
      if (typeof delta.content === 'string' && delta.content !== '') {
        yield { type: 'text', text: delta.content }
      }
      if (delta.tool_calls) {
        for (const call of delta.tool_calls) {
          const acc = toolCalls.get(call.index ?? 0) ?? { id: '', name: '', args: '' }
          if (call.id) acc.id = call.id
          if (call.function?.name) acc.name = call.function.name
          if (call.function?.arguments) acc.args += call.function.arguments
          toolCalls.set(call.index ?? 0, acc)
        }
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason
    }
    for (const acc of toolCalls.values()) {
      let input
      try {
        input = JSON.parse(acc.args || '{}')
      } catch {
        throw new Error(`openai: unparseable tool arguments for ${acc.name}`)
      }
      yield { type: 'tool_use', id: acc.id, name: acc.name, input }
    }
    yield { type: 'done', stopReason: stopReason || 'stop' }
  },
})

/**
 * @param {{kind:'anthropic'|'openai',apiKey:string,model:string,baseUrl?:string}} config
 */
export const createProvider = (config) => {
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
```

Append to `packages/agent-loop/index.js`:

```js
export { createProvider } from './src/providers.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Workdir: `packages/agent-loop`
Expected: PASS (3 test files, all green).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/index.js packages/agent-loop/test/providers.test.js
git commit -m "feat(agent-loop): port anthropic and openai-compatible providers"
```

---

### Task 4: Drive the loop from `aiChat.js` through the relay

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js:35-149` (replace `/api/chat` SSE turn with direct `runTurn`)
- Modify: `apps/jscad-web/package.json:17-47` (add `@jscadui/agent-loop` dependency)
- Modify: `apps/jscad-web/main.js:617-625` (pass relay-aware provider; keep `requestTool` wiring)

**Interfaces:**
- Consumes: `runTurn`, `createProvider`, `SYSTEM_PROMPT` from `@jscadui/agent-loop` (Tasks 1-3); `getProviderConfig()` shape `{kind, model, baseUrl?, apiKey}` from `src/aiAccount.js:46-51`; `requestTool(name, input)` from `main.js` `aiDeps`.
- Produces: chat turn with no `/api/chat` fetch; tool lines render per `tool_use`; provider `baseUrl` defaults to the relay `https://jscad.rkroll.com` with a `localStorage` override `jscad-ai.relay` for tests.

- [ ] **Step 1: Write the failing test**

Add a chat-turn unit test with a fake loop injected through a new `runTurnFn` option (production default is the real `runTurn`):

```js
// apps/jscad-web/test/aiChat.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { initChat } from '../src/aiChat.js'

describe('browser chat turn', () => {
  it('runs requestTool for a tool_use and appends streamed text', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ requestTool, onText }) => {
      onText('Hello')
      const result = await requestTool('measure', {})
      onText(`volume ${result.volume}`)
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'how big?'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))
    expect(container.querySelector('.chat-messages').textContent).toMatch(/volume 42/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/aiChat.test.js`
Workdir: `apps/jscad-web`
Expected: FAIL with "Failed to resolve import ../src/aiChat.js option runTurnFn" or "initChat option runTurnFn ignored" — the current `initChat` fetches `/api/chat` and never calls `runTurnFn`.

- [ ] **Step 3: Write minimal implementation**

Replace the turn transport in `apps/jscad-web/src/aiChat.js`, keeping the DOM helpers (`el`, `parseEvents` removed). New shape:

```js
// apps/jscad-web/src/aiChat.js
// The chat panel drives the browser-local agent loop: it builds the provider
// from the account panel, runs runTurn directly, executes each tool request
// through requestTool, and renders streamed text. Provider HTTP targets the
// relay, which proxies path-preserving to the provider and stores nothing.
import { createProvider, runTurn as defaultRunTurn, SYSTEM_PROMPT } from '@jscadui/agent-loop'

const RELAY_DEFAULT = 'https://jscad.rkroll.com'
const RELAY_OVERRIDE_KEY = 'jscad-ai.relay'

export const relayBaseUrl = () =>
  globalThis.localStorage?.getItem(RELAY_OVERRIDE_KEY) || RELAY_DEFAULT

// ... keep el(), addMessage(), addToolLine(), setRunning() unchanged ...

/**
 * @param {{container:HTMLElement,requestTool:Function,getProvider:Function,runTurnFn?:Function}} options
 */
export const initChat = ({ container, requestTool, getProvider, runTurnFn = defaultRunTurn }) => {
  // ... keep header/messages/form DOM construction unchanged ...
  const handleTool = async (name, input) => {
    const resultEl = addToolLine(name, input)
    const result = await requestTool(name, input)
    resultEl.textContent = JSON.stringify(result, null, 2)
    return typeof result === 'string' ? result : JSON.stringify(result ?? null)
  }
  const runTurnLocal = async (message) => {
    const selection = getProvider()
    if (!selection) {
      addMessage('Set your model and API key in AI settings first.', 'error')
      return
    }
    setRunning(true)
    addMessage(message, 'user')
    assistantEl = null
    const aborter = new AbortController()
    try {
      const provider = createProvider({ ...selection, baseUrl: selection.baseUrl || relayBaseUrl() })
      await runTurnFn({
        conversation: { messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: message }] },
        provider,
        requestTool: handleTool,
        onText: (text) => {
          if (!assistantEl) assistantEl = addMessage('', 'assistant')
          assistantEl.textContent += text
          messagesEl.scrollTop = messagesEl.scrollHeight
        },
        signal: aborter.signal,
      })
    } catch (err) {
      addMessage(err.message, 'error')
    } finally {
      assistantEl = null
      setRunning(false)
    }
  }
  // ... keep submit listener, calling runTurnLocal instead of the /api/chat fetch ...
}
```

Add `"@jscadui/agent-loop": "*"` to `apps/jscad-web/package.json` dependencies (alphabetical position after `@jscadui/key-store` is not required; keep sorted order used in the file).

`apps/jscad-web/main.js` keeps `requestTool: (name, input) => handleToolRequest(name, input, aiDeps)` unchanged; no `projectId` is passed anymore.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/aiChat.test.js test/aiBridge.test.js`
Workdir: `apps/jscad-web`
Expected: PASS (both files green; `aiChat.test.js` runs under jsdom via its `@vitest-environment jsdom` pragma, matching `src/directoryParser.test.js`).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/package.json apps/jscad-web/main.js apps/jscad-web/test/aiChat.test.js
git commit -m "feat(jscad-web): drive agent turns from the browser through the relay"
```

---

### Task 5: Stub-relay e2e turn with real worker measurements

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat.spec.js` (stub the relay provider API instead of `/api/chat`)
- Modify: `apps/jscad-web/README.md:69-77` (document relay mode and override key)

**Interfaces:**
- Consumes: Task 4 chat flow; `RELAY_OVERRIDE_KEY` (`jscad-ai.relay`) for pointing the page at the stub.
- Produces: green e2e proving text streams, a real `measure` tool executes against the worker, and the turn completes.

- [ ] **Step 1: Write the failing test**

Replace the stub server in `apps/jscad-web/e2e/ai-chat.spec.js` with a stub
relay speaking the OpenAI-compatible provider API. First call streams one
`measure` tool call; second call (carrying the tool result) answers text:

```js
// A stub relay speaking the provider API the browser loop calls: first POST
// streams one measure tool call, second POST answers Done. The page points at
// it via localStorage jscad-ai.relay, so no /api/chat server exists.
import { test, expect } from '@playwright/test'
import http from 'node:http'
import { dismissWelcome, waitForRender, assertNoError } from './helpers.js'

const chunk = (json) => `data: ${JSON.stringify(json)}\n\n`

const startStubRelay = () =>
  new Promise((resolve) => {
    const requests = []
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
          const parsed = JSON.parse(body)
          requests.push(parsed)
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
          if (requests.length === 1) {
            res.write(chunk({ choices: [{ delta: { content: 'Measuring. ' } }] }))
            res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'measure', arguments: '' } }] } }] }))
            res.write(chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] }))
            res.write(chunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }))
            res.write('data: [DONE]\n\n')
            res.end()
          } else {
            res.write(chunk({ choices: [{ delta: { content: 'Done.' } }] }))
            res.write(chunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
            res.write('data: [DONE]\n\n')
            res.end()
          }
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, requests }))
  })

test.describe('AI chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await assertNoError(page)
  })

  test('panel opens and runs a measure turn through the relay stub', async ({ page }) => {
    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await expect(page.locator('#ai-chat')).toBeVisible()

    await page.locator('#ai-account input[placeholder="claude-sonnet-4-5"]').fill('stub-model')
    await page.locator('#ai-account input[placeholder="sk-..."]').fill('sk-test')
    await page.locator('#ai-account button', { hasText: 'Save key' }).click()
    await expect(page.locator('#ai-account')).toContainText('Key set.')

    const stub = await startStubRelay()
    await page.addInitScript((port) => {
      window.localStorage.setItem('jscad-ai.relay', `http://127.0.0.1:${port}`)
    }, stub.port)
    await page.reload()
    await dismissWelcome(page)
    await waitForRender(page)

    await page.locator('#menu-button').click()
    await page.locator('#ai-chat-btn').click()
    await page.locator('.chat-input').fill('how big is it?')
    await page.locator('.chat-send').click()

    await expect(page.locator('.chat-messages')).toContainText('Done.', { timeout: 30_000 })
    expect(stub.requests.length).toBeGreaterThanOrEqual(2)
    expect(stub.requests[0].model).toBe('stub-model')
    expect(stub.requests[0].tools.map((t) => t.function.name)).toContain('measure')
    const toolMsg = stub.requests[1].messages.find((m) => m.role === 'tool')
    const result = JSON.parse(toolMsg.content)
    expect(result.dimensions).toHaveLength(3)
    expect(result.volume).toBeGreaterThan(0)
    stub.server.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/ai-chat.spec.js`
Workdir: `apps/jscad-web`
Expected: FAIL — the page still POSTs `/api/chat/local` (old spec) or the new chat never contacts the stub relay path.

- [ ] **Step 3: Write minimal implementation**

The test in Step 1 is already the implementation target: make it pass by
completing Task 4 (the page must POST provider rounds to the relay override
instead of `/api/chat`). If the spec file does not yet match Step 1, overwrite
`apps/jscad-web/e2e/ai-chat.spec.js` with the Step 1 body verbatim, then fix
any selector drift against the current drawer DOM (`#menu-button`,
`#ai-chat-btn`, `#ai-chat`, `.chat-input`, `.chat-send`, `.chat-messages`).

Update the agent paragraph in `apps/jscad-web/README.md` to: browser-local
loop, relay default `https://jscad.rkroll.com`, override via `localStorage
'jscad-ai.relay'`, tests `npx vitest run test/aiChat.test.js` and `npx
playwright test e2e/ai-chat.spec.js` against a stub relay with real local
measurements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/ai-chat.spec.js`
Workdir: `apps/jscad-web`
Expected: PASS (1 test, real `dimensions` length 3 and `volume > 0` observed in the relayed tool round).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat.spec.js apps/jscad-web/README.md
git commit -m "test(jscad-web): stub-relay e2e turn with real worker measurements"
```

---

## File map

| File | Responsibility |
|---|---|
| `packages/agent-loop/package.json` | Workspace package manifest |
| `packages/agent-loop/index.js` | Re-exports `TOOLS`, `SYSTEM_PROMPT`, `runTurn`, `ToolTimeoutError`, `createProvider` |
| `packages/agent-loop/src/tools.js` | Seven tool definitions (port of server `tools.ts`) |
| `packages/agent-loop/src/loop.js` | Browser-safe `runTurn` (port of server `loop.ts`, no Node imports) |
| `packages/agent-loop/src/providers.js` | Anthropic + OpenAI-compatible adapters over `fetch` |
| `packages/agent-loop/src/prompt.js` | Browser-safe `SYSTEM_PROMPT` string export (tested in sync with `prompt.md`) |
| `packages/agent-loop/prompt.md` | System prompt: JSCAD conventions + tool policy |
| `apps/jscad-web/src/aiChat.js` | Thin view over `runTurn`; renders text and tool lines |
| `apps/jscad-web/e2e/ai-chat.spec.js` | Stub-relay e2e with real worker measurements |

## Follow-on plans (out of scope here)

- Prod relay service at `jscad.rkroll.com`: allowlist, no-storage/no-logging audits, deploy.
- Rowboat storage: `projects/files/versions/conversations/settings` sync per studio plan Task 10; conversation persistence; version writes from `writeModel` and editor saves.
