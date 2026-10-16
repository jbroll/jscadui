# jscad-web inference reframe Implementation Plan (v2: single endpoint + hook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The jscad-web free inference provider is first-class on the single relay endpoint family, specialized by a backend provider hook.

**Architecture:** One endpoint family `POST|GET /api/relay/:kind/*` for every provider. A hook table in `server/src/relay/providers/` dispatches by `kind`: default passthrough hook (forward client key, log only on `x-jscad-chat-id`) and the `jscad-web` hook (ignore `jscad-web-free` sentinel, resolve per-model upstream from `jscad-inference.json`, pin model/endpoint/caps, enforce meter, always log). No `/api/relay/inference*` or `/api/relay/shared*` routes. Client selection `kind` is `jscad-web` (first-class); `createProvider` routes it by model id on the shared opencode-go/meta arm; free turns always carry an explicit `baseUrl` at `.../api/relay/jscad-web/<option-id>`; UI shows `jscad-web · <label>`.

**Tech Stack:** Plain JS + JSDoc relay modules, Express routes.ts, vanilla web client, vitest.

**Spec:** Chat directives 2026-10-16: uniform provider API in the UI (`jscad-web-free` sentinel swapped server-side; any provider recordable with permission, jscad-web always recorded); jscad first-class in backend; backend provider hook for key substitution + recording; single endpoint with hook specialization.

## Global Constraints

- Single endpoint family only: `POST|GET /api/relay/:kind/*`. No second route family.
- Relay never trusts the client key for free turns: hook drops `authorization`/`x-api-key`, injects the server key as `Bearer`.
- Path pinning stays: free sub-path after `<id>/` must exactly equal the option's derived `path`, else 404.
- Free turns always logged with `inference` + `costUsd`, with or without chat id. Own-key turns log only with chat id.
- Budgets unchanged: monthly + per-IP daily meter, 402 `inference_quota_exhausted`, max 2 in flight per IP group.
- Sentinel canonical value: `jscad-web-free`. Server ignores its value.
- Run owning tests before each commit.

## Naming map (final, verbatim)

- Config module `server/src/relay/inference.js`: `DEFAULT_INFERENCE_PATH='/etc/jscad-relay/jscad-inference.json'`, `INFERENCE_KINDS` (underlying `opencode-go`/`meta`), `parseInferenceConfig`, `loadInferenceFile`, error prefix `relay: inference ...`. Staging file `server/jscad-inference.local.json`. Env `RELAY_INFERENCE` (fallback deprecated `RELAY_SHARED`).
- Hook dir `server/src/relay/providers/`: `index.js` (`getHook(kind)`), `default.js` (passthrough), `jscad.js` (free specialization). Option `kind` values remain underlying protocols; hook key is `jscad-web`.
- Wire: catalog `GET /api/relay/jscad-web/v1/models` returns array `[{id,label,kind,model,available}]` (hook-served, never proxied, never keys/prices). Free turn base `POST {root}/api/relay/jscad-web/<id>` + agent-loop path suffix; hook parses `id` = first segment, verifies remainder `=== option.path`.
- Log/metrics: record field `inference`; code `inference_quota_exhausted`; logger `inference-config-error`, `relay: 'inference:<id>'`.
- Client: `inferenceListUrl()` = `{root}/api/relay/jscad-web/v1/models`; `loadInferenceOptions()`; `isFreeSelection()` = `free === true` only, no migration (stale records fail closed); `FREE_API_KEY='jscad-web-free'`; `FREE_PREFIX='jscad-web:'`; selection `{kind:'jscad-web', model, inference:<id>, free:true}`; `relayBaseUrl(selection)` builds free base as above; `INFERENCE_QUOTA_MESSAGE='This free model is out of budget right now. Add your own key in Chat settings to keep chatting.'`; `CHAT_FREE_NOTICE='Free jscad-web models share conversations to improve the assistant.'`; `FREE_NOTICE_MESSAGE='Free model sessions share conversations. Accept the free-model notice to send a message.'`; consent ack copy `Free model sessions share conversations to improve jscad-web and cannot be opted out.`
- UI: `jscad-web · <label>` in select/summary/info; `monthly limit reached` parenthetical kept. Relay-owned controls (key, custody, base URL, model) stay visible but `disabled` for free, never hidden; effort stays enabled.

