# Chat Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every jscad-chat conversation in the launcher relay, rebuild conversations from the log, and improve the system prompt and its examples against an eval that fails the way the app fails.

**Architecture:** The launcher relay (`apps/jscad-web/scripts/local/relay.js`) tees each forwarded POST into a dated JSONL file keyed by a browser-sent `x-jscad-chat-id`. `packages/agent-loop` gains a log reader that reuses the provider stream parsers, a pure `buildMessages` context assembler shared by the app and the eval, a prompt assembled from `prompt.md` plus example files loaded as `?raw` text, and an eval backend that runs model code through `@jscadui/require` with the compute frame's transform rule and CDN URL scheme. A project skill, `chat-review`, drives the review loop.

**Tech Stack:** Node 22 (ESM, module loader hooks), plain `node:http`, vitest 4, esbuild plugin API, `@jscadui/require` / `@jscadui/transform-babel` prebuilt `esm/` bundles, `@jscadui/params-core`, `@jscadui/model-tools`.

**Spec:** `docs/superpowers/specs/2026-09-27-chat-feedback-loop-design.md`

## Global Constraints

- Modern browsers only, ES2022+, no polyfills or compat shims.
- Comments: default to none; only a non-obvious why, one or two lines. No history narration.
- Tests are vitest: `npx vitest run <file>` run from inside the package directory.
- Never run the OpenSCAD full suite locally. Never run Playwright e2e locally (it goes through simple-ci).
- Log file: `~/.local/state/jscad-chat/logs/YYYY-MM-DD.jsonl` (UTC date of `ts`), under `$XDG_STATE_HOME` when set. `JSCAD_CHAT_LOG=0` turns logging off, `JSCAD_CHAT_LOG=<dir>` moves it.
- Record fields exactly: `ts`, `chatId`, `kind`, `path`, `status`, `request`, `response`, `ms`. GET requests are not logged. Headers are never logged.
- Header name: `x-jscad-chat-id`. Never forwarded to a provider (not in either relay's allowlist).
- `CONTEXT_BUDGET` = 24,000 characters.
- `EVAL_RUNS` defaults to 5. Keep rule for a prompt change: mean `firstAttemptFailures` drops on the new fixtures and no fixture's mean total score falls by more than 0.5.
- The Meta API key is never printed, logged, or written to results. Do not read `~/.config/muse/auth.json` values yourself; only the eval code reads it.
- Commit after each task. The pre-commit hook runs build, eslint on staged files (`--max-warnings=0`), typecheck and unit tests; let it run, never `--no-verify`. Never push, never open a PR.
- Docs change in the same commit as the code they describe.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Resolved facts the tasks rely on

- The compute frame aliases `@jscad/modeling`, `@jscad/modeling-for-anchors`, `@jscad/modeling-for-manifold`, `@jbroll/jscad-anchors` (CDN `.cjs`), `@jscad/io`, `@jscadui/model-tools`, `@jbroll/jscad-fluent`, `@jscad/csg`, `@jscadui/params-core`, `@jscadui/jscad-text` (`apps/jscad-web/src_frame/frameHost.js` `workerBundles`). Every other bare name resolves to `https://cdn.jsdelivr.net/npm/<name>` (`packages/require/src/resolveUrl.js`), and a subpath such as `@jscad/modeling/primitives` resolves to `https://cdn.jsdelivr.net/npm/@jscad/modeling/primitives.js`, which is not an alias and 404s.
- Frame error text for a missing CDN module: the frame's `fetchText` (`src_frame/fileMap.js`) throws `file not found <url>` on 404, `network error fetching <url>` on status 0, `failed to fetch file <url> <status> <statusText>` otherwise. `require` wraps it as `failed to load module <name>\n  Error: file not found <url>`, and the entry module's loader appends ` / failed loading module http://project.local/main.js`. Verified end to end with the backend design in Task 4.
- The worker transforms the entry only when `url.endsWith('.ts') || script.includes('import') && (importReg.test(script) || exportReg.test(script))` (`packages/worker/worker.js:421-454`). A file with `export const main` and no `import ... from` line is not transformed and fails with `SyntaxError: Unexpected token 'export'`.
- The app's `eval` tool sends only `{ [entry]: source }` to the frame at `http://project.local/<entry>` (`apps/jscad-web/src/aiEvaluate.js`).
- The production relay (`apps/jscad-web/server/src/relay/routes.ts`) forwards only `FORWARD_HEADERS` (content-type, accept, authorization, x-api-key, anthropic-version, anthropic-beta, x-opencode-session), so it drops `x-jscad-chat-id`. Its OPTIONS handler echoes `access-control-request-headers`, so the preflight passes.
- The e2e stub relay (`apps/jscad-web/e2e/ai-chat.spec.js`) answers preflight with `access-control-allow-headers: content-type, authorization`; it must also allow `x-jscad-chat-id`.
- Current project files in the browser: `collectProjectFiles(fileSystem.getSwHandler())` in `apps/jscad-web/main.js` (already imported from `src/projectFiles.js`); `.stl` entries are `ArrayBuffer`.
- Vitest handles `?raw` imports natively (verified), so the agent-loop needs no vitest plugin. Node 22 keeps `?raw` on resolved file URLs, so a `load` hook can serve it (verified).
- `@jscadui/require/esm/index.js` and `@jscadui/transform-babel/esm/transform-babel.js` import cleanly in plain Node; their `src/` entries do not (extensionless imports). Both `esm/` dirs are build outputs (gitignored), built by `turbo build`; declaring them as agent-loop devDependencies makes turbo build them before agent-loop tests (`test` depends on `^build`).
- `~/.config/muse/auth.json` `providers.meta.api_base_url` is `https://api.meta.ai/v1`. The adapters append `/v1/...`, so the eval strips a trailing `/v1`.
- Muse 1.3 contributor's model id is `muse-spark-1.3-contributor` (`RESPONSES_MODELS` in `src/providers.js`); with `kind: 'meta'` it routes to `/v1/responses`.

---

### Task 1: Export the stream parsers and send the chat id header

**Files:**
- Modify: `packages/agent-loop/src/providers.js` (the `anthropicProvider` and `openaiProvider` functions)
- Modify: `packages/agent-loop/src/responses.js` (`responsesProvider`)
- Test: `packages/agent-loop/test/providers.test.js`

**Model:** `sonnet` — a refactor across two files that must move parsing code without changing behavior.

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `parseAnthropicStream(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Event>` and `parseOpenAIStream(body): AsyncGenerator<Event>` from `src/providers.js`; `parseResponsesStream(body): AsyncGenerator<Event>` from `src/responses.js`. `Event` is `{type:'text',text:string} | {type:'tool_use',id:string,name:string,input:object} | {type:'done',stopReason:string}`, exactly what `send` yields today. Parsers throw the same errors `send` throws today.
  - `createProvider(config)` accepts `config.chatId?: string`; when set, every kind sends header `x-jscad-chat-id: <chatId>`. Used by Task 6 and read by the relay in Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-loop/test/providers.test.js`, and change its import line to:

```js
import { createProvider, parseAnthropicStream, parseOpenAIStream } from '../src/providers.js'
import { parseResponsesStream } from '../src/responses.js'
```

```js
const collect = async (iterable) => {
  const out = []
  for await (const event of iterable) out.push(event)
  return out
}

describe('stream parsers', () => {
  it('anthropic: parses a recorded body without fetch', async () => {
    expect(await collect(parseAnthropicStream(sseBody(anthropicToolUse)))).toEqual([
      { type: 'tool_use', id: 'toolu_01', name: 'measure', input: { target: 'part1' } },
      { type: 'done', stopReason: 'tool_use' },
    ])
  })

  it('openai: parses a recorded body without fetch', async () => {
    const body =
      `data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n` +
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"measure","arguments":"{\\"target\\":\\"p\\"}"}}]}}]}\n\n` +
      `data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n` +
      `data: [DONE]\n\n`
    expect(await collect(parseOpenAIStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'p' } },
      { type: 'done', stopReason: 'tool_calls' },
    ])
  })

  it('responses: parses a recorded body without fetch', async () => {
    const body =
      `data: {"type":"response.output_text.delta","delta":"Hi"}\n\n` +
      `data: {"type":"response.output_item.added","item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"measure"}}\n\n` +
      `data: {"type":"response.function_call_arguments.delta","item_id":"item_1","delta":"{\\"target\\":\\"p\\"}"}\n\n` +
      `data: {"type":"response.completed"}\n\n`
    expect(await collect(parseResponsesStream(sseBody(body)))).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_use', id: 'call_1', name: 'measure', input: { target: 'p' } },
      { type: 'done', stopReason: 'completed' },
    ])
  })
})

