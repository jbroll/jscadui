# Agent Loop Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining wire-level gaps vs opencode/pi/Muse/Claude Code without adding dependencies.

**Architecture:** Three isolated edits in `packages/agent-loop/src`: flag failures on the Anthropic wire, validate tool args against the declared schemas before dispatch, synthesize missing `tool` results when a turn throws. No provider or app wiring changes.

**Tech Stack:** ESM, zero-dep browser-safe JS, vitest.

## Global Constraints

- Browser-safe core: only `fetch`/`AbortSignal`/`crypto.randomUUID`, no Node deps.
- Failures are values (`{ok:false,error}` JSON), never turn failures, except abort/refusal/empty-reply.
- Input `conversation` is never mutated; `runTurn` resolves a NEW array, rejections carry `error.messages`.
- `npm run validate` (lint + typecheck + test) stays green.

---

### Task 1: Anthropic `is_error` on failure results

**Files:**
- Modify: `packages/agent-loop/src/providers.js:206-243`
- Test: `packages/agent-loop/test/providers.test.js`

**Interfaces:**
- Consumes: `message.content` string (usually `{ok:false,...}` JSON on failure).
- Produces: `tool_result` blocks with `is_error: true` exactly when content parses to `{ok:false}`.

- [ ] **Step 1: Write the failing test**

```js
it('anthropic: marks failure results with is_error', async () => {
  fetchMock.mockResolvedValue(new Response(sseBody('')))
  const messages = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, toolCalls: [{ id: 't1', name: 'read', input: { path: 'a' } }, { id: 't2', name: 'read', input: { path: 'b' } }] },
    { role: 'tool', toolCallId: 't1', content: JSON.stringify({ ok: false, error: { name: 'Error', message: 'no' } }) },
    { role: 'tool', toolCallId: 't2', content: JSON.stringify({ ok: true }) },
  ]
  const provider = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
  for await (const e of provider.send(messages, [])) void e
  const posted = JSON.parse(fetchMock.mock.calls.at(-1)[1].body)
  const batch = posted.messages.filter((m) => m.role === 'user').at(-1).content
  expect(batch[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true })
  expect(batch[1]).not.toHaveProperty('is_error')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/providers.test.js -t "is_error"`
Expected: FAIL with `expected { type: 'tool_result', ... } to match object`

- [ ] **Step 3: Write minimal implementation**

```js
const isFailureContent = (content) => {
  if (typeof content !== 'string') return false
  try {
    return JSON.parse(content)?.ok === false
  } catch {
    return false
  }
}
```

Use it in both `toAnthropicMessage` (single tool message) and `toAnthropicMessages` (batch):

```js
const result = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }
if (isFailureContent(message.content)) result.is_error = true
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/providers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/test/providers.test.js
git commit -m "feat(agent-loop): flag failed tool results with is_error on Anthropic wire"
```

### Task 2: Validate tool args against declared schemas

**Files:**
- Modify: `packages/agent-loop/src/dispatchTool.js`
- Test: `packages/agent-loop/test/dispatchTool.test.js`

**Interfaces:**
- Consumes: `TOOLS` schemas from `../src/tools.js` (`type/properties/required/additionalProperties`, `anyOf` and `enum` left to handlers).
- Produces: `dispatchTool` returns `{ok:false,error:{name:'ValidationError',message}}` without calling deps on violation.

- [ ] **Step 1: Write the failing test**

```js
  it('rejects calls that violate the tool schema without calling the handler', async () => {
    const d = deps()
    expect(await dispatchTool('read', {}, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.read).not.toHaveBeenCalled()
    expect(await dispatchTool('export', { format: 5 }, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.exportModel).not.toHaveBeenCalled()
    expect(await dispatchTool('list', { extra: 1 }, d)).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'ValidationError' }) }))
    expect(d.list).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatchTool.test.js -t "violate the tool schema"`
Expected: FAIL (handlers get called, no ValidationError)