## Review Focus

- Legacy `{shared, demo:true}` localStorage selections still run as free turns (migrated).
- `402 inference_quota_exhausted` renders the free-budget message.
- Free catalog never leaks keys/prices; missing file yields `[]`, never page 500.
- A free POST with wrong trailing path (`<id>/v1/wrong`) is 404, never forwarded with the injected key.
- Free turn without chat id is still logged with `inference` + `costUsd`.

---

### Task 1 (rework): Single-endpoint hook in server relay

**Files:**
- Modify: `apps/jscad-web/server/src/relay/routes.ts`
- Create: `apps/jscad-web/server/src/relay/providers/index.js`, `apps/jscad-web/server/src/relay/providers/default.js`, `apps/jscad-web/server/src/relay/providers/jscad.js`
- Modify: `apps/jscad-web/server/src/relay/inference.js` (as needed by hook; already renamed from shared.js on this branch)
- Modify: `apps/jscad-web/server/src/relay/chatLog.js`, `apps/jscad-web/server/src/config.ts` (env only)
- Modify: `apps/jscad-web/server/test/inference.test.ts`, `apps/jscad-web/server/test/relay.test.ts`, `+ new server/test/providers.test.ts` (or fold into relay.test.ts), `meter.test.ts` / `chatLog.test.js` / `config.test.ts` as needed
- Delete: any `/api/relay/inference*` or `/api/relay/shared*` routes if present on the branch

**Model:** sonnet — routing surgery with security pinning.

**Interfaces:**
- Consumes: allowlist table, `loadInferenceFile`, meter, `teeRelayUpstream`.
- Produces: `getHook(kind)` → `{ serveGET?, servePOST }`; jscad hook serving `GET jscad-web/v1/models` catalog + free POSTs; default hook preserving current own-key behavior byte-for-byte.

- [ ] **Step 1: Write the failing test** — `server/test/relay.test.ts` (or new `providers.test.ts`): `GET /api/relay/jscad-web/v1/models` returns the stubbed free array; `POST /api/relay/jscad-web/<id>/<option.path>` injects the server key (upstream sees `Bearer <server-key>`, never the sentinel), pins model, always logs with `inference`; `POST .../<id>/v1/wrong` is 404 with no upstream fetch; own-key `POST /api/relay/openai/v1/chat/completions` still forwards client auth and logs only with chat id.
- [ ] **Step 2: Run it to verify it fails** — Run: `npx vitest run server/test/relay.test.ts` in `apps/jscad-web`. Expected: FAIL.
- [ ] **Step 3: Implement the hook table + collapse routes** — create `providers/` trio; `routes.ts` keeps only `POST|GET /api/relay/:kind/*` (+ OPTIONS/CORS) and dispatches to hooks; remove any `/api/relay/inference*` family; jscad hook owns catalog GET, id-split, path pin, body rewrite, auth swap, meter (check/charge/settle incl. abort paths), always-log, 402/404/429 shapes.
- [ ] **Step 4: Update remaining server tests** — inference/meter/chatLog/config tests to new paths/names; no `/api/relay/shared` or `/api/relay/inference` references outside legacy-migration notes.
- [ ] **Step 5: Run server tests** — Run: `npx vitest run server/test/` in `apps/jscad-web`. Expected: PASS (except known `better-sqlite3` self-register env failures if present — note them).
- [ ] **Step 6: Commit** — `git add apps/jscad-web/server && git commit -m "refactor(relay): single endpoint with jscad-web provider hook"`