describe('chat id header', () => {
  it.each([
    ['anthropic', 'm'],
    ['openai', 'm'],
    ['meta', 'muse-spark-1.3'],
  ])('%s sends x-jscad-chat-id when chatId is set', async (kind, model) => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind, apiKey: 'k', model, baseUrl: 'https://relay.test', chatId: 'chat-1' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) void e
    expect(fetchMock.mock.calls[0][1].headers['x-jscad-chat-id']).toBe('chat-1')
  })

  it('omits x-jscad-chat-id without a chatId', async () => {
    fetchMock.mockResolvedValue(new Response(sseBody('')))
    const provider = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
    for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) void e
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-jscad-chat-id')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run test/providers.test.js`
Expected: FAIL — `parseAnthropicStream is not a function` (and the header tests fail on `undefined`).

- [ ] **Step 3: Move the parsing loops into exported parsers**

In `src/providers.js`, replace `anthropicProvider` and `openaiProvider` with the following (the helpers `ssePayloads`, `toAnthropicMessage`, `toAnthropicTool`, `toOpenAIMessage`, `toOpenAITool` and `createProvider` stay as they are):

```js
export async function* parseAnthropicStream(body) {
  // Tool input JSON arrives split across input_json_delta events; hold it per block until stop.
  const toolInputs = new Map()
  for await (const payload of ssePayloads(body)) {
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
}

const anthropicProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const body = {
        model: config.model,
        max_tokens: 4096,
        stream: true,
        messages: messages.filter((m) => m.role !== 'system').map(toAnthropicMessage),
      }
      if (system) body.system = system
      if (tools.length > 0) body.tools = tools.map(toAnthropicTool)
      if (config.effort) body.output_config = { effort: config.effort }
      const headers = {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind] ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`anthropic: ${detail} (status ${res.status})`)
      }
      yield* parseAnthropicStream(res.body)
    },
  }
}
```

```js
export async function* parseOpenAIStream(body) {
  // Function arguments arrive split across chunks; hold each tool call by index until done.
  const toolCalls = new Map()
  let stopReason = ''
  for await (const payload of ssePayloads(body)) {
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
}

const openaiProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const body = {
        model: config.model,
        stream: true,
        messages: messages.map(toOpenAIMessage),
      }
      if (tools.length > 0) body.tools = tools.map(toOpenAITool)
      if (config.effort) body.reasoning_effort = config.effort
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`openai: ${detail} (status ${res.status})`)
      }
      yield* parseOpenAIStream(res.body)
    },
  }
}
```

Update the `createProvider` JSDoc config type to include `chatId?:string`.

In `src/responses.js`, replace `responsesProvider` with:

```js
export async function* parseResponsesStream(body) {
  const calls = new Map()
  for await (const payload of ssePayloads(body)) {
    let event
    try {
      event = JSON.parse(payload)
    } catch {
      continue
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      yield { type: 'text', text: event.delta }
    } else if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      calls.set(event.item.id, { id: event.item.call_id ?? event.item.id, name: event.item.name ?? '', args: '' })
    } else if (event.type === 'response.function_call_arguments.delta') {
      const acc = calls.get(event.item_id) ?? { id: event.item_id, name: '', args: '' }
      acc.args += event.delta ?? ''
      calls.set(event.item_id, acc)
    } else if (event.type === 'response.completed') {
      break
    } else if (event.type === 'response.failed') {
      throw new Error(`responses: ${event.response?.error?.message ?? 'response failed'}`)
    } else if (event.type === 'response.incomplete') {
      throw new Error(`responses: incomplete (${event.response?.incomplete_details?.reason ?? 'unknown reason'})`)
    } else if (event.type === 'error') {
      throw new Error(`responses: ${event.message ?? 'provider error'}`)
    }
  }
  for (const acc of calls.values()) {
    let input
    try {
      input = JSON.parse(acc.args || '{}')
    } catch {
      throw new Error(`responses: unparseable tool arguments for ${acc.name}`)
    }
    yield { type: 'tool_use', id: acc.id, name: acc.name, input }
  }
  yield { type: 'done', stopReason: 'completed' }
}

export const responsesProvider = (config) => {
  const sessionId = config.sessionId ?? crypto.randomUUID()
  return {
    async *send(messages, tools) {
      const body = {
        model: config.model,
        stream: true,
        input: toResponsesInput(messages),
      }
      if (tools.length > 0) body.tools = tools.map(toResponsesTool)
      if (config.effort) body.reasoning = { effort: config.effort }
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      }
      if (config.kind === 'opencode-go') headers['x-opencode-session'] = sessionId
      if (config.chatId) headers['x-jscad-chat-id'] = config.chatId
      const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.text()
        throw new Error(`responses: ${detail} (status ${res.status})`)
      }
      yield* parseResponsesStream(res.body)
    },
  }
}
```

- [ ] **Step 4: Run the package tests**

Run (in `packages/agent-loop`): `npx vitest run`
Expected: PASS, every file, including the pre-existing provider tests (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/src/responses.js packages/agent-loop/test/providers.test.js
git commit -m "$(cat <<'EOF'
refactor(agent-loop): export stream parsers, send x-jscad-chat-id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Relay chat log

**Files:**
- Create: `packages/agent-loop/log/log-dir.js`
- Test: `packages/agent-loop/log/log-dir.test.js`
- Modify: `packages/agent-loop/package.json` (`files`)
- Create: `apps/jscad-web/scripts/local/chatLog.js`
- Test: `apps/jscad-web/scripts/local/chatLog.test.js`
- Modify: `apps/jscad-web/scripts/local/relay.js`
- Test: `apps/jscad-web/scripts/local/relay.test.js`
- Modify: `apps/jscad-web/scripts/jscad.mjs:47-54`
- Modify: `apps/jscad-web/README.md` ("Local model directory")
- Modify: `apps/jscad-web/docs/architecture.md` (Agent loop, relay paragraph)

**Model:** `sonnet` — relay stream tee plus launcher wiring across two packages.

**Interfaces:**
- Consumes: nothing from Task 1 at runtime (the header name `x-jscad-chat-id`).
- Produces:
  - `chatLogDir(env = process.env, home = homedir()): string | null` in `packages/agent-loop/log/log-dir.js`. Used by Task 3's CLI and by the launcher.
  - `createChatLog(dir: string, { warn = console.warn } = {}): { write(record): void }` and `toLogRequest(buf: Buffer): unknown` in `apps/jscad-web/scripts/local/chatLog.js`.
  - `createRelayHandler({ allowlist, trustedOrigins, allowPrivateUpstream = false, log = null })`; `log.write` receives `{ ts, chatId, kind, path, status, request, response, ms }`.

- [ ] **Step 1: Write the failing tests**

`packages/agent-loop/log/log-dir.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { chatLogDir } from './log-dir.js'

describe('chatLogDir', () => {
  it('defaults under ~/.local/state', () => {
    expect(chatLogDir({}, '/home/u')).toBe('/home/u/.local/state/jscad-chat/logs')
  })
  it('uses XDG_STATE_HOME when set', () => {
    expect(chatLogDir({ XDG_STATE_HOME: '/state' }, '/home/u')).toBe('/state/jscad-chat/logs')
  })
  it('JSCAD_CHAT_LOG=0 turns logging off', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '0' }, '/home/u')).toBeNull()
  })
  it('JSCAD_CHAT_LOG=<dir> moves it', () => {
    expect(chatLogDir({ JSCAD_CHAT_LOG: '/tmp/logs', XDG_STATE_HOME: '/state' }, '/home/u')).toBe('/tmp/logs')
  })
})
```

`apps/jscad-web/scripts/local/chatLog.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatLog, toLogRequest } from './chatLog.js'

const record = (ts) => ({ ts, chatId: 'c', kind: 'openai', path: 'v1/chat/completions', status: 200, request: {}, response: 'x', ms: 1 })

describe('chat log', () => {
  it('appends one JSON line per record to a file named by the UTC date, creating the dir', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'chatlog-')), 'logs')
    const log = createChatLog(dir)
    log.write(record('2026-09-27T10:00:00.000Z'))
    log.write(record('2026-09-27T11:00:00.000Z'))
    const lines = readFileSync(join(dir, '2026-09-27.jsonl'), 'utf8').trim().split('\n')
    expect(lines.map((l) => JSON.parse(l).ts)).toEqual(['2026-09-27T10:00:00.000Z', '2026-09-27T11:00:00.000Z'])
  })

  it('warns once and never throws when the dir cannot be created', () => {
    const base = mkdtempSync(join(tmpdir(), 'chatlog-'))
    writeFileSync(join(base, 'file'), '')
    const warn = vi.fn()
    const log = createChatLog(join(base, 'file', 'logs'), { warn })
    expect(() => log.write(record('2026-09-27T10:00:00.000Z'))).not.toThrow()
    log.write(record('2026-09-27T10:00:01.000Z'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('drops tools from a JSON body and keeps an unparseable body as text', () => {
    expect(toLogRequest(Buffer.from(JSON.stringify({ model: 'm', tools: [{ name: 'eval' }] })))).toEqual({ model: 'm' })
    expect(toLogRequest(Buffer.from('not json'))).toBe('not json')
  })
})
```

In `apps/jscad-web/scripts/local/relay.test.js`, replace `withServers` with this version (it records upstream headers and takes handler options; existing tests keep working):

```js
const withServers = async (t, options = {}) => {
  const seen = []
  const upstream = http.createServer((req, res) => {
    seen.push(req.headers)
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`echo:${req.url}:${b}`)
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const port = upstream.address().port
  const handler = createRelayHandler({
    allowlist: { test: `http://127.0.0.1:${port}` },
    trustedOrigins: ['http://app.test'],
    allowPrivateUpstream: true,
    ...options,
  })
  const front = http.createServer((req, res) => {
    handler(req, res).then((handled) => {
      if (!handled) { res.writeHead(404); res.end() }
    })
  })
  await new Promise((r) => front.listen(0, '127.0.0.1', r))
  try {
    await t(`http://127.0.0.1:${front.address().port}`, seen)
  } finally {
    front.close(); upstream.close()
  }
}
```

and append:

```js
describe('relay log', () => {
  const post = (base, headers) =>
    fetch(`${base}/api/relay/test/v1/chat/completions`, {
      method: 'POST',
      headers: { origin: 'http://app.test', 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'eval' }] }),
    })

  it('logs a POST with its chat id and response, without tools or headers, and does not forward the id', async () => {
    const records = []
    await withServers(async (base, seen) => {
      const res = await post(base, { authorization: 'Bearer sk-secret', 'x-jscad-chat-id': 'chat-1' })
      expect(await res.text()).toContain('echo:/v1/chat/completions:')
      expect(seen[0]['x-jscad-chat-id']).toBeUndefined()
    }, { log: { write: (r) => records.push(r) } })
    expect(records).toHaveLength(1)
    const [r] = records
    expect(r).toMatchObject({
      chatId: 'chat-1',
      kind: 'test',
      path: 'v1/chat/completions',
      status: 200,
      request: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(r.request).not.toHaveProperty('tools')
    expect(r.response).toContain('echo:/v1/chat/completions:')
    expect(Number.isNaN(Date.parse(r.ts))).toBe(false)
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(r)).not.toContain('sk-secret')
    expect(Object.keys(r).sort()).toEqual(['chatId', 'kind', 'ms', 'path', 'request', 'response', 'status', 'ts'])
  })

  it('records a null chatId when the header is missing', async () => {
    const records = []
    await withServers(async (base) => {
      await (await post(base, {})).text()
    }, { log: { write: (r) => records.push(r) } })
    expect(records[0].chatId).toBeNull()
  })

  it('does not log a GET', async () => {
    const records = []
    await withServers(async (base) => {
      await (await fetch(`${base}/api/relay/test/v1/models`, { headers: { origin: 'http://app.test' } })).text()
    }, { log: { write: (r) => records.push(r) } })
    expect(records).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run log/log-dir.test.js`
Expected: FAIL — cannot find `./log-dir.js`.
Run (in `apps/jscad-web`): `npx vitest run scripts/local/chatLog.test.js scripts/local/relay.test.js`
Expected: FAIL — cannot find `./chatLog.js`; the relay log tests fail with `records` empty.

- [ ] **Step 3: Implement**

`packages/agent-loop/log/log-dir.js`:

```js
import { homedir } from 'node:os'
import { join } from 'node:path'

export const chatLogDir = (env = process.env, home = homedir()) => {
  const setting = env.JSCAD_CHAT_LOG
  if (setting === '0') return null
  if (setting) return setting
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'jscad-chat', 'logs')
}
```

In `packages/agent-loop/package.json`, set `"files": ["index.js", "src", "prompt.md", "log"]`.

`apps/jscad-web/scripts/local/chatLog.js`:

```js
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const toLogRequest = (buf) => {
  const text = buf.toString('utf8')
  try {
    const body = JSON.parse(text)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    const { tools: _tools, ...rest } = body
    return rest
  } catch {
    return text
  }
}

export const createChatLog = (dir, { warn = console.warn } = {}) => {
  let warned = false
  return {
    write(record) {
      try {
        mkdirSync(dir, { recursive: true })
        appendFileSync(join(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`)
      } catch (err) {
        if (warned) return
        warned = true
        warn(`jscad: chat log write failed (${err.message}); continuing without it`)
      }
    },
  }
}
```

In `apps/jscad-web/scripts/local/relay.js`:
- Change the header comment's "stores nothing" to "stores nothing except the optional chat log".
- Add `import { toLogRequest } from './chatLog.js'`.
- Change the signature to `export const createRelayHandler = ({ allowlist, trustedOrigins, allowPrivateUpstream = false, log = null }) => {`.
- Directly after the `if (!m || ...) return false` line add:

```js
    const ts = new Date().toISOString()
    const started = Date.now()
```

- Replace everything from `const chunks = []` to the end of the returned handler with:

```js
    const chunks = []
    for await (const c of req) chunks.push(c)
    const logging = log !== null && req.method === 'POST'
    const chatId = req.headers['x-jscad-chat-id']
    const record = (status, response) => log.write({
      ts,
      chatId: typeof chatId === 'string' ? chatId : null,
      kind: m[1],
      path: sub,
      status,
      request: toLogRequest(Buffer.concat(chunks)),
      response,
      ms: Date.now() - started,
    })
    let up
    try {
      up = await fetch(upstream, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'upstream unreachable' }))
      if (logging) record(502, 'upstream unreachable')
      return true
    }
    res.writeHead(up.status, {
      ...(up.headers.get('content-type') ? { 'content-type': up.headers.get('content-type') } : {}),
      'cache-control': 'no-cache',
      ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    })
    const decoder = new TextDecoder()
    let text = ''
    if (up.body) {
      for await (const c of up.body) {
        res.write(c)
        if (logging) text += decoder.decode(c, { stream: true })
      }
    }
    res.end()
    if (logging) record(up.status, text + decoder.decode())
    return true
  }
}
```

`FORWARD` stays unchanged; `x-jscad-chat-id` must not be added to it.

In `apps/jscad-web/scripts/jscad.mjs`, add the imports

```js
import { chatLogDir } from '@jscadui/agent-loop/log/log-dir.js'
import { createChatLog } from './local/chatLog.js'
```

and replace the `relayHandler` line and the final `console.log` with:

```js
const logDir = chatLogDir()
const relayHandler = createRelayHandler({ allowlist, trustedOrigins: [origin], log: logDir ? createChatLog(logDir) : null })
```

```js
console.log(`jscad: ${modelDir} → ${page}  (frame :${port + 1})`)
console.log(logDir ? `jscad: chat log → ${logDir}` : 'jscad: chat log off (JSCAD_CHAT_LOG=0)')
```

- [ ] **Step 4: Update the docs**

In `apps/jscad-web/README.md`, after the "Local model directory" paragraph that ends with the default allowlist, add:

```markdown
The launcher's relay logs each chat request to `~/.local/state/jscad-chat/logs/YYYY-MM-DD.jsonl` (UTC date; under `$XDG_STATE_HOME` when set): time, chat id, provider, path, status, the request body without its tool list, the response and the elapsed time. Headers, and so API keys, are never written. `JSCAD_CHAT_LOG=<dir>` moves the log, `JSCAD_CHAT_LOG=0` turns it off. `npm run read-log -w @jscadui/agent-loop` prints the logged conversations.
```

In `apps/jscad-web/docs/architecture.md`, Agent loop section, after the sentence ending "so the session cookie never reaches a provider." add:

```markdown
The `jscad-chat` launcher's relay (`scripts/local/relay.js`) also appends each
forwarded POST to `~/.local/state/jscad-chat/logs/YYYY-MM-DD.jsonl`
(`$XDG_STATE_HOME` when set; `JSCAD_CHAT_LOG=<dir>` moves it, `=0` turns it
off): time, the `x-jscad-chat-id` header the chat sends, provider kind,
sub-path, status, the request body without `tools`, the response text and the
elapsed ms. Headers are never written. The response is teed while it streams,
and a failed write warns once without failing the request. Neither relay
forwards `x-jscad-chat-id`, and the production relay does not log.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `packages/agent-loop`): `npx vitest run log/log-dir.test.js`
Expected: PASS (4 tests).
Run (in `apps/jscad-web`): `npx vitest run scripts/local/`
Expected: PASS, including the four pre-existing relay tests and `server.test.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/log/log-dir.js packages/agent-loop/log/log-dir.test.js packages/agent-loop/package.json apps/jscad-web/scripts/local/chatLog.js apps/jscad-web/scripts/local/chatLog.test.js apps/jscad-web/scripts/local/relay.js apps/jscad-web/scripts/local/relay.test.js apps/jscad-web/scripts/jscad.mjs apps/jscad-web/README.md apps/jscad-web/docs/architecture.md
git commit -m "$(cat <<'EOF'
feat(jscad-web): log launcher relay chat requests to JSONL

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Log reader

**Files:**
- Create: `packages/agent-loop/log/wire.js`
- Create: `packages/agent-loop/log/read-log.js`
- Test: `packages/agent-loop/log/read-log.test.js`
- Modify: `packages/agent-loop/package.json` (`scripts`)
- Create: `packages/agent-loop/README.md`

**Model:** `sonnet` — three wire formats and turn grouping.

**Interfaces:**
- Consumes: `parseAnthropicStream`, `parseOpenAIStream` (`src/providers.js`), `parseResponsesStream` (`src/responses.js`) from Task 1; `chatLogDir()` from Task 2; the record shape from Task 2.
- Produces:
  - `protocolOf(path: string): 'anthropic'|'openai'|'responses'|null`, `requestMessages(record): Message[]`, `responseMessage(record): Promise<{ message?: Message, error?: string }>` in `log/wire.js`. `Message` is the loop's shape: `{role:'system'|'user',content}`, `{role:'assistant',content:string|null,toolCalls:[{id,name,input}]}`, `{role:'tool',toolCallId,content}`.
  - `readConversations(dir: string, { since?: string } = {}): Promise<Array<{ chatId: string|null, model: string|null, turns: Array<{ ts: string, user: string|null, steps: Array<{ name, input, result: string|null, ok: boolean|null, error?: string }>, final: string|null, error?: string }> }>>` and `formatConversations(conversations): string` in `log/read-log.js`. Used by the `chat-review` skill (Task 8).

- [ ] **Step 1: Write the failing tests**

`packages/agent-loop/log/read-log.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatConversations, readConversations } from './read-log.js'

const sse = (...events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')
const openaiCall = (id, name, args) =>
  sse({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, '[DONE]')
const openaiText = (text) => sse({ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]')
const anthropicText = (text) =>
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } })
const responsesCall = (callId, name, args) =>
  sse(
    { type: 'response.output_item.added', item: { id: 'item_1', type: 'function_call', call_id: callId, name } },
    { type: 'response.function_call_arguments.delta', item_id: 'item_1', delta: JSON.stringify(args) },
    { type: 'response.completed' },
  )

const rec = (ts, chatId, path, request, response, status = 200) => ({ ts, chatId, kind: 'k', path, status, request, response, ms: 5 })
const sys = { role: 'system', content: 'S' }
const ask = { role: 'user', content: 'A single sphere' }
const call = (id, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const result = (id, body) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(body) })
const bad = { source: "import { sphere } from '@jscad/primitives'" }
const good = { source: "const { primitives } = require('@jscad/modeling')" }
const fail = { ok: false, error: { name: 'Error', message: 'failed to load module @jscad/primitives' } }
const OAI = 'v1/chat/completions'

const writeLog = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'readlog-'))
  for (const [name, records] of Object.entries(files)) {
    writeFileSync(join(dir, name), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  }
  return dir
}

const openaiChat = [
  rec('2026-09-27T10:00:00.000Z', 'chat-1', OAI, { model: 'm', messages: [sys, ask] }, openaiCall('c1', 'eval', bad)),
  rec('2026-09-27T10:00:01.000Z', 'chat-1', OAI, { model: 'm', messages: [sys, ask, call('c1', 'eval', bad), result('c1', fail)] }, openaiCall('c2', 'eval', good)),
  rec(
    '2026-09-27T10:00:02.000Z',
    'chat-1',
    OAI,
    { model: 'm', messages: [sys, ask, call('c1', 'eval', bad), result('c1', fail), call('c2', 'eval', good), result('c2', { entityCount: 1 })] },
    openaiText('Here is a sphere.'),
  ),
  rec(
    '2026-09-27T10:01:00.000Z',
    'chat-1',
    OAI,
    { model: 'm', messages: [sys, ask, { role: 'assistant', content: 'Here is a sphere.' }, { role: 'user', content: 'Make it bigger' }] },
    openaiText('Done.'),
  ),
]

describe('readConversations', () => {
  it('rebuilds an openai conversation into turns with failed and good steps', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': openaiChat })
    const [conversation] = await readConversations(dir)
    expect(conversation.chatId).toBe('chat-1')
    expect(conversation.model).toBe('m')
    expect(conversation.turns).toEqual([
      {
        ts: '2026-09-27T10:00:00.000Z',
        user: 'A single sphere',
        steps: [
          { name: 'eval', input: bad, result: JSON.stringify(fail), ok: false, error: 'failed to load module @jscad/primitives' },
          { name: 'eval', input: good, result: JSON.stringify({ entityCount: 1 }), ok: true },
        ],
        final: 'Here is a sphere.',
      },
      { ts: '2026-09-27T10:01:00.000Z', user: 'Make it bigger', steps: [], final: 'Done.' },
    ])
  })

  it('reads anthropic tool results out of user blocks', async () => {
    const request = {
      model: 'claude',
      system: 'S',
      messages: [
        { role: 'user', content: 'A cube' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'eval', input: { source: 'x' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":false,"error":{"message":"boom"}}' }] },
      ],
    }
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'chat-2', 'v1/messages', request, anthropicText('Sorry.'))] })
    const [conversation] = await readConversations(dir)
    expect(conversation.turns[0]).toMatchObject({ user: 'A cube', final: 'Sorry.', steps: [{ name: 'eval', ok: false, error: 'boom' }] })
  })

  it('gives each record without a chat id its own conversation, with an unanswered call', async () => {
    const request = { model: 'muse', input: [{ role: 'system', content: 'S' }, { role: 'user', content: 'A sphere' }] }
    const dir = writeLog({
      '2026-09-27.jsonl': [
        rec('2026-09-27T10:00:00.000Z', null, 'v1/responses', request, responsesCall('r1', 'eval', { source: 'y' })),
        rec('2026-09-27T10:00:05.000Z', null, 'v1/responses', request, responsesCall('r2', 'eval', { source: 'z' })),
      ],
    })
    const conversations = await readConversations(dir)
    expect(conversations).toHaveLength(2)
    expect(conversations[0].chatId).toBeNull()
    expect(conversations[0].turns[0]).toEqual({
      ts: '2026-09-27T10:00:00.000Z',
      user: 'A sphere',
      steps: [{ name: 'eval', input: { source: 'y' }, result: null, ok: null }],
      final: null,
    })
  })

  it('keeps an HTTP failure as the turn error', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': [rec('2026-09-27T10:00:00.000Z', 'c', OAI, { model: 'm', messages: [sys, ask] }, '{"error":"bad key"}', 401)] })
    const [conversation] = await readConversations(dir)
    expect(conversation.turns[0]).toMatchObject({ user: 'A single sphere', final: null, error: '{"error":"bad key"}' })
  })

  it('reads only records at or after since, across files', async () => {
    const dir = writeLog({
      '2026-09-26.jsonl': [rec('2026-09-26T10:00:00.000Z', 'old', OAI, { model: 'm', messages: [sys, ask] }, openaiText('a'))],
      '2026-09-27.jsonl': openaiChat,
    })
    const conversations = await readConversations(dir, { since: '2026-09-27T00:00:00Z' })
    expect(conversations.map((c) => c.chatId)).toEqual(['chat-1'])
  })

  it('returns nothing for a missing dir', async () => {
    expect(await readConversations(join(tmpdir(), 'no-such-chat-log-dir'))).toEqual([])
  })
})

describe('formatConversations', () => {
  it('prints each failed call with its error and source', async () => {
    const dir = writeLog({ '2026-09-27.jsonl': openaiChat })
    const text = formatConversations(await readConversations(dir))
    expect(text).toContain('== chat-1')
    expect(text).toContain('> A single sphere')
    expect(text).toContain('eval FAILED')
    expect(text).toContain('error: failed to load module @jscad/primitives')
    expect(text).toContain("| import { sphere } from '@jscad/primitives'")
    expect(text).toContain('< Here is a sphere.')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run log/read-log.test.js`
Expected: FAIL — cannot find `./read-log.js`.

- [ ] **Step 3: Implement**

`packages/agent-loop/log/wire.js`:

```js
import { parseAnthropicStream, parseOpenAIStream } from '../src/providers.js'
import { parseResponsesStream } from '../src/responses.js'

const parseArgs = (text) => {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return { unparsed: text }
  }
}

const blocksText = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')

const fromAnthropic = (request) => {
  const out = []
  if (request.system) out.push({ role: 'system', content: typeof request.system === 'string' ? request.system : blocksText(request.system) })
  for (const m of request.messages ?? []) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'assistant' ? { role: 'assistant', content: m.content, toolCalls: [] } : { role: m.role, content: m.content })
    } else if (m.role === 'assistant') {
      const toolCalls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
      out.push({ role: 'assistant', content: blocksText(m.content) || null, toolCalls })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', toolCallId: b.tool_use_id, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) })
        } else if (b.type === 'text') {
          out.push({ role: 'user', content: b.text })
        }
      }
    }
  }
  return out
}

const fromOpenAI = (request) =>
  (request.messages ?? []).map((m) => {
    if (m.role === 'tool') return { role: 'tool', toolCallId: m.tool_call_id, content: m.content }
    if (m.role === 'assistant') {
      const toolCalls = (m.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }))
      return { role: 'assistant', content: m.content ?? null, toolCalls }
    }
    return { role: m.role, content: m.content }
  })

const fromResponses = (request) => {
  const out = []
  for (const item of request.input ?? []) {
    if (item.type === 'function_call_output') {
      out.push({ role: 'tool', toolCallId: item.call_id, content: item.output })
    } else if (item.type === 'function_call') {
      const call = { id: item.call_id, name: item.name, input: parseArgs(item.arguments) }
      const last = out.at(-1)
      if (last?.role === 'assistant') last.toolCalls.push(call)
      else out.push({ role: 'assistant', content: null, toolCalls: [call] })
    } else if (item.role === 'assistant') {
      out.push({ role: 'assistant', content: item.content, toolCalls: [] })
    } else {
      out.push({ role: item.role, content: item.content })
    }
  }
  return out
}

export const protocolOf = (path) => {
  if (path.endsWith('v1/messages')) return 'anthropic'
  if (path.endsWith('v1/chat/completions')) return 'openai'
  if (path.endsWith('v1/responses')) return 'responses'
  return null
}

const READERS = { anthropic: fromAnthropic, openai: fromOpenAI, responses: fromResponses }
const PARSERS = { anthropic: parseAnthropicStream, openai: parseOpenAIStream, responses: parseResponsesStream }

export const requestMessages = (record) => READERS[protocolOf(record.path)]?.(record.request) ?? []

export const responseMessage = async (record) => {
  const parse = PARSERS[protocolOf(record.path)]
  if (!parse || record.status >= 400) return { error: record.response }
  const text = []
  const toolCalls = []
  try {
    for await (const event of parse(new Response(record.response).body)) {
      if (event.type === 'text') text.push(event.text)
      else if (event.type === 'tool_use') toolCalls.push({ id: event.id, name: event.name, input: event.input })
    }
  } catch (err) {
    return { error: err.message }
  }
  return { message: { role: 'assistant', content: text.join('') || null, toolCalls } }
}
```

`packages/agent-loop/log/read-log.js`:

```js
// Usage: node log/read-log.js [--since ISO] [--json]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chatLogDir } from './log-dir.js'
import { requestMessages, responseMessage } from './wire.js'

const listLogFiles = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
  } catch {
    return []
  }
}

const readRecords = (dir, since) => {
  const records = []
  for (const file of listLogFiles(dir)) {
    if (since && file.slice(0, 10) < since.slice(0, 10)) continue
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line))
      } catch {
        // a line cut short by a crash mid-write
      }
    }
  }
  return records
    .filter((r) => r.request !== null && typeof r.request === 'object' && (!since || r.ts >= since))
    .sort((a, b) => a.ts.localeCompare(b.ts))
}

const isUserText = (m) => m?.role === 'user' && typeof m.content === 'string'

const failureOf = (content) => {
  try {
    const parsed = JSON.parse(content)
    return parsed?.ok === false ? (parsed.error?.message ?? 'failed') : null
  } catch {
    return null
  }
}

const stepsOf = (messages) => {
  const results = new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m.content]))
  return messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.toolCalls ?? [])
    .map((call) => {
      const result = results.get(call.id) ?? null
      const error = result === null ? null : failureOf(result)
      return { name: call.name, input: call.input, result, ok: result === null ? null : error === null, ...(error === null ? {} : { error }) }
    })
}

const buildTurn = async (records) => {
  const last = records.at(-1)
  const response = await responseMessage(last)
  const messages = [...requestMessages(last), ...(response.message ? [response.message] : [])]
  const at = messages.findLastIndex(isUserText)
  return {
    ts: records[0].ts,
    user: at === -1 ? null : messages[at].content,
    steps: stepsOf(messages.slice(at + 1)),
    final: response.message?.content ?? null,
    ...(response.error === undefined ? {} : { error: response.error }),
  }
}

// A request whose last message is the user's own text opens a turn; tool rounds continue it.
const turnsOf = async (records) => {
  const turns = []
  let current = []
  for (const record of records) {
    if (current.length > 0 && isUserText(requestMessages(record).at(-1))) {
      turns.push(await buildTurn(current))
      current = []
    }
    current.push(record)
  }
  if (current.length > 0) turns.push(await buildTurn(current))
  return turns
}

export const readConversations = async (dir, { since } = {}) => {
  const records = readRecords(dir, since && new Date(since).toISOString())
  const groups = new Map()
  for (const record of records) {
    const key = record.chatId ?? Symbol('no chat id')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  const conversations = []
  for (const [key, list] of groups) {
    conversations.push({ chatId: typeof key === 'string' ? key : null, model: list[0].request.model ?? null, turns: await turnsOf(list) })
  }
  return conversations
}

const clip = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text)

export const formatConversations = (conversations) => {
  const lines = []
  for (const c of conversations) {
    lines.push(`== ${c.chatId ?? '(no chat id)'}  ${c.model ?? ''}  ${c.turns[0]?.ts ?? ''}`)
    for (const turn of c.turns) {
      lines.push(`  > ${clip(turn.user ?? '', 200)}`)
      for (const step of turn.steps) {
        lines.push(`    ${step.name} ${step.ok === false ? 'FAILED' : step.ok === null ? 'no result' : 'ok'}`)
        if (step.ok !== false) continue
        lines.push(`      error: ${step.error}`)
        if (typeof step.input?.source === 'string') {
          for (const line of step.input.source.split('\n')) lines.push(`      | ${line}`)
        }
      }
      if (turn.error) lines.push(`  ! ${clip(turn.error, 300)}`)
      if (turn.final) lines.push(`  < ${clip(turn.final, 200)}`)
    }
  }
  return lines.join('\n')
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--since')
  const dir = chatLogDir()
  if (!dir) {
    console.error('read-log: JSCAD_CHAT_LOG=0, logging is off')
    process.exit(1)
  }
  const conversations = await readConversations(dir, { since: at === -1 ? undefined : args[at + 1] })
  console.log(args.includes('--json') ? JSON.stringify(conversations, null, 2) : formatConversations(conversations))
}
```

In `packages/agent-loop/package.json` `scripts`, add `"read-log": "node log/read-log.js"`.

- [ ] **Step 4: Write the package README**

Create `packages/agent-loop/README.md`:

````markdown
# @jscadui/agent-loop

The browser-local agent loop behind jscad-web's AI Chat: provider adapters
for Anthropic Messages, OpenAI chat completions and the OpenAI Responses API,
the tool list, and the system prompt. It also holds the tools that improve
the prompt from real sessions: a reader for the launcher's chat log and a
live eval.

```js
import { createProvider, runTurn, SYSTEM_PROMPT } from '@jscadui/agent-loop'
```

## Chat log reader

The `jscad-chat` launcher's relay logs each chat request as one JSONL line
(see `apps/jscad-web/README.md`). The reader groups the lines by chat id,
splits them into turns, and parses each response with the adapters' own
stream parsers.

```bash
npm run read-log -w @jscadui/agent-loop -- --since 2026-09-27T00:00:00Z
npm run read-log -w @jscadui/agent-loop -- --json
```

The summary prints one block per conversation: each user message, each tool
call as `ok`, `FAILED` or `no result`, the error message and source of each
failed call, and the final assistant text. `readConversations(dir, { since })`
in `log/read-log.js` returns
`[{ chatId, model, turns: [{ ts, user, steps: [{ name, input, result, ok, error? }], final, error? }] }]`.
It reads the directory the launcher writes (`JSCAD_CHAT_LOG` when set).
````

- [ ] **Step 5: Run the tests to verify they pass**

Run (in `packages/agent-loop`): `npx vitest run log/`
Expected: PASS (log-dir 4, read-log 7).

- [ ] **Step 6: Commit**

```bash
git add packages/agent-loop/log/wire.js packages/agent-loop/log/read-log.js packages/agent-loop/log/read-log.test.js packages/agent-loop/package.json packages/agent-loop/README.md
git commit -m "$(cat <<'EOF'
feat(agent-loop): rebuild conversations from the chat log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Eval backend runs models the way the frame does

**Files:**
- Modify: `packages/agent-loop/eval/backend.js` (full rewrite)
- Test: `packages/agent-loop/eval/backend.test.js`
- Modify: `packages/agent-loop/package.json` (`devDependencies`)
- Create: `packages/agent-loop/turbo.json`
- Modify: `package-lock.json` (only with the user's yes, see Step 5)

**Model:** `sonnet` — runtime integration with `@jscadui/require` and a lockfile decision.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all from `eval/backend.js`):
  - `createEvalBackend(): { requestTool(name: string, input: object): Promise<string>, reset(): void, project: Map<string,{source,message}>, params(): ParamDefinition[] }`. `eval` answers `{"ok":true,"params":[...],"entities":n}`; failures answer `{"ok":false,"error":{"name","message"}}`.
  - `createReadFile(files: Record<string,string>): (path: string) => string`
  - `shouldTransform(url: string, script: string): boolean`, `IMPORT_REG`, `EXPORT_REG`, `PROJECT_BASE = 'http://project.local/'`, `CDN_BASE = 'https://cdn.jsdelivr.net/npm/'`.
  - Used by Task 5 (examples must evaluate) and Task 7 (`params()` feeds fixture checks).

- [ ] **Step 1: Write the failing tests**

Replace `packages/agent-loop/eval/backend.test.js` with:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEvalBackend, createReadFile, EXPORT_REG, IMPORT_REG } from './backend.js'

const CUBE = `const jf = require('@jbroll/jscad-fluent')
function main() { return [jf.cube({ size: 20 })] }
module.exports = { main }`

const ESM_SPHERE = `import { primitives } from '@jscad/modeling'
export const main = (params) => {
  params.radius = { type: 'slider', default: 5, min: 1, max: 10 }
  return primitives.sphere({ radius: params.radius })
}`

const evalSource = async (source) => JSON.parse(await createEvalBackend().requestTool('eval', { source }))

describe('eval backend', () => {
  it('evals fluent source and measures real volume', async () => {
    const backend = createEvalBackend()
    const evalRes = JSON.parse(await backend.requestTool('eval', { source: CUBE }))
    expect(evalRes.ok).toBe(true)
    expect(evalRes.entities).toBe(1)
    const measureRes = JSON.parse(await backend.requestTool('measure', {}))
    expect(measureRes.volume).toBeGreaterThan(7900)
    expect(measureRes.volume).toBeLessThan(8100)
  })

  it('runs an ES module that imports @jscad/modeling and reports its slider', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('eval', { source: ESM_SPHERE }))
    expect(res.ok).toBe(true)
    expect(res.params).toContainEqual(expect.objectContaining({ name: 'radius', type: 'slider', initial: 5 }))
    expect(backend.params()).toEqual(res.params)
    const volume = JSON.parse(await backend.requestTool('measure', {})).volume
    expect(volume).toBeGreaterThan(480)
    expect(volume).toBeLessThan(530)
  })

  it('fails a package that is not installed with the frame CDN error text', async () => {
    const res = await evalSource(`import { sphere } from '@jscad/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('failed to load module @jscad/primitives')
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/primitives')
  })

  it('fails a package subpath the frame does not alias', async () => {
    const res = await evalSource(`import { sphere } from '@jscad/modeling/primitives'\nexport const main = () => sphere()`)
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('file not found https://cdn.jsdelivr.net/npm/@jscad/modeling/primitives.js')
  })

  it('rejects export without an import line, as the frame does', async () => {
    const res = await evalSource('export const main = () => []')
    expect(res.ok).toBe(false)
    expect(res.error.name).toBe('SyntaxError')
  })

  it('uses the same transform test as the worker', () => {
    const worker = readFileSync(new URL('../../worker/worker.js', import.meta.url), 'utf8')
    expect(worker).toContain(`const importReg = ${IMPORT_REG}`)
    expect(worker).toContain(`const exportReg = ${EXPORT_REG}`)
  })

  it('maps project and CDN URLs like the frame', () => {
    const read = createReadFile({ 'main.js': 'X' })
    expect(read('http://project.local/main.js')).toBe('X')
    expect(() => read('http://project.local/other.js')).toThrow('file not found http://project.local/other.js')
    expect(read('https://cdn.jsdelivr.net/npm/@jscad/modeling@2.12.0')).toContain('"@jscad/modeling"')
    expect(() => read('https://cdn.jsdelivr.net/npm/no-such-package-xyz')).toThrow('file not found https://cdn.jsdelivr.net/npm/no-such-package-xyz')
  })

  it('answers measure with an error result when nothing was evaled', async () => {
    const res = JSON.parse(await createEvalBackend().requestTool('measure', {}))
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/no geometry/)
  })

  it('turns a throwing model into an error result, never a throw', async () => {
    const res = await evalSource('throw new Error("boom")')
    expect(res.ok).toBe(false)
    expect(res.error.message).toMatch(/^boom/)
  })

  it('stubs view and export as unavailable without throwing', async () => {
    const backend = createEvalBackend()
    for (const name of ['view', 'export']) {
      const res = JSON.parse(await backend.requestTool(name, {}))
      expect(res.ok).toBe(false)
      expect(res.error.name).toBe('UnavailableError')
    }
  })

  it('writeModel persists to the memory project', async () => {
    const backend = createEvalBackend()
    const res = JSON.parse(await backend.requestTool('writeModel', { source: CUBE, entry: 'main.js', message: 'first' }))
    expect(res.ok).toBe(true)
    expect(res.entry).toBe('main.js')
    expect(backend.project.get('main.js').message).toBe('first')
  })

  it('answers unknown tools with an error result', async () => {
    const res = JSON.parse(await createEvalBackend().requestTool('teleport', {}))
    expect(res.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run eval/backend.test.js`
Expected: FAIL — `createReadFile`/`IMPORT_REG` are not exported, and the ESM and missing-package tests fail (`cannot require ...`).

- [ ] **Step 3: Rewrite the backend**

Replace `packages/agent-loop/eval/backend.js` with:

```js
import { createRequire } from 'node:module'
import { check, measure } from '@jscadui/model-tools'
import { createParamsProxy, createProxyState, toParamDefinitions } from '@jscadui/params-core'
import { clearAllCaches, moduleResolver, require as jscadRequire } from '@jscadui/require/esm/index.js'
import { transformcjs } from '@jscadui/transform-babel/esm/transform-babel.js'

export const PROJECT_BASE = 'http://project.local/'
export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/'
const NODE_REQUIRE = Symbol.for('jscadui.eval.nodeRequire')
globalThis[NODE_REQUIRE] = createRequire(import.meta.url)

// Copied from packages/worker/worker.js (a test keeps them equal): the frame
// transforms the entry only when it has an import or an export-from line.
export const IMPORT_REG = /import(?:(?:(?:[ \n\t]+([^ *\n\t{},]+)[ \n\t]*(?:,|[ \n\t]+))?([ \n\t]*\{(?:[ \n\t]*[^ \n\t"'{}]+[ \n\t]*,?)+\})?[ \n\t]*)|[ \n\t]*\*[ \n\t]*as[ \n\t]+([^ \n\t{}]+)[ \n\t]+)from[ \n\t]*(?:['"])([^'"\n]+)(['"])/
export const EXPORT_REG = /export.*from/

export const shouldTransform = (url, script) =>
  url.endsWith('.ts') || (script.includes('import') && (IMPORT_REG.test(script) || EXPORT_REG.test(script)))

const packageSpec = (url) => url.slice(CDN_BASE.length).replace(/^((?:@[^/]+\/)?[^/@]+)@[^/]+/, '$1')

// The frame fetches CDN packages; here they come from node_modules, and a
// missing one throws the text the frame's fetch gives a 404.
export const createReadFile = (files) => (path) => {
  if (path.startsWith(PROJECT_BASE)) {
    const projectPath = path.slice(PROJECT_BASE.length)
    if (Object.hasOwn(files, projectPath)) return files[projectPath]
  } else if (path.startsWith(CDN_BASE)) {
    const spec = packageSpec(path)
    try {
      globalThis[NODE_REQUIRE].resolve(spec)
      return `module.exports = globalThis[Symbol.for('jscadui.eval.nodeRequire')](${JSON.stringify(spec)})`
    } catch {
      // falls through to the frame's 404 text
    }
  }
  throw new Error(`file not found ${path}`)
}

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

const runModel = async (source, entry) => {
  clearAllCaches()
  moduleResolver.clearCache()
  const url = PROJECT_BASE + entry
  const transform = shouldTransform(url, source) ? transformcjs : undefined
  const exports = jscadRequire({ url, script: source }, transform, createReadFile({ [entry]: source }), PROJECT_BASE, PROJECT_BASE)
  const main = exports.main ?? (typeof exports === 'function' ? exports : undefined)
  if (typeof main !== 'function') throw new Error('model exports no main()')
  const state = createProxyState({}, new Set(), { mode: 'hierarchical' })
  const out = await main(createParamsProxy(state))
  return { geometry: [out].flat(Infinity), params: toParamDefinitions(state.discovered) }
}

const noGeometry = () => JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })

export function createEvalBackend() {
  let geometry = null
  let params = []
  const project = new Map()

  const load = async (source, entry) => {
    const loaded = await runModel(source, entry)
    geometry = loaded.geometry
    params = loaded.params
  }

  const requestTool = async (name, input) => {
    try {
      const args = input ?? {}
      if (name === 'eval') {
        await load(args.source, args.entry ?? 'main.js')
        return JSON.stringify({ ok: true, params, entities: geometry.length })
      }
      if (name === 'measure') return geometry ? JSON.stringify({ ok: true, ...measure(geometry, args) }) : noGeometry()
      if (name === 'check') return geometry ? JSON.stringify({ ok: true, ...check(geometry, args) }) : noGeometry()
      if (name === 'params') return JSON.stringify({ ok: true, params })
      if (name === 'writeModel') {
        const entry = args.entry ?? 'main.js'
        project.set(entry, { source: args.source, message: args.message ?? '' })
        await load(args.source, entry)
        return JSON.stringify({ ok: true, entry })
      }
      if (name === 'view' || name === 'export') {
        return JSON.stringify({ ok: false, error: { name: 'UnavailableError', message: `${name} is unavailable in the eval harness` } })
      }
      return JSON.stringify(errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` }))
    } catch (error) {
      return JSON.stringify(errorResult(error))
    }
  }

  const reset = () => {
    geometry = null
    params = []
    project.clear()
  }

  return { requestTool, reset, project, params: () => params }
}
```

- [ ] **Step 4: Declare the build dependencies**

In `packages/agent-loop/package.json` `devDependencies`, add (keep alphabetical order):

```json
    "@jscadui/params-core": "*",
    "@jscadui/require": "*",
    "@jscadui/transform-babel": "*",
```

Create `packages/agent-loop/turbo.json` so turbo reruns the package tests when eval, log or prompt files change (the root `test.inputs` only covers `src/**` and test files):

```json
{
  "extends": ["//"],
  "tasks": {
    "test": {
      "inputs": ["$TURBO_DEFAULT$"]
    }
  }
}
```

- [ ] **Step 5: Refresh the lockfile, with the user's yes**

Run from the repo root: `npm install --package-lock-only --ignore-scripts`
Then run: `git diff --stat package-lock.json`

`package-lock.json` already had uncommitted changes before this branch (jscad-modeling `polyclip-ts`, jscad-web `bin` entries, `bignumber.js`). Stop and ask the user whether to commit the regenerated lockfile including those changes. Stage `package-lock.json` in Step 7 only on a yes; otherwise leave it out and say so in the task report.

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `packages/agent-loop`): `npx vitest run eval/`
Expected: PASS — backend (12 tests), keyless, grade, fixtures and runner unchanged and green. A `failed to load fallback .ts` line on stderr from the subpath test is expected (`require.js` logs it).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/eval/backend.js packages/agent-loop/eval/backend.test.js packages/agent-loop/package.json packages/agent-loop/turbo.json
git commit -m "$(cat <<'EOF'
feat(agent-loop): run eval models through @jscadui/require like the frame

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Add `package-lock.json` to the `git add` only if the user said yes in Step 5.)

---

### Task 5: Prompt source, examples and text loaders

**Files:**
- Modify: `packages/agent-loop/prompt.md` (full rewrite)
- Create: `packages/agent-loop/prompt/index.js`
- Create: `packages/agent-loop/prompt/examples/01-sphere-union.js`
- Create: `packages/agent-loop/prompt/examples/02-hollow-cube.js`
- Create: `packages/agent-loop/prompt/examples/03-fluent-cube-hole.js`
- Modify: `packages/agent-loop/src/prompt.js` (full rewrite)
- Create: `packages/agent-loop/text-loader.js`, `packages/agent-loop/text-hooks.js`
- Test: `packages/agent-loop/test/prompt.test.js`
- Modify: `packages/agent-loop/test/tools.test.js` (delete the drift test)
- Modify: `packages/agent-loop/package.json` (`files`, `scripts`)
- Create: `apps/jscad-web/src_build/rawImport.js`
- Test: `apps/jscad-web/test/rawImport.test.js`
- Modify: `apps/jscad-web/build.js:13` and `:184-189`
- Modify: `packages/agent-loop/README.md`

**Model:** `sonnet` — three loaders (Vite, Node, esbuild) that must agree.

**Interfaces:**
- Consumes: `createEvalBackend()` from Task 4 (examples must evaluate).
- Produces:
  - `PROSE: string`, `EXAMPLES: Array<{ file: string, source: string }>` from `prompt/index.js` (file-name order; a test enforces it).
  - `assemblePrompt(prose: string, examples: Array<{source:string}>): string` and `SYSTEM_PROMPT` from `src/prompt.js` (`SYSTEM_PROMPT` still exported from `index.js`).
  - `rawImportPlugin` (esbuild plugin) from `apps/jscad-web/src_build/rawImport.js`.
  - Node CLIs that import `index.js` run with `node --import ./text-loader.js` from `packages/agent-loop` (`npm run eval`, `npm run eval:keyless`).

A `?raw` import yields the file's text as the default export in every environment: Vitest (native), Node (`text-loader.js`), esbuild (`rawImportPlugin`). The examples are listed in `prompt/index.js` rather than `src/prompt.js` so the `chat-review` skill can add one without touching `src/`.

- [ ] **Step 1: Write the failing tests**

`packages/agent-loop/test/prompt.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { SYSTEM_PROMPT } from '../src/prompt.js'
import { EXAMPLES } from '../prompt/index.js'
import { createEvalBackend } from '../eval/backend.js'

const dir = new URL('../prompt/examples/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
const read = (file) => readFileSync(new URL(file, dir), 'utf8')

describe('system prompt', () => {
  it('starts with prompt.md', () => {
    const md = readFileSync(new URL('../prompt.md', import.meta.url), 'utf8').trim()
    expect(SYSTEM_PROMPT.startsWith(md)).toBe(true)
  })

  it('lists every example file in file-name order', () => {
    expect(EXAMPLES.map((e) => e.file)).toEqual(files)
  })

  it('carries every example after the Examples heading, in order', () => {
    let at = SYSTEM_PROMPT.indexOf('## Examples')
    expect(at).toBeGreaterThan(0)
    for (const file of files) {
      const next = SYSTEM_PROMPT.indexOf(read(file).trim(), at)
      expect(next).toBeGreaterThan(at)
      at = next
    }
  })

  it.each(files)('%s opens with a one-line comment naming its request', (file) => {
    expect(read(file).split('\n')[0]).toMatch(/^\/\/ \S/)
  })

  it.each(files)('%s evaluates in the eval backend', async (file) => {
    const res = JSON.parse(await createEvalBackend().requestTool('eval', { source: read(file) }))
    expect(res).toMatchObject({ ok: true })
  })
})
```

`apps/jscad-web/test/rawImport.test.js`:

```js
import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawImportPlugin } from '../src_build/rawImport.js'

describe('raw import plugin', () => {
  it('bundles a ?raw import as the file text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raw-'))
    writeFileSync(join(dir, 'note.md'), '# note `x`\n')
    writeFileSync(join(dir, 'ex.js'), 'module.exports = { main }\n')
    writeFileSync(join(dir, 'entry.js'), "import note from './note.md?raw'\nimport ex from './ex.js?raw'\nexport default [note, ex]\n")
    const out = await esbuild.build({ entryPoints: [join(dir, 'entry.js')], bundle: true, write: false, format: 'esm', plugins: [rawImportPlugin] })
    const mod = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`)
    expect(mod.default).toEqual(['# note `x`\n', 'module.exports = { main }\n'])
  })
})
```

In `packages/agent-loop/test/tools.test.js`, delete the whole `it('keeps prompt.js in sync with prompt.md', ...)` block.

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run test/prompt.test.js`
Expected: FAIL — cannot find `../prompt/index.js`.
Run (in `apps/jscad-web`): `npx vitest run test/rawImport.test.js`
Expected: FAIL — cannot find `../src_build/rawImport.js`.

- [ ] **Step 3: Write the prompt prose and examples**

Replace `packages/agent-loop/prompt.md` with (the old first-line HTML comment goes):

````markdown
# JSCAD modeling assistant

You write JSCAD models as JavaScript. The entry file defaults to `main.js`;
sibling files resolve inside the project.

## Imports

The runtime serves these packages. Import the package root only: paths such
as `@jscad/modeling/primitives` are not served and fail to load.

| Package | Import | Holds |
|---|---|---|
| `@jscad/modeling` | `const { primitives, booleans, transforms } = require('@jscad/modeling')` | `primitives`, `booleans`, `transforms`, `extrusions`, `expansions`, `hulls`, `minkowski`, `modifiers`, `colors`, `measurements`, `maths`, `geometries`, `curves`, `text`, `utils` |
| `@jbroll/jscad-fluent` | `const jf = require('@jbroll/jscad-fluent')` | chainable shapes: `jf.cuboid({ size: [4, 4, 5] }).translate([18, 0, 0])`, `jf.subtract(a, b)` |
| `@jscadui/jscad-text` | `const jscadText = require('@jscadui/jscad-text')` | TTF and Hershey text outlines |

Shapes such as `sphere` and `cube` are members of `primitives`, not packages:
`const { sphere } = require('@jscad/modeling').primitives`. Any other package
name is fetched from the npm CDN, and a name that is not published fails with
`failed to load module <name>`.

Write CommonJS: `require(...)` and `module.exports = { main }`. A file that
uses `export` is accepted only when it also has an `import ... from` line;
`export const main` on its own fails with `Unexpected token 'export'`.

`main(params)` returns one geometry or an array of them.

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
````

`packages/agent-loop/prompt/examples/01-sphere-union.js` (from `apps/jscad-web/examples/jscad/benchmarks/sphere-union.example.js`):

```js
// Two overlapping spheres with sliders for radius and overlap
const { booleans, primitives } = require('@jscad/modeling')
const { union } = booleans
const { sphere } = primitives

const main = (params) => {
  params._type = 'Sphere Union'
  params.radius = { type: 'slider', default: 10, min: 5, max: 30, step: 1, label: 'Sphere radius' }
  params.overlap = { type: 'slider', default: 0.8, min: 0.1, max: 1.5, step: 0.1, label: 'Overlap factor' }
  const offset = params.radius * params.overlap
  return union(
    sphere({ radius: params.radius, center: [-offset / 2, 0, 0] }),
    sphere({ radius: params.radius, center: [offset / 2, 0, 0] }),
  )
}

module.exports = { main }
```

`packages/agent-loop/prompt/examples/02-hollow-cube.js` (from `apps/jscad-web/examples/jscad/03-jscad.example.js`):

```js
// A 10mm cube hollowed by a sphere, with a colored core inside
const { booleans, colors, primitives } = require('@jscad/modeling')
const { intersect, subtract } = booleans
const { colorize } = colors
const { cube, sphere } = primitives

const main = () => {
  const outer = subtract(cube({ size: 10 }), sphere({ radius: 6.8 }))
  const inner = intersect(sphere({ radius: 4 }), cube({ size: 7 }))
  return [colorize([0.65, 0.25, 0.8], outer), colorize([0.7, 0.7, 0.1], inner)]
}

module.exports = { main }
```

`packages/agent-loop/prompt/examples/03-fluent-cube-hole.js` (from `packages/agent-loop/eval/keyless.js` `CUBE_HOLE`):

```js
// A 20mm cube with a 5mm-radius hole through it, in jscad-fluent
const jf = require('@jbroll/jscad-fluent')

const main = () => [jf.subtract(jf.cube({ size: 20 }), jf.cylinder({ radius: 5, height: 30 }))]

module.exports = { main }
```

`packages/agent-loop/prompt/index.js`:

```js
import prose from '../prompt.md?raw'
import sphereUnion from './examples/01-sphere-union.js?raw'
import hollowCube from './examples/02-hollow-cube.js?raw'
import fluentCubeHole from './examples/03-fluent-cube-hole.js?raw'

export const PROSE = prose

export const EXAMPLES = [
  { file: '01-sphere-union.js', source: sphereUnion },
  { file: '02-hollow-cube.js', source: hollowCube },
  { file: '03-fluent-cube-hole.js', source: fluentCubeHole },
]
```

Replace `packages/agent-loop/src/prompt.js` with:

```js
import { EXAMPLES, PROSE } from '../prompt/index.js'

const fenced = (source) => `\`\`\`javascript\n${source.trim()}\n\`\`\``

export const assemblePrompt = (prose, examples) =>
  `${[prose.trim(), '## Examples', ...examples.map(({ source }) => fenced(source))].join('\n\n')}\n`

export const SYSTEM_PROMPT = assemblePrompt(PROSE, EXAMPLES)
```

- [ ] **Step 4: Add the Node and esbuild loaders**

`packages/agent-loop/text-loader.js`:

```js
import { register } from 'node:module'

register('./text-hooks.js', import.meta.url)
```

`packages/agent-loop/text-hooks.js`:

```js
import { readFile } from 'node:fs/promises'

const RAW = '?raw'

export async function load(url, context, nextLoad) {
  if (!url.endsWith(RAW)) return nextLoad(url, context)
  const text = await readFile(new URL(url.slice(0, -RAW.length)), 'utf8')
  return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)}` }
}
```

In `packages/agent-loop/package.json`: set `"files": ["index.js", "src", "prompt.md", "prompt", "log", "text-loader.js", "text-hooks.js"]` and add scripts:

```json
    "eval": "node --import ./text-loader.js eval/run-eval.js",
    "eval:keyless": "node --import ./text-loader.js eval/keyless.js",
```

`apps/jscad-web/src_build/rawImport.js`:

```js
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const RAW = '?raw'

export const rawImportPlugin = {
  name: 'raw-import',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -RAW.length)), namespace: 'raw' }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
      watchFiles: [args.path],
    }))
  },
}
```

In `apps/jscad-web/build.js`, add after line 13 (`import { buildBundle, buildOne } ...`):

```js
import { rawImportPlugin } from './src_build/rawImport.js'
```

and change the `main.js` build call to pass the plugin:

```js
await buildOne('.', outDir, 'main.js', watch, { format: 'esm', loader, plugins: [rawImportPlugin], define: { __FRAME_ORIGIN__: JSON.stringify(runOrigin), __RELAY_ORIGIN__: JSON.stringify(relayOrigin({ dev, appOrigin })) } })
```

- [ ] **Step 5: Document the prompt layout**

Append to `packages/agent-loop/README.md`:

````markdown
## System prompt

`prompt.md` is the only copy of the prose. Example models live in
`prompt/examples/*.js`, each opening with a one-line comment naming the
request it answers, and are listed in `prompt/index.js`. `SYSTEM_PROMPT` is
`prompt.md` followed by an `## Examples` section with each example fenced, in
file-name order. Tests check the order and that every example evaluates.

The files are imported as `?raw` text. Vitest reads that natively, jscad-web's
esbuild build uses `src_build/rawImport.js`, and a Node script that imports
`index.js` needs the loader hook:

```bash
node --import ./text-loader.js eval/run-eval.js
```
````

- [ ] **Step 6: Run the tests and the web build**

Run (in `packages/agent-loop`): `npx vitest run`
Expected: PASS, all files (prompt tests: 2 + 3 + 3 + 1 = 9).
Run (in `apps/jscad-web`): `npx vitest run test/rawImport.test.js test/aiChat.test.js`
Expected: PASS.
Run (in `packages/agent-loop`): `npm run eval:keyless`
Expected: the keyless table prints three fixtures at total 7 and writes `eval/results/<today>-keyless.json`. Restore that file afterwards with `git checkout -- eval/results/` if it changed, and delete it if it is new (`git status --short eval/results`).
Run (in `apps/jscad-web`): `JSCAD_OUT_DIR=build_check node build.js --skipDocs`
Expected: completes without esbuild errors.
Run: `grep -rl "JSCAD modeling assistant" /home/john/src/jscadui/apps/jscad-web/build_check`
Expected: one hit, the app's main bundle.
Run: `rm -rf /home/john/src/jscadui/apps/jscad-web/build_check`

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/prompt.md packages/agent-loop/prompt packages/agent-loop/src/prompt.js packages/agent-loop/text-loader.js packages/agent-loop/text-hooks.js packages/agent-loop/test/prompt.test.js packages/agent-loop/test/tools.test.js packages/agent-loop/package.json packages/agent-loop/README.md apps/jscad-web/src_build/rawImport.js apps/jscad-web/test/rawImport.test.js apps/jscad-web/build.js
git commit -m "$(cat <<'EOF'
feat(agent-loop): prompt.md as the single prompt source, plus example files

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Conversation context in the app

**Files:**
- Create: `packages/agent-loop/src/context.js`
- Test: `packages/agent-loop/test/context.test.js`
- Modify: `packages/agent-loop/index.js`
- Modify: `apps/jscad-web/src/aiChat.js`
- Test: `apps/jscad-web/test/aiChat.test.js`
- Modify: `apps/jscad-web/main.js:858-866` (the `initChat` call)
- Modify: `apps/jscad-web/e2e/ai-chat.spec.js:19` (stub preflight headers)
- Modify: `apps/jscad-web/docs/architecture.md` (Agent loop)
- Modify: `packages/agent-loop/README.md`

**Model:** `sonnet` — a pure function plus app wiring across four files.

**Interfaces:**
- Consumes: `createProvider({ ..., chatId })` from Task 1; `SYSTEM_PROMPT` from Task 5.
- Produces:
  - `CONTEXT_BUDGET = 24000`, `filesMessage(files: Record<string, string|ArrayBuffer>): {role:'user',content:string} | null`, `buildMessages({ systemPrompt: string, transcript?: Array<{role:'user'|'assistant',content:string}>, files?: Record<string,string|ArrayBuffer>, message: string, budget?: number }): Message[]` from `src/context.js`; `buildMessages` and `CONTEXT_BUDGET` also exported from `index.js`. Used by Task 7's `runSuite`.
  - `initChat({ ..., getProjectFiles?: () => Promise<Record<string,string|ArrayBuffer>> })`.

A custom base URL may point at a provider called directly from the browser, whose CORS preflight would refuse an unknown header, so the chat sends `chatId` only when it goes through the relay (no `selection.baseUrl`).

- [ ] **Step 1: Write the failing tests**

`packages/agent-loop/test/context.test.js`:

```js
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
```

Append to `apps/jscad-web/test/aiChat.test.js`:

```js
describe('conversation context', () => {
  const submit = async (container, text, calls, runTurnFn) => {
    container.querySelector('.chat-input').value = text
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(calls))
    await vi.waitFor(() => expect(container.querySelector('.chat-input').disabled).toBe(false))
  }

  it('sends prior turns and the project files ahead of the new message', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText(`reply ${runTurnFn.mock.calls.length}`)
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      getProjectFiles: async () => ({ 'main.js': 'module.exports = {}' }),
    })
    await submit(container, 'first', 1, runTurnFn)
    await submit(container, 'second', 2, runTurnFn)
    const messages = runTurnFn.mock.calls[1][0].conversation.messages
    expect(messages[0].role).toBe('system')
    expect(messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply 1' },
    ])
    expect(messages[3].content).toContain('### main.js')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it('sends x-jscad-chat-id through the relay but not to a custom base URL', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.removeItem('jscad-ai.relay')
    const run = async (selection) => {
      document.body.innerHTML = '<div id="chat"></div>'
      const container = document.getElementById('chat')
      const runTurnFn = vi.fn(async ({ provider }) => {
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
        return { messages: [] }
      })
      initChat({ container, requestTool: async () => '{}', getProvider: () => selection, runTurnFn, projectId: 'p1' })
      await submit(container, 'hi', 1, runTurnFn)
    }
    await run({ kind: 'openai', model: 'm', apiKey: 'k' })
    await run({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://direct.test' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://jscad.rkroll.com/api/relay/openai/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers['x-jscad-chat-id']).toEqual(expect.any(String))
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-jscad-chat-id')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run test/context.test.js`
Expected: FAIL — cannot find `../src/context.js`.
Run (in `apps/jscad-web`): `npx vitest run test/aiChat.test.js`
Expected: FAIL — the second request carries only system + `second`; no chat id header.

- [ ] **Step 3: Implement `buildMessages`**

`packages/agent-loop/src/context.js`:

```js
export const CONTEXT_BUDGET = 24_000

const turnsOf = (transcript) => {
  const turns = []
  for (const m of transcript) {
    if (m.role === 'user') turns.push([m])
    else if (m.role === 'assistant' && turns.length > 0) turns.at(-1).push(m)
  }
  return turns
}

const sizeOf = (turn) => turn.reduce((n, m) => n + (m.content?.length ?? 0), 0)

const fence = (content) => '`'.repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)))

export const filesMessage = (files = {}) => {
  const entries = Object.entries(files)
    .filter(([, content]) => typeof content === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null
  const blocks = entries.map(([path, content]) => {
    const f = fence(content)
    return `### ${path}\n\n${f}${path.split('.').pop()}\n${content}\n${f}`
  })
  return { role: 'user', content: `Current project files:\n\n${blocks.join('\n\n')}` }
}

export const buildMessages = ({ systemPrompt, transcript = [], files = {}, message, budget = CONTEXT_BUDGET }) => {
  const kept = []
  let used = 0
  for (const turn of turnsOf(transcript).reverse()) {
    const size = sizeOf(turn)
    if (used + size > budget) break
    used += size
    kept.unshift(...turn)
  }
  const project = filesMessage(files)
  return [{ role: 'system', content: systemPrompt }, ...kept, ...(project ? [project] : []), { role: 'user', content: message }]
}
```

In `packages/agent-loop/index.js`, add:

```js
export { buildMessages, CONTEXT_BUDGET } from './src/context.js'
```

- [ ] **Step 4: Wire the chat panel**

In `apps/jscad-web/src/aiChat.js`:

Change the import to:

```js
import { buildMessages, createProvider, runTurn as defaultRunTurn, SYSTEM_PROMPT } from '@jscadui/agent-loop'
```

Change the JSDoc and signature of `initChat`:

```js
/**
 * @param {{container:HTMLElement,requestTool:Function,getProvider:Function,runTurnFn?:Function,storage?:{readConversation:Function,writeConversation:Function},projectId?:string|(()=>string),getProjectFiles?:()=>Promise<Record<string,string|ArrayBuffer>>}} options
 */
export const initChat = ({ container, requestTool, getProvider, runTurnFn = defaultRunTurn, storage, projectId, getProjectFiles = async () => ({}) }) => {
```

Add below `persistTranscript`:

```js
  const projectFiles = async () => {
    try {
      return (await getProjectFiles()) ?? {}
    } catch (err) {
      console.warn('chat: project files unavailable:', err)
      return {}
    }
  }
```

In `runTurnLocal`, replace the lines from `transcript = [...transcript, { role: 'user', content: message }]` through the `runTurnFn({` call's `conversation:` line with:

```js
    const prior = transcript
    transcript = [...transcript, { role: 'user', content: message }]
    persistTranscript()
    assistantEl = null
    const aborter = new AbortController()
    try {
      const provider = createProvider({
        ...selection,
        baseUrl: selection.baseUrl || relayBaseUrl(selection.kind),
        sessionId: sessionId(),
        // A custom base URL may be a provider called directly, whose CORS preflight would refuse this header.
        ...(selection.baseUrl ? {} : { chatId: sessionId() }),
      })
      const files = await projectFiles()
      let assistantText = ''
      await runTurnFn({
        conversation: { messages: buildMessages({ systemPrompt: SYSTEM_PROMPT, transcript: prior, files, message }) },
```

(The rest of `runTurnFn`'s options and the function body stay as they are.)

In `apps/jscad-web/main.js`, add to the `initChat({...})` options:

```js
    getProjectFiles: () => collectProjectFiles(fileSystem.getSwHandler()),
```

In `apps/jscad-web/e2e/ai-chat.spec.js` line 19, change the stub's allowed headers to:

```js
      'access-control-allow-headers': 'content-type, authorization, x-jscad-chat-id',
```

- [ ] **Step 5: Document context assembly**

In `apps/jscad-web/docs/architecture.md`, Agent loop section, after the relay-log paragraph added in Task 2, add:

```markdown
Each turn sends `buildMessages` (`packages/agent-loop/src/context.js`): the
system prompt; prior turns, newest first, as whole user/assistant pairs until
the next would pass `CONTEXT_BUDGET` (24,000 characters); one user message
holding every text file of the current project under `### <path>` in a fenced
block, outside the budget and omitted when the project is empty; then the new
message. Prior turns carry only what the transcript stores, the user text and
the assistant's streamed text, so earlier tool calls are not replayed. The
project files come from the file cache the frame runs (`collectProjectFiles`).
The chat sends its per-project session id as `x-jscad-chat-id` when it goes
through the relay, and not to a custom base URL. The eval builds its messages
with the same function.
```

Append to `packages/agent-loop/README.md`:

````markdown
## Conversation context

```js
buildMessages({ systemPrompt, transcript, files, message, budget = CONTEXT_BUDGET })
```

Returns the system prompt, the newest whole prior turns that fit in `budget`
characters (24,000 by default), a user message with every text file in
`files` under `### <path>` (outside the budget, omitted when empty), and the
new message. The app and the eval both use it.
````

- [ ] **Step 6: Run the tests to verify they pass**

Run (in `packages/agent-loop`): `npx vitest run`
Expected: PASS (context: 10 tests).
Run (in `apps/jscad-web`): `npx vitest run test/aiChat.test.js`
Expected: PASS, all previous chat tests plus the two new ones.

Do not run `e2e/ai-chat.spec.js` locally; it goes through simple-ci. Note in the task report that the stub header change is unverified until that run.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-loop/src/context.js packages/agent-loop/test/context.test.js packages/agent-loop/index.js packages/agent-loop/README.md apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js apps/jscad-web/main.js apps/jscad-web/e2e/ai-chat.spec.js apps/jscad-web/docs/architecture.md
git commit -m "$(cat <<'EOF'
feat(jscad-web): send prior turns and project files with each chat turn

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Eval metric, repeated runs, fixtures and comparison

**Files:**
- Modify: `packages/agent-loop/eval/grade.js`
- Test: `packages/agent-loop/eval/grade.test.js`
- Modify: `packages/agent-loop/eval/report.js`
- Test: `packages/agent-loop/eval/report.test.js` (new)
- Create: `packages/agent-loop/eval/credentials.js`
- Test: `packages/agent-loop/eval/credentials.test.js`
- Modify: `packages/agent-loop/eval/run-eval.js` (full rewrite)
- Test: `packages/agent-loop/eval/runner.test.js`
- Create: `packages/agent-loop/eval/fixtures/single-sphere.js`, `rounded-box.js`, `cylinder-param.js`
- Modify: `packages/agent-loop/eval/fixtures.test.js` (full rewrite)
- Modify: `packages/agent-loop/README.md`

**Model:** `sonnet` — several coordinated eval modules.

**Interfaces:**
- Consumes: `createEvalBackend()` with `params()` (Task 4); `buildMessages`, `SYSTEM_PROMPT` (Tasks 5, 6); `createProvider` (Task 1).
- Produces:
  - `gradeFixture(fixture, transcript, finalMeasure, context = {}) → { dimensions:{discipline,recovery,geometry,conservation}, total, firstAttemptFailures, checkRate }` and `firstAttemptFailures(transcript): number` in `eval/grade.js`. `fixture.checks(measure, { params })` receives the backend's param definitions.
  - `runSuite(fixtures, { provider, backend, runs = 1, systemPrompt = SYSTEM_PROMPT }) → Array<{ fixture, run, report, turns, error? }>`, `loadFixtures(dir?: URL): Promise<Fixture[]>`, `promptHash(prompt): string` in `eval/run-eval.js`.
  - `summarize(results) → Array<{ fixture, runs, firstAttemptFailures, checkPassRate, total, errors }>`, `formatSummary(summary): string`, `formatComparison(a, b): string` (a, b are result-file objects) in `eval/report.js`; `formatTable` stays for keyless.
  - `resolveCredentials(env, readAuth?) → { apiKey?: string, baseUrl?: string }` in `eval/credentials.js`.
  - Fixture shape: `{ name, prompt, requires: string[], verifyBeforeWrite: boolean, maxTurns: number, checks(measure, { params }) → [{ name, pass }], transcript?: [{role,content}], files?: {path: source} }`, one per file in `eval/fixtures/`, `name` equal to the file name without `.js`.
  - Result file `eval/results/<YYYY-MM-DD>-<model>-<sha8>.json`: `{ model, provider, runs, promptSha256, date, summary, results }`. Used by Tasks 8 and 9.

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent-loop/eval/grade.test.js` (and change its import to `import { firstAttemptFailures, gradeFixture } from './grade.js'`):

```js
describe('firstAttemptFailures', () => {
  const fail = (id) => resultMsg(id, JSON.stringify({ ok: false, error: { message: 'boom' } }))
  const ok = (id) => resultMsg(id, JSON.stringify({ ok: true }))

  it('counts failed results before the first successful eval', () => {
    const transcript = [
      toolMsg('t1', 'eval'), fail('t1'),
      toolMsg('t2', 'params'), ok('t2'),
      toolMsg('t3', 'eval'), fail('t3'),
      toolMsg('t4', 'eval'), ok('t4'),
      toolMsg('t5', 'measure'), fail('t5'),
    ]
    expect(firstAttemptFailures(transcript)).toBe(2)
  })

  it('counts every failure when no eval succeeds', () => {
    expect(firstAttemptFailures([toolMsg('t1', 'eval'), fail('t1'), toolMsg('t2', 'writeModel'), fail('t2')])).toBe(2)
  })

  it('is zero for a clean run and lands on the report', () => {
    const transcript = [toolMsg('t1', 'eval'), ok('t1')]
    expect(firstAttemptFailures(transcript)).toBe(0)
    const report = gradeFixture(fixture, transcript, { volume: 6400 })
    expect(report.firstAttemptFailures).toBe(0)
    expect(report.checkRate).toBe(1)
  })

  it('passes the context to the checks', () => {
    const withParams = { ...fixture, checks: (_m, { params = [] } = {}) => [{ name: 'slider', pass: params.length === 1 }] }
    expect(gradeFixture(withParams, [], null, { params: [{ type: 'slider' }] }).checkRate).toBe(1)
  })
})
```

`packages/agent-loop/eval/report.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { formatComparison, formatSummary, summarize } from './report.js'

const run = (fixture, firstAttemptFailures, checkRate, total, error) => ({
  fixture,
  run: 1,
  report: { firstAttemptFailures, checkRate, total, dimensions: {} },
  turns: 3,
  ...(error ? { error } : {}),
})

describe('eval report', () => {
  it('summarizes runs per fixture as means', () => {
    const summary = summarize([run('a', 2, 0.5, 4), run('a', 0, 1, 8, 'status 500'), run('b', 1, 1, 7)])
    expect(summary).toEqual([
      { fixture: 'a', runs: 2, firstAttemptFailures: 1, checkPassRate: 0.75, total: 6, errors: 1 },
      { fixture: 'b', runs: 1, firstAttemptFailures: 1, checkPassRate: 1, total: 7, errors: 0 },
    ])
    expect(formatSummary(summary)).toContain('a  2  1.00  0.75  6.00  1')
  })

  it('compares two result files per fixture', () => {
    const a = { model: 'm', promptSha256: 'aaaaaaaa11', summary: summarize([run('single-sphere', 1, 0.5, 4)]) }
    const b = { model: 'm', promptSha256: 'bbbbbbbb22', summary: summarize([run('single-sphere', 0, 1, 7), run('gear', 0, 1, 7)]) }
    const text = formatComparison(a, b)
    expect(text).toContain('a: m aaaaaaaa  b: m bbbbbbbb')
    expect(text).toContain('single-sphere  1.00 → 0.00  0.50 → 1.00  4.00 → 7.00')
    expect(text).toContain('gear  - → 0.00')
  })
})
```

`packages/agent-loop/eval/credentials.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { resolveCredentials } from './credentials.js'

describe('resolveCredentials', () => {
  it('uses EVAL_API_KEY without reading the auth file', () => {
    const readAuth = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta', EVAL_API_KEY: 'k', EVAL_BASE_URL: 'https://b' }, readAuth)).toEqual({ apiKey: 'k', baseUrl: 'https://b' })
    expect(readAuth).not.toHaveBeenCalled()
  })

  it('reads the meta key and base URL from the muse auth file, without its /v1', () => {
    const readAuth = () => ({ providers: { meta: { api_key: 'secret', api_base_url: 'https://api.meta.ai/v1' } } })
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta' }, readAuth)).toEqual({ apiKey: 'secret', baseUrl: 'https://api.meta.ai' })
  })

  it('leaves the key unset when the auth file is missing', () => {
    const readAuth = () => {
      throw new Error('ENOENT')
    }
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta' }, readAuth).apiKey).toBeUndefined()
  })

  it('never reads the auth file for other providers', () => {
    const readAuth = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'openai' }, readAuth).apiKey).toBeUndefined()
    expect(readAuth).not.toHaveBeenCalled()
  })
})
```

Append to `packages/agent-loop/eval/runner.test.js` (and change its imports to `import { promptHash, runSuite } from './run-eval.js'`):

```js
describe('runSuite runs and context', () => {
  it('runs each fixture `runs` times and sends prior turns and files', async () => {
    const seen = []
    const provider = {
      async *send(messages) {
        seen.push(messages)
        yield { type: 'text', text: 'ok' }
        yield { type: 'done', stopReason: 'end_turn' }
      },
    }
    const fixture = {
      name: 'follow-up',
      prompt: 'make it taller',
      transcript: [{ role: 'user', content: 'a cube' }, { role: 'assistant', content: 'done' }],
      files: { 'main.js': 'module.exports = {}' },
      requires: ['eval'],
      verifyBeforeWrite: false,
      maxTurns: 2,
      checks: () => [],
    }
    const results = await runSuite([fixture], { provider, backend: createEvalBackend(), runs: 3 })
    expect(results.map((r) => r.run)).toEqual([1, 2, 3])
    expect(seen[0].map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'user'])
    expect(seen[0][3].content).toContain('### main.js')
    expect(seen[0].at(-1).content).toBe('make it taller')
  })

  it('records a provider failure on the run instead of throwing', async () => {
    const provider = {
      send: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error('status 500') } }) }),
    }
    const fixture = { name: 'x', prompt: 'p', requires: ['eval'], verifyBeforeWrite: false, maxTurns: 2, checks: () => [] }
    const [result] = await runSuite([fixture], { provider, backend: createEvalBackend() })
    expect(result.error).toBe('status 500')
    expect(result.report.firstAttemptFailures).toBe(0)
  })

  it('hashes the prompt with SHA-256', () => {
    expect(promptHash('x')).toBe('2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881')
  })
})
```

Replace `packages/agent-loop/eval/fixtures.test.js` with:

```js
import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { measure } from '@jscadui/model-tools'
import { TOOLS } from '../src/tools.js'
import { loadFixtures } from './run-eval.js'

const names = new Set(TOOLS.map((t) => t.name))
const files = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.endsWith('.js')).sort()
const fixtures = await loadFixtures()
const byName = Object.fromEntries(fixtures.map((f) => [f.name, f]))
const { primitives } = createRequire(import.meta.url)('@jscad/modeling')

describe('eval fixtures', () => {
  it('loads one fixture per file, named after the file', () => {
    expect(fixtures.map((f) => `${f.name}.js`)).toEqual(files)
  })

  for (const fixture of fixtures) {
    it(`${fixture.name}: declares known tools, a prompt, and function checks`, () => {
      expect(fixture.prompt.trim().length).toBeGreaterThan(0)
      expect(fixture.requires.length).toBeGreaterThan(0)
      for (const tool of fixture.requires) expect(names.has(tool)).toBe(true)
      expect(fixture.requires).not.toContain('view')
      expect(fixture.requires).not.toContain('export')
      expect(typeof fixture.checks).toBe('function')
      expect(typeof fixture.maxTurns).toBe('number')
    })
  }

  it.each([
    ['single-sphere', () => primitives.sphere({ radius: 10 }), {}],
    ['rounded-box', () => primitives.roundedCuboid({ size: [30, 20, 10], roundRadius: 2 }), {}],
    ['cylinder-param', () => primitives.cylinder({ radius: 5, height: 20 }), { params: [{ name: 'height', type: 'slider' }] }],
  ])('%s passes a matching model', (name, shape, context) => {
    expect(byName[name].checks(measure([shape()], {}), context).every((c) => c.pass)).toBe(true)
  })

  it('single-sphere fails a cube', () => {
    expect(byName['single-sphere'].checks(measure([primitives.cube({ size: 20 })], {}), {}).every((c) => c.pass)).toBe(false)
  })

  it('cylinder-param fails without a slider', () => {
    expect(byName['cylinder-param'].checks(measure([primitives.cylinder({ radius: 5, height: 20 })], {}), { params: [] }).every((c) => c.pass)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (in `packages/agent-loop`): `npx vitest run eval/`
Expected: FAIL — `firstAttemptFailures`, `summarize`, `resolveCredentials`, `promptHash`, `loadFixtures` are missing; the new fixtures do not exist.

- [ ] **Step 3: Implement grading and reporting**

In `packages/agent-loop/eval/grade.js`, add above `gradeFixture`:

```js
export function firstAttemptFailures(transcript) {
  const names = new Map(toolCallsOf(transcript).map((c) => [c.id, c.name]))
  let count = 0
  for (const m of resultsOf(transcript)) {
    if (failed(m.content)) count += 1
    else if (names.get(m.toolCallId) === 'eval') return count
  }
  return count
}
```

and change `gradeFixture`'s signature, checks call and return:

```js
export function gradeFixture(fixture, transcript, finalMeasure, context = {}) {
```

```js
  const outcomes = fixture.checks(finalMeasure, context).map((c) => (c.pass ? 1 : 0))
```

```js
  return {
    dimensions: { discipline, recovery, geometry, conservation },
    total: discipline + recovery + geometry + conservation,
    firstAttemptFailures: firstAttemptFailures(transcript),
    checkRate: rate,
  }
```

Append to `packages/agent-loop/eval/report.js`:

```js
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const n2 = (x) => x.toFixed(2)

export function summarize(results) {
  const byFixture = new Map()
  for (const r of results) {
    if (!byFixture.has(r.fixture)) byFixture.set(r.fixture, [])
    byFixture.get(r.fixture).push(r)
  }
  return [...byFixture].map(([fixture, runs]) => ({
    fixture,
    runs: runs.length,
    firstAttemptFailures: mean(runs.map((r) => r.report.firstAttemptFailures)),
    checkPassRate: mean(runs.map((r) => r.report.checkRate)),
    total: mean(runs.map((r) => r.report.total)),
    errors: runs.filter((r) => r.error).length,
  }))
}

export function formatSummary(summary) {
  const lines = ['fixture  runs  firstFail  checks  total  errors']
  for (const s of summary) {
    lines.push(`${s.fixture}  ${s.runs}  ${n2(s.firstAttemptFailures)}  ${n2(s.checkPassRate)}  ${n2(s.total)}  ${s.errors}`)
  }
  return lines.join('\n')
}

export function formatComparison(a, b) {
  const lines = [
    `a: ${a.model} ${a.promptSha256?.slice(0, 8)}  b: ${b.model} ${b.promptSha256?.slice(0, 8)}`,
    'fixture  firstFail a → b  checks a → b  total a → b',
  ]
  const names = [...new Set([...a.summary, ...b.summary].map((s) => s.fixture))]
  const cell = (s, key) => (s ? n2(s[key]) : '-')
  for (const name of names) {
    const sa = a.summary.find((s) => s.fixture === name)
    const sb = b.summary.find((s) => s.fixture === name)
    lines.push(
      `${name}  ${cell(sa, 'firstAttemptFailures')} → ${cell(sb, 'firstAttemptFailures')}  ${cell(sa, 'checkPassRate')} → ${cell(sb, 'checkPassRate')}  ${cell(sa, 'total')} → ${cell(sb, 'total')}`,
    )
  }
  return lines.join('\n')
}
```

`packages/agent-loop/eval/credentials.js`:

```js
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const readMuseAuth = () => JSON.parse(readFileSync(join(homedir(), '.config', 'muse', 'auth.json'), 'utf8'))

// Muse's api_base_url ends in /v1, which the provider adapters append themselves.
export const resolveCredentials = (env, readAuth = readMuseAuth) => {
  if (env.EVAL_API_KEY || env.EVAL_PROVIDER !== 'meta') return { apiKey: env.EVAL_API_KEY, baseUrl: env.EVAL_BASE_URL }
  let meta = {}
  try {
    meta = readAuth()?.providers?.meta ?? {}
  } catch {
    // no auth file: the caller reports the missing key
  }
  return { apiKey: meta.api_key, baseUrl: env.EVAL_BASE_URL ?? meta.api_base_url?.replace(/\/v1\/?$/, '') }
}
```

- [ ] **Step 4: Rewrite the runner**

Replace `packages/agent-loop/eval/run-eval.js` with:

```js
// Usage (from packages/agent-loop):
//   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval
//   npm run eval -- --compare eval/results/a.json eval/results/b.json
// Runs the suite live. Never in CI: every run spends real API budget.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildMessages, createProvider, runTurn, SYSTEM_PROMPT } from '../index.js'
import { createEvalBackend } from './backend.js'
import { resolveCredentials } from './credentials.js'
import { gradeFixture } from './grade.js'
import { formatComparison, formatSummary, summarize } from './report.js'

const FIXTURES = new URL('./fixtures/', import.meta.url)

export const promptHash = (prompt) => createHash('sha256').update(prompt).digest('hex')

export async function loadFixtures(dir = FIXTURES) {
  const fixtures = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    fixtures.push((await import(new URL(file, dir).href)).fixture)
  }
  return fixtures
}

const withTurnCap = (provider, maxTurns) => {
  let rounds = 0
  return {
    async *send(messages, tools) {
      rounds += 1
      if (rounds > maxTurns) {
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield* provider.send(messages, tools)
    },
  }
}

export async function runSuite(fixtures, { provider, backend, runs = 1, systemPrompt = SYSTEM_PROMPT }) {
  if (!provider) throw new Error('runSuite: provider is required (set EVAL_PROVIDER/EVAL_MODEL/EVAL_API_KEY)')
  const results = []
  for (const fixture of fixtures) {
    for (let run = 1; run <= runs; run += 1) {
      backend.reset()
      const messages = buildMessages({ systemPrompt, transcript: fixture.transcript ?? [], files: fixture.files ?? {}, message: fixture.prompt })
      let transcript = messages
      let error
      try {
        const turn = await runTurn({
          conversation: { messages },
          provider: withTurnCap(provider, fixture.maxTurns),
          requestTool: (name, input) => backend.requestTool(name, input),
          onText: () => {},
        })
        transcript = turn.messages
      } catch (err) {
        error = err.message
      }
      const finalMeasure = JSON.parse(await backend.requestTool('measure', {}))
      const report = gradeFixture(fixture, transcript, finalMeasure.ok ? finalMeasure : null, { params: backend.params() })
      results.push({ fixture: fixture.name, run, report, turns: transcript.length, ...(error ? { error } : {}) })
    }
  }
  return results
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const main = async (argv, env) => {
  const at = argv.indexOf('--compare')
  if (at !== -1) {
    console.log(formatComparison(readJson(argv[at + 1]), readJson(argv[at + 2])))
    return
  }
  const { EVAL_PROVIDER, EVAL_MODEL } = env
  const { apiKey, baseUrl } = resolveCredentials(env)
  if (!EVAL_PROVIDER || !EVAL_MODEL || !apiKey) {
    console.error('run-eval: set EVAL_PROVIDER, EVAL_MODEL and EVAL_API_KEY (EVAL_PROVIDER=meta reads ~/.config/muse/auth.json)')
    process.exit(1)
  }
  const runs = Number(env.EVAL_RUNS) || 5
  const only = env.EVAL_FIXTURES ? env.EVAL_FIXTURES.split(',') : null
  const fixtures = (await loadFixtures()).filter((f) => !only || only.includes(f.name))
  const provider = createProvider({ kind: EVAL_PROVIDER, model: EVAL_MODEL, apiKey, baseUrl })
  const results = await runSuite(fixtures, { provider, backend: createEvalBackend(), runs })
  const summary = summarize(results)
  const promptSha256 = promptHash(SYSTEM_PROMPT)
  console.log(formatSummary(summary))
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const file = new URL(`./results/${new Date().toISOString().slice(0, 10)}-${EVAL_MODEL}-${promptSha256.slice(0, 8)}.json`, import.meta.url)
  writeFileSync(file, JSON.stringify({ model: EVAL_MODEL, provider: EVAL_PROVIDER, runs, promptSha256, date: new Date().toISOString(), summary, results }, null, 2))
  console.log(`run-eval: wrote ${fileURLToPath(file)}`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await main(process.argv.slice(2), process.env)
}
```

`keyless.js` keeps working unchanged: it calls `runSuite` with its three fixtures and the default `runs = 1`.

- [ ] **Step 5: Add the fixtures**

`packages/agent-loop/eval/fixtures/single-sphere.js`:

```js
// The first-time request that exposed Muse 1.3 contributor's import mistakes.
export const fixture = {
  name: 'single-sphere',
  prompt: 'A single sphere',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => {
    const [x, y, z] = m?.dimensions ?? [0, 0, 0]
    const ratio = x > 0 ? m.volume / ((4 / 3) * Math.PI * (x / 2) ** 3) : 0
    return [
      { name: 'round in every axis', pass: x > 0 && Math.abs(y - x) <= x * 0.02 && Math.abs(z - x) <= x * 0.02 },
      { name: 'sphere volume', pass: ratio > 0.9 && ratio < 1.01 },
    ]
  },
}
```

`packages/agent-loop/eval/fixtures/rounded-box.js`:

```js
// Rounded edges must cost volume against the sharp 6000 mm³ box.
export const fixture = {
  name: 'rounded-box',
  prompt: 'A 30 by 20 by 10 box with rounded edges',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '10 x 20 x 30', pass: Math.abs(a - 10) < 0.5 && Math.abs(b - 20) < 0.5 && Math.abs(c - 30) < 0.5 },
      { name: 'edges rounded', pass: volume > 4800 && volume < 5990 },
    ]
  },
}
```

`packages/agent-loop/eval/fixtures/cylinder-param.js`:

```js
// The height must reach the UI as a slider, not a constant.
export const fixture = {
  name: 'cylinder-param',
  prompt: 'A cylinder with a slider for its height',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { params = [] } = {}) => {
    const [x, y, z] = m?.dimensions ?? [0, 0, 0]
    const ratio = x > 0 && z > 0 ? m.volume / (Math.PI * (x / 2) ** 2 * z) : 0
    return [
      { name: 'round cross-section', pass: x > 0 && Math.abs(y - x) <= x * 0.02 },
      { name: 'cylinder volume', pass: ratio > 0.95 && ratio < 1.01 },
      { name: 'height slider', pass: params.some((p) => p.type === 'slider') },
    ]
  },
}
```

- [ ] **Step 6: Document the eval**

Append to `packages/agent-loop/README.md`:

````markdown
## Eval

The eval replays each fixture in `eval/fixtures/` against a live model and
grades the transcript. Model code runs through `@jscadui/require` with the
compute frame's transform rule and CDN URL scheme; `https://cdn.jsdelivr.net/npm/<pkg>`
maps to the package in local `node_modules`, and a package that is not
installed fails with the frame's `failed to load module <name>` /
`file not found <url>` text. `@jscadui/jscad-text` (ESM-only) and
`@jbroll/jscad-anchors` (not installed) fail here though the app serves them.

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
npm run eval -w @jscadui/agent-loop -- --compare eval/results/a.json eval/results/b.json
npm run eval:keyless -w @jscadui/agent-loop
```

| Variable | Meaning |
|---|---|
| `EVAL_PROVIDER` | provider kind: `anthropic`, `openai`, `opencode-go`, `meta` |
| `EVAL_MODEL` | model id |
| `EVAL_API_KEY` | provider key; with `EVAL_PROVIDER=meta` and no key, `providers.meta.api_key` and `api_base_url` come from `~/.config/muse/auth.json` |
| `EVAL_BASE_URL` | provider base URL, without `/v1` |
| `EVAL_RUNS` | runs per fixture, default 5 |
| `EVAL_FIXTURES` | comma-separated fixture names to run, default all |

Each run is graded on discipline, recovery, geometry and conservation (0-2
each) and on `firstAttemptFailures`: the failed tool results before the first
successful `eval`, or before the end of the run if none succeeds. The summary
gives, per fixture, the mean `firstAttemptFailures`, the pass rate of its
geometry checks, the mean total and the count of runs that ended in a
provider error. Each result file, `eval/results/<date>-<model>-<sha8>.json`,
records the SHA-256 of the assembled system prompt, so `--compare` can set two
prompt versions side by side. The key is never printed or written.

A fixture is one file exporting `fixture`:
`{ name, prompt, requires, verifyBeforeWrite, maxTurns, checks(measure, { params }), transcript?, files? }`.
`name` matches the file name; `transcript` (prior `{ role, content }` turns)
and `files` (`{ path: source }`) test follow-up requests through the same
`buildMessages` the app uses.
````

- [ ] **Step 7: Run the tests to verify they pass**

Run (in `packages/agent-loop`): `npx vitest run`
Expected: PASS, all files, including `keyless.test.js` (three fixtures at total 7).

- [ ] **Step 8: Commit**

```bash
git add packages/agent-loop/eval packages/agent-loop/README.md
git commit -m "$(cat <<'EOF'
feat(agent-loop): first-attempt failure metric, repeated runs, new fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Before committing, run `git status --short packages/agent-loop/eval` and make sure no stray `eval/results/` file from Task 5's keyless run is staged.

---

### Task 8: `chat-review` project skill

**Files:**
- Create: `.claude/skills/chat-review/SKILL.md`
- Modify: `packages/agent-loop/README.md`

**Model:** `haiku` — one file whose full text is given below.

**Interfaces:**
- Consumes: `npm run read-log` (Task 3), `npm run eval` and `--compare` (Task 7), the fixture shape (Task 7), `prompt/index.js` (Task 5).
- Produces: the skill, triggered by "review the chat logs".

- [ ] **Step 1: Write the skill**

Create `.claude/skills/chat-review/SKILL.md` with exactly:

````markdown
---
name: chat-review
description: Review recorded jscad-chat conversations, reproduce each stumble as an eval fixture, and improve the agent-loop system prompt and examples against the eval. Use when asked to "review the chat logs", review chat conversations, or improve the chat prompt from real sessions.
---

# Chat review

Improves `packages/agent-loop`'s system prompt from what users actually hit.
The launcher relay logs every chat request; the log reader rebuilds the
conversations; the eval measures a prompt change before it is kept.

## Scope

Edit only `packages/agent-loop/prompt.md`, `packages/agent-loop/prompt/`
(examples and `prompt/index.js`), `packages/agent-loop/eval/fixtures/` and
new files in `packages/agent-loop/eval/results/`. A stumble whose cause is in
the runtime, the tools or the app goes to `docs/backlog.md` as an item
instead, with the conversation's chat id and the error text.

Live eval runs spend API budget. Before the first live run of a review, tell
the user the fixture count times `EVAL_RUNS` and get a yes.

## Steps

1. **Read the logs.** Read `~/.local/state/jscad-chat/last-review` with the
   Read tool; it holds one ISO time, or does not exist on the first review.
   Note the current time as the review time. Run, from the repo root:

   ```bash
   npm run read-log -w @jscadui/agent-loop -- --since <ISO time from last-review>
   ```

   Drop `--since` when the file does not exist. Add `--json` when you need a
   tool call's full input or result.

2. **List the stumbles.** For each conversation:
   - every failed tool call, with its error message and the source that
     caused it;
   - every turn where the user corrected the model ("no", "that's wrong",
     a repeat of the request, a changed dimension);
   - every turn that ended without a `writeModel`.

3. **Group by cause.** Stumbles with the same cause across conversations are
   one group: the same bad import, the same misread parameter style, the same
   wrong API call. Name each group by its cause, not its symptom.

4. **Reproduce each group as a fixture.** Add
   `packages/agent-loop/eval/fixtures/<name>.js`, where `<name>` is the
   fixture's `name`:

   ```js
   // <one line: the stumble this fixture reproduces>
   export const fixture = {
     name: '<name>',
     prompt: '<the user message from the log, verbatim>',
     requires: ['eval', 'writeModel'],
     verifyBeforeWrite: false,
     maxTurns: 8,
     checks: (m, { params = [] } = {}) => [
       { name: '<what the result must be>', pass: /* from m.dimensions, m.volume, m.boundingBox, params */ false },
     ],
     // For a follow-up request, add the prior turns and project files from the log:
     // transcript: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }],
     // files: { 'main.js': '...' },
   }
   ```

   Run the new fixtures on the current prompt:

   ```bash
   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor EVAL_FIXTURES=<name>,<name> npm run eval -w @jscadui/agent-loop
   ```

   Confirm each fails the way the log shows (a nonzero mean `firstFail`, the
   same error text in the result file). A fixture that passes on the current
   prompt does not reproduce the stumble; rework its prompt or context until
   it fails, or drop it.

5. **Draft a prompt or example change.** Use the
   `llm-application-dev:prompt-engineering-patterns` skill, especially its
   few-shot reference (`references/few-shot-learning.md`). Prefer a short
   example model in `prompt/examples/NN-<name>.js` that shows the right form
   over more prose. Each example opens with a one-line comment naming the
   request it answers, and must be listed in `prompt/index.js` in file-name
   order. Keep `prompt.md` prose short and concrete.

6. **Measure the candidate.** Run the full suite on the candidate:

   ```bash
   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
   npm run eval -w @jscadui/agent-loop -- --compare eval/results/<baseline>.json eval/results/<candidate>.json
   ```

   The baseline is the newest result file for the current prompt (its
   `promptSha256` matches the committed prompt); run one if none exists.
   Keep the change only if the mean `firstAttemptFailures` drops on the new
   fixtures and no fixture's mean total score falls by more than 0.5.
   Otherwise revise and measure again, or drop the change.

7. **Show and commit.** Show the user the prompt/example diff and the
   comparison table. On approval, commit the prompt, examples, fixtures and
   both result files together, then write the review time from step 1 to
   `~/.local/state/jscad-chat/last-review` with the Write tool. Never push or
   open a pull request.
````

- [ ] **Step 2: Mention the loop in the README**

Append to `packages/agent-loop/README.md`:

```markdown
## Review loop

The `chat-review` project skill (`.claude/skills/chat-review/SKILL.md`) runs
the loop: read new conversations since the last review, group the stumbles by
cause, reproduce each group as a fixture, change the prompt or its examples,
and keep the change only when the eval shows fewer first-attempt failures on
the new fixtures and no fixture's mean total falls by more than 0.5.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/chat-review/SKILL.md packages/agent-loop/README.md
git commit -m "$(cat <<'EOF'
feat: chat-review skill for the prompt improvement loop

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Baseline eval on Muse 1.3 contributor (needs the user's go-ahead)

**Files:**
- Create: `packages/agent-loop/eval/results/<YYYY-MM-DD>-muse-spark-1.3-contributor-<sha8>.json`

**Model:** `sonnet` — a live run that needs judgment about failures and the user in the loop.

**Interfaces:**
- Consumes: `npm run eval` (Task 7) and the fixtures from Task 7.
- Produces: the baseline result file the first `chat-review` compares against.

- [ ] **Step 1: Ask the user**

This spends API budget. Ask the user, in one message: run the full suite (6 fixtures × `EVAL_RUNS=5` = 30 runs, each up to its fixture's `maxTurns` provider calls) on model id `muse-spark-1.3-contributor` with `EVAL_PROVIDER=meta` and the key from `~/.config/muse/auth.json`? Confirm the model id in the same message. Do nothing further without a yes; if the user gives another id, use it below.

- [ ] **Step 2: Run the eval in the background**

Run from the repo root with Bash `run_in_background` (the command exits when the suite is done; do not poll it):

```bash
EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor EVAL_RUNS=5 npm run eval -w @jscadui/agent-loop
```

Expected when it ends: the summary table for six fixtures and `run-eval: wrote .../eval/results/<date>-muse-spark-1.3-contributor-<sha8>.json`. If every run shows an error (auth, 4xx), stop and report the error text to the user; do not retry in a loop.

- [ ] **Step 3: Check the result file carries no secret**

Run: `grep -cE "api_key|Bearer|authorization" /home/john/src/jscadui/packages/agent-loop/eval/results/<the file just written>`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-loop/eval/results/<the file just written>
git commit -m "$(cat <<'EOF'
test(agent-loop): baseline eval on muse-spark-1.3-contributor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Report the summary table to the user, in particular `single-sphere`'s mean `firstFail`.

---

### Task 10: Fold the design into the docs, backlog, and remove the spec and plan

**Files:**
- Modify: `apps/jscad-web/docs/architecture.md` (Agent loop)
- Modify: `docs/backlog.md` ("Remaining issues")
- Delete: `docs/superpowers/specs/2026-09-27-chat-feedback-loop-design.md`
- Delete: `docs/superpowers/plans/2026-09-27-chat-feedback-loop.md`

**Model:** `haiku` — the text to add is given verbatim.

**Interfaces:**
- Consumes: everything above.
- Produces: the final commit of the branch.

- [ ] **Step 1: Add the design rationale to the architecture doc**

In `apps/jscad-web/docs/architecture.md`, at the end of the Agent loop section (before `## Key custody`), add:

```markdown
### Chat feedback loop

The prompt improves from real sessions. The launcher relay logs each
conversation (above), and `packages/agent-loop/log/read-log.js` rebuilds the
log into turns, each tool call with its result and the source of any failed
one. It parses responses with the adapters' own stream parsers, so each
protocol has one SSE parser. The `chat-review` project skill
(`.claude/skills/chat-review/`) groups the stumbles by cause, reproduces each
group as an eval fixture, and keeps a prompt or example change only when the
eval shows fewer first-attempt failures on the new fixtures and no fixture's
mean total falls by more than 0.5.

The eval runs model code through `@jscadui/require` with the frame's
transform rule and URL scheme, mapping `https://cdn.jsdelivr.net/npm/<pkg>` to
local `node_modules`, so a bad import fails with the same `failed to load
module` / `file not found` text the model gets in the app. It imports the
prebuilt `esm/` bundles of `@jscadui/require` and `@jscadui/transform-babel`,
because their `src/` entries do not load in plain Node.

`prompt.md` is the only copy of the prompt prose; examples are separate files
in `prompt/examples/`, listed in `prompt/index.js`. They are imported as `?raw`
text, which Vitest reads natively, jscad-web's build reads through
`src_build/rawImport.js`, and Node reads through `text-loader.js`.

Logging stays in the local launcher. The production relay forwards by
allowlist, so it drops the chat id header and records nothing.
```

- [ ] **Step 2: Add the backlog items**

In `docs/backlog.md`, under `## Remaining issues`, add at the top of the list:

```markdown
- **Trim project files in chat context (agent-loop).** `buildMessages` sends
  every text file of the project outside the 24,000-character budget. Large
  projects need trimming, most recently mentioned files first.
  (`packages/agent-loop/src/context.js`)
- **Production relay chat logging (jscad-web server).** Only the launcher
  relay logs conversations. Logging in `server/src/relay` needs the user's
  opt-in before anything is written.
- **Eval cannot load ESM-only or CDN-only packages (agent-loop).**
  `@jscadui/jscad-text` (its `exports` has only an `import` condition) and
  `@jbroll/jscad-anchors` (not installed) fail in `eval/backend.js` while the
  frame serves them.
```

- [ ] **Step 3: Delete the spec and the plan**

```bash
git rm docs/superpowers/specs/2026-09-27-chat-feedback-loop-design.md docs/superpowers/plans/2026-09-27-chat-feedback-loop.md
```

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/docs/architecture.md docs/backlog.md
git commit -m "$(cat <<'EOF'
docs: fold the chat feedback loop design into architecture, drop spec and plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)"
```

Do not push and do not open a PR. Report the branch name `chat-feedback-loop` and that `e2e/ai-chat.spec.js` still needs a simple-ci run for the stub header change.
