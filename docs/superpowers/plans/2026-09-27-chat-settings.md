# Chat settings cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gear-gated chat config with truthful sign-in copy, relay-fetched model lists, and per-provider documented effort controls incl. Meta Muse Spark.

**Architecture:** Add optional `effort` to `createProvider` in both stacks (JS agent-loop and TS server), mapping to each adapter's documented param and omitting when unset; add `GET /api/relay/:kind/*` under existing relay guards; rebuild `aiAccount.js` into header row + gear `<dialog>` with model fetch and effort dropdown driven by Anthropic capabilities or documented fallback sets.

**Tech Stack:** Node 22 ES modules, vitest + jsdom, Express relay, vanilla DOM dialog.

## Global Constraints

- Targets modern browsers only, ES2022+ without polyfills.
- Relay: trusted-origin check, 60/min rate limit, provider-auth header allowlist only, no secret logging. POST behavior unchanged.
- Key custody modes (`session` / `device` / `synced`) unchanged via `@jscadui/key-store`.
- Effort params documented only, all optional, omitted when unset: anthropic `/v1/messages` → `output_config.effort`; openai chat → `reasoning_effort`; responses adapter → `reasoning.effort`; meta chat path → `reasoning_effort`.
- Meta Muse Spark: `none` returns 400, UI excludes `none` for Muse models.
- Sign-in buys project sync only; relay requires no session; chat runs on the user's own provider key. Remove `Not signed in — chat turns need an account.` copy.

---

### Task 1: Effort plumbing in agent-loop (JS)

**Files:**
- Modify: `packages/agent-loop/src/providers.js`
- Modify: `packages/agent-loop/src/responses.js`
- Modify: `packages/agent-loop/test/providers.test.js`

**Interfaces:**
- Consumes: existing `createProvider({kind, apiKey, model, baseUrl?, sessionId?})` routing.
- Produces: `createProvider` accepts optional `effort?: string`; adapters include documented param only when set. Same signature mirrored in Task 2 TS.

- [ ] **Step 1: Write the failing test**

```js
// append in packages/agent-loop/test/providers.test.js inside describe('providers')
it('anthropic: maps effort to output_config.effort and omits when unset', async () => {
  fetchMock.mockResolvedValue(new Response(sseBody('')))
  const p = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test', effort: 'high' })
  for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).output_config).toEqual({ effort: 'high' })
})
it('openai: maps effort to reasoning_effort and omits when unset', async () => {
  const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const p = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test', effort: 'medium' })
  for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('medium')
  fetchMock.mockClear()
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const q = createProvider({ kind: 'openai', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
  for await (const e of q.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort')
})
it('responses: maps effort to reasoning.effort and omits when unset', async () => {
  const body = `data: {"type":"response.completed"}\n\n`
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const p = createProvider({ kind: 'meta', apiKey: 'k', model: 'muse-spark-1.3', effort: 'low' })
  for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: 'low' })
})
it('meta chat path: maps effort to reasoning_effort', async () => {
  const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const p = createProvider({ kind: 'meta', apiKey: 'k', model: 'some-chat-model', effort: 'xhigh' })
  for await (const e of p.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('xhigh')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-loop && npx vitest run test/providers.test.js`
Expected: FAIL — `output_config` / `reasoning_effort` / `reasoning` missing.

- [ ] **Step 3: Write minimal implementation**