### Task 2: Web client on the single endpoint

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js`, `apps/jscad-web/src/aiAccount.js`, `apps/jscad-web/src/aiConsent.js`
- Modify: `apps/jscad-web/test/aiChat.test.js`, `apps/jscad-web/test/aiAccount.test.js`, `apps/jscad-web/test/aiConsent.test.js`, `apps/jscad-web/e2e/ai-chat.spec.js`

**Model:** sonnet — coordinated client + test edits with migration.

**Interfaces:**
- Consumes: Task 1 wire (catalog array at `GET /api/relay/jscad-web/v1/models`, free base `{root}/api/relay/jscad-web/<id>`, code `inference_quota_exhausted`).
- Produces: uniform `getProviderConfig()` (`{kind (underlying), model, apiKey, [baseUrl], [effort], [inference, free:true]}`), free base builder, `isFreeSelection()` with legacy migration, `jscad-web ·` UI, free-always-recorded lock.

- [ ] **Step 1: Write the failing test** — stub `GET /api/relay/jscad-web/v1/models` with two options; gear lists `jscad-web · DeepSeek v4 flash`; select stores `{inference, free:true}`; legacy `{shared, demo:true}` migrates to working free config with `apiKey:'jscad-web-free'`; free turn POSTs `{root}/api/relay/jscad-web/deepseek/v1/chat/completions`.
- [ ] **Step 2: Run it to verify it fails** — Run: `npx vitest run test/aiAccount.test.js` in `apps/jscad-web`. Expected: FAIL.
- [ ] **Step 3: Implement client rename** — Naming map verbatim; `kind` stays underlying protocol; free hides key/custody/baseURL/model controls; effort via `aiEffort.js`.
- [ ] **Step 4: Update chat/consent/e2e tests** — new URLs, code, copy.
- [ ] **Step 5: Run client tests** — Run: `npx vitest run test/aiAccount.test.js test/aiChat.test.js test/aiConsent.test.js` in `apps/jscad-web`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add apps/jscad-web/src apps/jscad-web/test apps/jscad-web/e2e && git commit -m "refactor(web): jscad-web free inference on single relay endpoint"`

### Task 3: Docs + operator files

**Files:**
- Modify: `apps/jscad-web/server/RELAY.md`, `apps/jscad-web/docs/architecture.md`, `apps/jscad-web/scripts/pull-chat-logs.sh` (comment)

**Model:** haiku — transcription with exact names.

- [ ] **Step 1: Update `server/RELAY.md`** — single endpoint + hook table + `jscad-inference.json` + `RELAY_INFERENCE` + catalog/turn examples + `inference` log field.
- [ ] **Step 2: Update `docs/architecture.md` + pull-script comment** — free-model service framing, no custody language.
- [ ] **Step 3: Verify** — Run: `grep -RIn "api/relay/shared\|api/relay/inference\|shared_quota_exhausted\|demo-limited-free\|Demo: \|Shared:" apps/jscad-web/server apps/jscad-web/src apps/jscad-web/test apps/jscad-web/e2e apps/jscad-web/docs apps/jscad-web/server/RELAY.md | grep -v node_modules | grep -v dist`. Expected: no hits except legacy-migration code paths + deprecated `RELAY_SHARED` fallback.
- [ ] **Step 4: Commit** — `git add apps/jscad-web/server/RELAY.md apps/jscad-web/docs apps/jscad-web/scripts && git commit -m "docs: jscad-web inference single-endpoint hook"`

---

### Task 4: First-class `jscad-web` kind + disabled (not hidden) free controls

**Files:**
- Modify: `packages/agent-loop/src/providers.js`, `packages/agent-loop/src/responses.js` (JSDoc only if needed)
- Modify: `packages/agent-loop/test/providers.test.js`
- Modify: `apps/jscad-web/src/aiAccount.js`, `apps/jscad-web/src/aiChat.js` (comments only if needed)
- Modify: `apps/jscad-web/test/aiAccount.test.js`, `apps/jscad-web/test/aiChat.test.js`, `apps/jscad-web/test/aiConsent.test.js` (only where free `kind` is asserted)
- Modify: `apps/jscad-web/e2e/ai-chat.spec.js` (only if it asserts a free selection `kind`)
- Modify: `apps/jscad-web/server/RELAY.md` (one-line kind-semantics note)
- Do NOT modify: `PROVIDER_BASE_URLS` (agent-loop or relay policy), `KINDS`, catalog entry `kind` values, hook routing, selection shape fields.

**Model:** sonnet — protocol reasoning across two packages plus dialog state.

