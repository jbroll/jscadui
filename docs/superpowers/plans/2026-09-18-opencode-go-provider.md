# opencode-go Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept `opencode-go` as a provider kind in the agent-loop package, the studio server, and the web account panel, resolved through an explicit provider→URL table to the existing OpenAI-compatible adapter.

**Architecture:** No new wire code: both stacks map `opencode-go` to their existing openai-compatible adapter. A `PROVIDER_BASE_URLS` table in each stack replaces the two hardcoded `DEFAULT_BASE_URL` constants; `createProvider` validates the key and rejects unknown kinds. UI adds the dropdown option; relay needs only an operator allowlist entry (documented, not coded).

**Tech Stack:** Node 22, ES modules, vitest; server TypeScript (tsc, vitest).

**Spec:** `docs/superpowers/specs/2026-09-18-opencode-go-provider-design.md`

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments: none unless they say why, one or two lines.
- Table values are the URL *before* the adapter's `/v1/...` suffix: `'opencode-go': 'https://opencode.ai/zen/go'` (no trailing `/v1`; the adapter appends `/v1/chat/completions`).
- No API key fallbacks: never read `*_API_KEY` env in library or server code; `createProvider` throws when `apiKey` is missing. (`EVAL_API_KEY` at the eval CLI edge is caller-supplied config, not a fallback.)
- Never add live-key tests: all tests use stubbed fetch.
- Branch: current working branch in `/home/john/src/jscadui`. Commit per task.

---

### Task 1: agent-loop lookup table and alias