In `packages/agent-loop/src/providers.js`, in `anthropicProvider` after `if (tools.length...)` line add:
```js
if (config.effort) body.output_config = { effort: config.effort }
```
In `openaiProvider` after tools line add:
```js
if (config.effort) body.reasoning_effort = config.effort
```
In `packages/agent-loop/src/responses.js` after tools line add:
```js
if (config.effort) body.reasoning = { effort: config.effort }
```
Update the JSDoc for `createProvider` in providers.js to include `effort?:string`:
```js
* @param {{kind:'anthropic'|'openai'|'opencode-go'|'meta',apiKey:string,model:string,baseUrl?:string,sessionId?:string,effort?:string}} config
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-loop && npx vitest run test/providers.test.js`
Expected: PASS (all 15+ tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/src/responses.js packages/agent-loop/test/providers.test.js
git commit -m "feat(agent-loop): optional effort mapping per documented provider params"
```

### Task 2: Effort plumbing in server providers (TS)

**Files:**
- Modify: `apps/jscad-web/server/src/providers/types.ts`
- Modify: `apps/jscad-web/server/src/providers/anthropic.ts`
- Modify: `apps/jscad-web/server/src/providers/openaiCompatible.ts`
- Modify: `apps/jscad-web/server/src/providers/responses.ts`
- Modify: `apps/jscad-web/server/test/providers.test.ts`

**Interfaces:**
- Consumes: Task 1 signature `effort?: string`.
- Produces: TS `ProviderConfig { ..., effort?: string }` with identical wire mapping.

- [ ] **Step 1: Write the failing test**

```ts
// append inside describe('createProvider') or providers suite in apps/jscad-web/server/test/providers.test.ts
it('maps effort to the documented param per adapter', async () => {
  (globalThis.fetch as unknown as Mock).mockResolvedValue(new Response(''))
  const a = createProvider({ kind: 'anthropic', apiKey: 'k', model: 'm', baseUrl: 'https://r.test', effort: 'high' })
  for await (const e of a.send([{ role: 'user', content: 'hi' }], [])) void e
  expect(JSON.parse((globalThis.fetch as unknown as Mock).mock.calls[0][1].body as string).output_config).toEqual({ effort: 'high' })
})
```

Read the existing test file first for its fetch-mock idiom and mirror it; add three more cases: openai `reasoning_effort`, responses `reasoning.effort`, unset omits all three keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web/server && npx vitest run test/providers.test.ts`
Expected: FAIL with missing `output_config`.

- [ ] **Step 3: Write minimal implementation**

`types.ts`: add `effort?: string` to `ProviderConfig`.
`anthropic.ts` after tools line: `if (config.effort) body.output_config = { effort: config.effort }`.
`openaiCompatible.ts` after tools line: `if (config.effort) body.reasoning_effort = config.effort`.
`responses.ts` after tools line: `if (config.effort) body.reasoning = { effort: config.effort }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web/server && npx vitest run test/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/server/src/providers/ apps/jscad-web/server/test/providers.test.ts
git commit -m "feat(server): optional effort mapping per documented provider params"
```

### Task 3: Relay GET route for model lists

**Files:**
- Modify: `apps/jscad-web/server/src/relay/routes.ts`
- Modify: `apps/jscad-web/server/test/relay.test.ts`

**Interfaces:**
- Consumes: existing `mountRelayRoutes` POST guards (trusted origin, limiter, header allowlist, no secret logging).
- Produces: `GET /api/relay/:kind/*` with identical guards, forwarding to `{upstream}/{splat}`.

- [ ] **Step 1: Write the failing test**

```ts
it('GETs a model list through the relay with the same guards', async () => {
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: new Response(JSON.stringify({ data: [] })).body }) as unknown as Response)
  const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Origin', 'https://app.test').set('Authorization', 'Bearer sk-x')
  expect(res.status).toBe(200)
  expect(fetchMock).toHaveBeenCalledWith('https://upstream.test/v1/models', expect.objectContaining({ method: 'GET' }))
})
it('refuses GET from an untrusted origin', async () => {
  const res = await request(relayApp([])).get('/api/relay/openai/v1/models').set('Origin', 'https://evil.test')
  expect(res.status).toBe(403)
  expect(fetchMock).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web/server && npx vitest run test/relay.test.ts`
Expected: FAIL with 404 (no GET route).

- [ ] **Step 3: Write minimal implementation**

In `routes.ts`:
1. Change OPTIONS `Access-Control-Allow-Methods` to `'GET,POST,OPTIONS'`.
2. Extract the POST handler body into a shared `forward(req, res, method)` closure that picks between `body: method === 'GET' ? undefined : JSON.stringify(...)` and identical origin/limiter/allowlist/header/DNS/logging logic.
3. Register both `app.post('/api/relay/:kind/*splat', ...)` and `app.get('/api/relay/:kind/*splat', ...)` calling `forward` with the right method.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web/server && npx vitest run test/relay.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/server/src/relay/routes.ts apps/jscad-web/server/test/relay.test.ts
git commit -m "feat(relay): GET passthrough for model lists under existing guards"
```

### Task 4: Drawer header + gear dialog shell in aiAccount.js

**Files:**
- Modify: `apps/jscad-web/src/aiAccount.js`
- Create: `apps/jscad-web/test/aiAccount.test.js`
- Read for reference: `apps/jscad-web/src/aiChat.js:10-13` (`relayBaseUrl`), `apps/jscad-web/main.js:855-868` (init wiring).

**Interfaces:**
- Consumes: `keyStore`, `getSelection` shape, `getSession`.
- Produces: header row (`Sign in to Sync` / email+Sign out, gear button), Provider row, `<dialog>` with key/custody/model/baseUrl/effort controls; `getProviderConfig()` returns `{kind, model, baseUrl?, effort?, apiKey}` or null.

- [ ] **Step 1: Write the failing test**

```js
// apps/jscad-web/test/aiAccount.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { initAccount, getProviderConfig } from '../src/aiAccount.js'
vi.mock('@jscadui/key-store', () => {
  let mem = null
  return { createKeyStore: () => ({ get: () => mem, set: async (k) => { mem = k }, clear: () => { mem = null }, unlock: async () => { mem = 'k' } }) }
})
describe('account header', () => {
  beforeEach(() => { localStorage.clear(); globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 401 })) })
  it('shows one header row with sign-in and gear, no account-needed copy', async () => {
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/Sign in to Sync/))
    expect(document.querySelector('.ai-gear')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/chat turns need an account/)
  })
  it('returns null provider config without key or model', () => {
    expect(getProviderConfig()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js`
Expected: FAIL with "Cannot find module ../src/aiAccount" internals or missing `.ai-gear`.

- [ ] **Step 3: Write minimal implementation**

Rewrite `initAccount` in `apps/jscad-web/src/aiAccount.js`:
1. Header: `div.ai-header-row` with sign-in button (`Sign in to Sync`, or `email` + `Sign out` when session) left, gear button (`⚙`, class `ai-gear`) right opening a `<dialog>`.
2. Below: single Provider row (`select` with the 4 kinds, persisted to selection).
3. Dialog contains, in need-order: API key + Save (custody `session/device/synced` + passphrase + Forget unchanged), Model control (select + free-text fallback input), advanced `<details>` with Base URL, Effort select (hidden until Task 5 fills it).
4. `getProviderConfig` adds `effort` when selection has one: `return { kind, model, ...(baseUrl ? { baseUrl } : {}), ...(effort ? { effort } : {}), apiKey }`.
5. Remove the `Not signed in — chat turns need an account.` string; signed-out line reads `Not signed in — sync is off, chat still works with your key.`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiAccount.js apps/jscad-web/test/aiAccount.test.js
git commit -m "feat(chat): gear-gated account dialog with truthful sync copy"
```

### Task 5: Relay model fetch + effort dropdown

**Files:**
- Modify: `apps/jscad-web/src/aiAccount.js`
- Modify: `apps/jscad-web/test/aiAccount.test.js`
- Create: `apps/jscad-web/src/aiEffort.js`

**Interfaces:**
- Consumes: `relayBaseUrl(kind)` from `src/aiChat.js` (import it; break no cycles — aiChat must not import aiAccount), selection `{kind, model, baseUrl, effort}`, key from `keyStore.get()`.
- Produces: `effortOptionsForModel({kind, modelId, capabilities})` → string[]; dialog fetches `{root}/v1/models` via relay on open when key set.

- [ ] **Step 1: Write the failing test**

```js
import { effortOptionsForModel, OPENAI_STYLE_EFFORTS } from '../src/aiEffort.js'
// anthropic capabilities drive the list
expect(effortOptionsForModel({ kind: 'anthropic', modelId: 'x', capabilities: { effort: { low: { supported: true }, medium: { supported: true }, high: { supported: false }, xhigh: { supported: false }, max: { supported: false } } } })).toEqual(['low', 'medium'])
// openai-style lists show the documented set
expect(effortOptionsForModel({ kind: 'openai', modelId: 'gpt-x', capabilities: null })).toEqual(OPENAI_STYLE_EFFORTS)
// muse spark excludes none
expect(effortOptionsForModel({ kind: 'meta', modelId: 'muse-spark-1.3', capabilities: null })).not.toContain('none')
```

Plus a jsdom case: with key set and relay stub returning `{data:[{id:'m1'}]}`, opening the gear dialog populates the model select; on fetch failure the free-text input keeps the saved value.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js src/aiEffort.test.js`
Expected: FAIL with missing module `../src/aiEffort.js`.

- [ ] **Step 3: Write minimal implementation**

`src/aiEffort.js`:
```js
export const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
export const OPENAI_STYLE_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh']
const MUSE_RE = /muse/i
export const effortOptionsForModel = ({ kind, modelId = '', capabilities = null }) => {
  let levels
  if (capabilities?.effort && typeof capabilities.effort === 'object') {
    levels = EFFORT_LEVELS.filter((l) => capabilities.effort[l]?.supported)
  } else {
    levels = [...OPENAI_STYLE_EFFORTS]
  }
  if (MUSE_RE.test(modelId)) levels = levels.filter((l) => l !== 'none')
  return levels
}
```
In `aiAccount.js` dialog open handler: when `keyStore.get()` is set, `fetch` `${baseOverride || relayBaseUrl(kind)}/v1/models` with the provider auth header (`x-api-key` for anthropic, `Authorization: Bearer` otherwise); on success fill model `<select>` (keep saved value selected, fallback free-text input untouched); on failure keep free-text with saved value. Effort `<select>` shown only when `effortOptionsForModel(...)` is non-empty for the chosen model; persist to selection on change; clear effort when model changes to one without support.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiAccount.js apps/jscad-web/src/aiEffort.js apps/jscad-web/test/aiAccount.test.js
git commit -m "feat(chat): relay model list with per-model effort options"
```

### Task 6: Wire effort through chat turn + validate

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js` (pass `effort` — already spreads `...selection`, verify no stripping)
- Modify: `apps/jscad-web/test/aiChat.test.js` (effort passthrough case)
- Run: full `npm run validate` equivalent per package.

**Interfaces:**
- Consumes: `getProviderConfig()` with `effort` from Task 4, `createProvider` with `effort` from Task 1.
- Produces: relay chat turns carry the documented effort param; nothing sent when unset.

- [ ] **Step 1: Write the failing test**

```js
it('passes effort from selection into the provider body', async () => {
  const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
  vi.stubGlobal('fetch', fetchMock)
  document.body.innerHTML = '<div id="chat"></div>'
  initChat({ container: document.getElementById('chat'), requestTool: async () => '{}',
    getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test', effort: 'high' }),
    runTurnFn: async ({ provider }) => { for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e; return { messages: [] } } })
  document.querySelector('.chat-input').value = 'hi'
  document.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('high')
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js`
Expected: FAIL if aiChat strips unknown fields (currently spreads, so may pass — then keep the test as regression).

- [ ] **Step 3: Write minimal implementation**

No change expected (`createProvider({ ...selection, baseUrl, sessionId })` already forwards `effort`); if the test fails, remove any field allowlist so `effort` flows through.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js test/aiAccount.test.js`
Expected: PASS.
Run: `cd packages/agent-loop && npx vitest run` and `cd apps/jscad-web/server && npx vitest run` — all green.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/test/aiChat.test.js apps/jscad-web/src/aiChat.js
git commit -m "test(chat): effort flows from selection to provider turn"
```

## Self-Review

- Spec §1 (header row, provider row, copy removal) → Task 4.
- Spec §2 (key+custody unchanged, model fetch w/ fallback, base URL collapsible, effort gated) → Tasks 4–5.
- Spec §3 (four adapter mappings, omit-when-unset, Muse `none` exclusion, capabilities-driven options) → Tasks 1–2 + 5.
- Spec §4 (GET relay route under existing rules) → Task 3.
- No placeholders; exact paths, code, and commands per step; `effort?: string` consistent across JS/TS and `getProviderConfig`.