- [ ] **Step 3: Write minimal implementation**

```js
import { TOOLS } from './tools.js'

const SCHEMAS = new Map(TOOLS.map((t) => [t.name, t.inputSchema]))

const checkType = (value, type) => {
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return true
}

const validateInput = (name, input) => {
  const schema = SCHEMAS.get(name)
  if (!schema || typeof input !== 'object' || input === null) return null
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) return `missing required property '${key}'`
  }
  if (schema.additionalProperties === false) {
    const known = new Set(Object.keys(schema.properties ?? {}))
    const extra = Object.keys(input).find((k) => !known.has(k))
    if (extra) return `unknown property '${extra}'`
  }
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = input[key]
    if (value === undefined) continue
    if (prop.anyOf) continue
    if (prop.type && !checkType(value, prop.type)) return `property '${key}' should be ${prop.type}`
  }
  return null
}
```

(`enum` membership stays with handlers: they own domain knowledge the
schema does not repeat, like export aliases, and answer instructive errors.)

In `dispatchTool` after the unknown-tool check:

```js
const violation = validateInput(name, input ?? {})
if (violation) return toolError('ValidationError', `${name}: ${violation}`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dispatchTool.test.js`
Expected: PASS (existing valid-arg tests still pass: `measure {parts:true}` skips via `anyOf`, `view` has no schema so no check)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/dispatchTool.js packages/agent-loop/test/dispatchTool.test.js
git commit -m "feat(agent-loop): validate tool arguments against declared schemas"
```

### Task 3: Synthesize missing tool results on turn failure

**Files:**
- Modify: `packages/agent-loop/src/loop.js:383-386` (catch block)
- Test: `packages/agent-loop/test/loop.test.js`

**Interfaces:**
- Consumes: `messages` so far, thrown `err`.
- Produces: `err.messages` ends with one `{role:'tool'}` per orphaned `toolCall` (abort/timeout), content `{ok:false,error:{name, message}}`.

- [ ] **Step 1: Write the failing test**

```js
it('synthesizes missing tool results when the turn aborts mid-batch', async () => {
  const provider = roundsProvider([
    [
      { type: 'tool_use', id: 't1', name: 'read', input: { path: 'a' } },
      { type: 'tool_use', id: 't2', name: 'read', input: { path: 'b' } },
      { type: 'done', stopReason: 'tool_use' },
    ],
  ])
  const controller = new AbortController()
  const requestTool = vi.fn(async (name) => {
    if (name === 'read' && requestTool.mock.calls.length === 1) {
      controller.abort()
      await new Promise((r) => setTimeout(r, 10))
    }
    return '{"ok":true}'
  })
  const error = await runTurn({
    conversation: { messages: [{ role: 'user', content: 'hi' }] },
    provider,
    requestTool,
    signal: controller.signal,
  }).catch((e) => e)
  expect(error.name).toBe('AbortError')
  const ids = error.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId)
  expect(ids).toEqual(['t1', 't2'])
  for (const m of error.messages.filter((m) => m.role === 'tool')) {
    expect(JSON.parse(m.content)).toMatchObject({ ok: false })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/loop.test.js -t "synthesizes missing"`
Expected: FAIL (only completed results present, or ids mismatch)

- [ ] **Step 3: Write minimal implementation**

In the `catch (err)` before `err.messages ??= messages`, insert:

```js
const failed = err?.name ?? 'Error'
const failedMessage = err?.message ?? String(err)
const covered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId))
for (let i = messages.length - 1; i >= 0; i -= 1) {
  const m = messages[i]
  if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue
  for (const call of m.toolCalls) {
    if (!covered.has(call.id)) {
      covered.add(call.id)
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ ok: false, error: { name: failed, message: failedMessage } }) })
    }
  }
  break
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/loop.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/loop.js packages/agent-loop/test/loop.test.js
git commit -m "fix(agent-loop): synthesize missing tool results on abort or failure"
```