**Files:**
- Modify: `packages/agent-loop/src/providers.js` (table, adapter URL lines, `createProvider`)
- Modify: `packages/agent-loop/test/providers.test.js` (three new tests)
- Read for reference: `packages/agent-loop/src/providers.js:1-10` (constants), `:55-60` (anthropic fetch), `:140-150` (openai fetch), `:196-208` (`createProvider`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PROVIDER_BASE_URLS` (exported `{ anthropic, openai, 'opencode-go' }` URL map) and `createProvider` accepting `kind: 'opencode-go'` (→ openai adapter), throwing `/apiKey/` when the key is missing and `/unknown kind/` otherwise. Task 2 mirrors this shape in TypeScript.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('providers', ...)` in `packages/agent-loop/test/providers.test.js`:

```js
it('opencode-go resolves the Zen URL through the openai adapter', async () => {
  const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'deepseek-v4-flash' })
  const events = []
  for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://opencode.ai/zen/go/v1/chat/completions',
    expect.objectContaining({ method: 'POST' }),
  )
  expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'stop' })
})

it('an explicit baseUrl overrides the lookup table', async () => {
  const body = `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n` + `data: [DONE]\n\n`
  fetchMock.mockResolvedValue(new Response(sseBody(body)))
  const provider = createProvider({ kind: 'opencode-go', apiKey: 'k', model: 'm', baseUrl: 'https://relay.test' })
  const events = []
  for await (const e of provider.send([{ role: 'user', content: 'hi' }], TOOLS)) events.push(e)
  expect(fetchMock).toHaveBeenCalledWith(
    'https://relay.test/v1/chat/completions',
    expect.objectContaining({ method: 'POST' }),
  )
  expect(events[events.length - 1]).toEqual({ type: 'done', stopReason: 'stop' })
})

it('throws when the apiKey is missing', () => {
  expect(() => createProvider({ kind: 'openai', model: 'm', baseUrl: 'https://relay.test' })).toThrow(/apiKey/)
})
```

Run: `cd packages/agent-loop && npx vitest run test/providers.test.js`
Expected: FAIL (3 failures: `createProvider` rejects kind `opencode-go`; key check missing).

- [ ] **Step 2: Implement the table and alias**

In `packages/agent-loop/src/providers.js`, replace:

```js
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com'
```

with:

```js
const ANTHROPIC_API_VERSION = '2023-06-01'

export const PROVIDER_BASE_URLS = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
}
```

Replace the anthropic fetch URL:

```js
const res = await fetch(`${config.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`, {
```

with:

```js
const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`, {
```

Replace the openai fetch URL:

```js
const res = await fetch(`${config.baseUrl ?? OPENAI_DEFAULT_BASE_URL}/v1/chat/completions`, {
```

with:

```js
const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
```

Replace `createProvider`:

```js
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

with:

```js
export const createProvider = (config) => {
  if (!config.apiKey) throw new Error('createProvider: apiKey is required')
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
    case 'opencode-go':
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd packages/agent-loop && npx vitest run`
Expected: PASS (all files, including the 3 new tests and the existing unknown-kind rejection).

- [ ] **Step 4: Commit**

```bash
git add packages/agent-loop/src/providers.js packages/agent-loop/test/providers.test.js
git commit -m "feat(agent-loop): opencode-go provider kind via URL lookup"
```

---

### Task 2: Server lookup table and alias

**Files:**
- Modify: `apps/jscad-studio/server/src/providers/types.ts` (`ProviderKind`, table, `createProvider`)
- Modify: `apps/jscad-studio/server/src/providers/anthropic.ts` (table import, drop `DEFAULT_BASE_URL`)
- Modify: `apps/jscad-studio/server/src/providers/openaiCompatible.ts` (table import, drop `DEFAULT_BASE_URL`)
- Modify: `apps/jscad-studio/server/test/providers.test.ts` (three new tests in `describe('createProvider')`)
- Read for reference: `apps/jscad-studio/server/test/providers.test.ts:216-235` (`streamResponse`, `collect`, `createProvider` block), `:129-140` (`OPENAI_PLAIN` fixture)

**Interfaces:**
- Consumes: Task 1's shape (`PROVIDER_BASE_URLS`, alias → openai adapter, key required).
- Produces: identical surface in TypeScript. Task 3's UI posts `kind: 'opencode-go'` configs the server already accepts.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('createProvider', ...)` in `apps/jscad-studio/server/test/providers.test.ts`:

```ts
it('opencode-go posts to the Zen URL through the openai adapter', async () => {
  fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))
  const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'deepseek-v4-flash' })
  await collect(provider)
  expect(fetchMock.mock.calls[0][0]).toBe('https://opencode.ai/zen/go/v1/chat/completions')
})

it('an explicit baseUrl overrides the lookup table', async () => {
  fetchMock.mockResolvedValueOnce(streamResponse(OPENAI_PLAIN))
  const provider = createProvider({ kind: 'opencode-go', apiKey: 'sk-test', model: 'm', baseUrl: 'https://provider.test' })
  await collect(provider)
  expect(fetchMock.mock.calls[0][0]).toBe('https://provider.test/v1/chat/completions')
})

it('throws when the apiKey is missing', () => {
  expect(() => createProvider({ kind: 'openai', model: 'm', baseUrl: 'https://provider.test' })).toThrow(/apiKey/)
})
```

Run: `cd apps/jscad-studio/server && npx vitest run test/providers.test.ts`
Expected: FAIL (unknown kind `opencode-go`; no key check).

- [ ] **Step 2: Implement the table and alias**

In `apps/jscad-studio/server/src/providers/types.ts`, replace:

```ts
export type ProviderKind = 'anthropic' | 'openai'
```

with:

```ts
export type ProviderKind = 'anthropic' | 'openai' | 'opencode-go'

export const PROVIDER_BASE_URLS: Record<ProviderKind, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  'opencode-go': 'https://opencode.ai/zen/go',
}
```

Replace `createProvider`:

```ts
export function createProvider(config: ProviderConfig): Provider {
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

with:

```ts
export function createProvider(config: ProviderConfig): Provider {
  if (!config.apiKey) throw new Error('createProvider: apiKey is required')
  switch (config.kind) {
    case 'anthropic':
      return anthropicProvider(config)
    case 'openai':
    case 'opencode-go':
      return openaiProvider(config)
    default:
      throw new Error(`createProvider: unknown kind '${config.kind}'`)
  }
}
```

In `apps/jscad-studio/server/src/providers/anthropic.ts`, replace:

```ts
import { ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'
```

with:

```ts
import { PROVIDER_BASE_URLS, ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

const API_VERSION = '2023-06-01'
```

and replace:

```ts
const res = await fetch(`${config.baseUrl ?? DEFAULT_BASE_URL}/v1/messages`, {
```

with:

```ts
const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS.anthropic}/v1/messages`, {
```

In `apps/jscad-studio/server/src/providers/openaiCompatible.ts`, replace:

```ts
import { ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'

const DEFAULT_BASE_URL = 'https://api.openai.com'
```

with:

```ts
import { PROVIDER_BASE_URLS, ssePayloads } from './types.js'
import type { Provider, ProviderConfig, ProviderMessage, ToolDefinition } from './types.js'
```

and replace:

```ts
const res = await fetch(`${config.baseUrl ?? DEFAULT_BASE_URL}/v1/chat/completions`, {
```

with:

```ts
const res = await fetch(`${config.baseUrl ?? PROVIDER_BASE_URLS[config.kind]}/v1/chat/completions`, {
```

- [ ] **Step 3: Run the tests**

Run: `cd apps/jscad-studio/server && npx vitest run`
Expected: PASS (whole server suite, including the 3 new tests; the existing anthropic default-URL assertion still resolves through the table).

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-studio/server/src/providers apps/jscad-studio/server/test/providers.test.ts
git commit -m "feat(studio-server): opencode-go provider kind via URL lookup"
```

---

### Task 3: Web dropdown and relay doc

**Files:**
- Modify: `apps/jscad-web/src/aiAccount.js:108-119` (kind options, model placeholder)
- Modify: `apps/jscad-studio/server/RELAY.md` (allowlist example)
- Read for reference: `apps/jscad-web/src/aiChat.js:10-13` (`relayBaseUrl(kind)` — unchanged; the new kind flows through it with no code change)

**Interfaces:**
- Consumes: Tasks 1–2 (kind accepted by both provider stacks).
- Produces: selectable `opencode-go` in the account panel; operator doc for the relay entry. No new exports.

- [ ] **Step 1: Add the dropdown option and per-kind placeholder**

In `apps/jscad-web/src/aiAccount.js`, replace:

```js
container.append(el('h3', 'ai-section-title', 'Model'))
const selection = getSelection()
const kind = el('select', 'ai-input')
for (const value of ['anthropic', 'openai']) {
  const option = el('option', '', value)
  option.value = value
  kind.append(option)
}
kind.value = selection.kind ?? 'anthropic'
const model = textInput(selection.model ?? '', 'claude-sonnet-4-5')
```

with:

```js
container.append(el('h3', 'ai-section-title', 'Model'))
const modelPlaceholders = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o', 'opencode-go': 'deepseek-v4-flash' }
const selection = getSelection()
const kind = el('select', 'ai-input')
for (const value of ['anthropic', 'openai', 'opencode-go']) {
  const option = el('option', '', value)
  option.value = value
  kind.append(option)
}
kind.value = selection.kind ?? 'anthropic'
const model = textInput(selection.model ?? '', modelPlaceholders[selection.kind] ?? 'claude-sonnet-4-5')
kind.addEventListener('change', () => {
  model.placeholder = modelPlaceholders[kind.value] ?? ''
})
```

The existing `kind.addEventListener('change', persistSelection)` on the later line stays as-is; the two listeners compose.

- [ ] **Step 2: Document the relay entry**

In `apps/jscad-studio/server/RELAY.md`, replace:

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com" }
```

with:

```json
{ "anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com", "opencode-go": "https://opencode.ai/zen/go" }
```

The allowlist file itself (`/etc/jscad-relay/providers.json`, `RELAY_ALLOWLIST` override) is operator config, not repo code: no repo file to change. Browser turns use `relayBaseUrl('opencode-go')` → `/api/relay/opencode-go/...`, which the kind-agnostic relay resolves once the operator adds the entry.

- [ ] **Step 3: Verify**

Run: `cd packages/agent-loop && npx vitest run` then `cd ../.. && npm run typecheck`
Expected: PASS both. No new tests in this task (dropdown is untested UI; relay routes are kind-agnostic and already covered).

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/src/aiAccount.js apps/jscad-studio/server/RELAY.md
git commit -m "feat(jscad-web): opencode-go in provider dropdown, relay doc"
```

---

## Order and checkpoints

- Tasks 1 and 2 are independent parallel implementations of the same shape; Task 3 needs both (it posts a kind both must accept).
- After Task 2, the full server suite must stay green (relay tests are kind-agnostic; only provider tests gain cases).
- After Task 3, manual check (no key needed for the check itself): select `opencode-go` in the account panel and confirm the model placeholder switches; the live turn stays a keyed manual run, never CI.