**Interfaces:**
- Consumes: Tasks 1-3 wire (`GET /api/relay/jscad-web/v1/models`, free base `{root}/api/relay/jscad-web/<id>`, sentinel `jscad-web-free`).
- Produces: `createProvider({kind:'jscad-web', ...})` routing by model id; free selections storing `kind:'jscad-web'`; free dialog controls disabled, visible, and inert.

**Decisions (verbatim, do not reinterpret):**
- `jscad-web` joins the `case 'opencode-go': case 'meta':` arm in `createProvider` (model-id routing: `RESPONSES_MODELS` → responses, `MESSAGES_MODELS` → anthropic, else chat). Update the `createProvider` JSDoc kind union + `responses.js` JSDoc if it names kinds.
- `jscad-web` joins the `x-opencode-session` conditions (2 spots: anthropic + chat adapters) and the `stream_options.include_usage` condition (chat adapter), with a comment that free models are zen-served and the relay forwards the header.
- No `PROVIDER_BASE_URLS['jscad-web']`: free turns always carry an explicit `baseUrl`, so the fallback never fires; a missing base fails loudly instead of pointing somewhere wrong.
- `aiAccount.js` free select stores `state.kind = 'jscad-web'` (not `option.kind`); `getProviderConfig` passes it through; `relayBaseUrl` free branch unchanged.
- `applyFreeState`: replace every `display:none` with `disabled = free` on the controls (`key`, `mode`, `passphrase`, `saveKey`, `clearKey`, `modelSelect`, `modelInput`, `baseUrl`); wrappers/fields stay visible; `freeInfo`, effort, and the record-toggle lock behave exactly as today.
- Effort, placeholders, model-list skip, and consent logic need no changes (`jscad-web` falls into the non-anthropic effort default; `modelPlaceholders[state.kind] ?? ''` already guards).

- [ ] **Step 1: Write the failing tests**
  - agent-loop `test/providers.test.js`: `createProvider({kind:'jscad-web', apiKey:'k', model:'deepseek-v4.1-flash', baseUrl})` sends chat-completions with `authorization: Bearer k`, `x-opencode-session`, and `stream_options.include_usage`; `model:'muse-spark-1.3-contributor'` uses the responses adapter; `model:'minimax-m3'` uses the messages adapter with the session header.
  - web `test/aiAccount.test.js`: selecting a free option stores `{kind:'jscad-web', model, inference, free:true}` and returns config with `kind:'jscad-web'`; relay-owned controls are `disabled` (not `display:none`) while free and re-enable on switching back to an own-key provider.
- [ ] **Step 2: Run them to verify they fail** — Run: `npx vitest run test/providers.test.js` in `packages/agent-loop`; `npx vitest run test/aiAccount.test.js` in `apps/jscad-web`. Expected: FAIL.
- [ ] **Step 3: Implement** — providers.js arm + conditions + JSDoc; aiAccount free-kind + disabled controls.
- [ ] **Step 4: Update remaining assertions** — any test/e2e expecting a free `kind` of `opencode-go`/`meta` becomes `jscad-web`; RELAY.md one-liner: catalog entry `kind` is the upstream protocol, client selection `kind` is `jscad-web`.
- [ ] **Step 5: Run suites** — Run: `npx vitest run` in `packages/agent-loop`; `npx vitest run test/aiAccount.test.js test/aiChat.test.js test/aiConsent.test.js` in `apps/jscad-web`; `npx vitest run test/providers.test.ts test/inference.test.ts test/config.test.ts` in `apps/jscad-web/server`. Expected: PASS.
- [ ] **Step 6: Commit** — `git add packages/agent-loop apps/jscad-web && git commit -m "refactor: jscad-web as first-class provider kind, disable free controls"`

---

### Task 5: Uniform dialog — one `jscad-web` row, model menu from catalog

Single provider row (`KINDS` includes `jscad-web` first); the shared model menu fills from the relay catalog with labels and month-limit disabling; relay-owned controls stay visible but disabled (model menu enabled); fixed sentinel shown via the key line; `freeInfo` removed. No `PROVIDER_BASE_URLS['jscad-web']` (free turns always carry `baseUrl`); relay allowlist invariant updated for the relay-served kind.
