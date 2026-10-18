# Websearch browser-pool fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore keyless browser websearch and replace the misleading `every provider failed or is cooling down` error with per-provider detail.

**Architecture:** Keep `packages/agent-loop/src/websearch.js` as the single MCP client; add per-provider arg builders + `Accept: application/json, text/event-stream` header, drop Firecrawl from keyless pool (now OAuth-only), and return structured failure detail that `apps/jscad-web/src/aiSearch.js` surfaces.

**Tech Stack:** Node/fetch JSON-RPC (Streamable HTTP MCP), vitest, Playwright e2e stubs.

**Spec:** `docs/superpowers/specs/2026-10-15-websearch-design.md`

## Global Constraints

- TDD per repo rule; every changed file gets its test change in the same commit.
- Fail-closed: no grant → no search; no usable provider → `toolError`, never throw, never silent empty success.
- Secrets: keys in memory/localStorage only; never in transcripts, logs, fixtures, URLs (except Tavily documented `?tavilyApiKey=` on direct-Node path), or error messages.
- Two-deps-objects rule: page handler and eval/Node handler stay in sync.
- Existing suites green (`packages/agent-loop/test/websearch.test.js`, `apps/jscad-web/test/aiSearch.test.js`, `apps/jscad-web/e2e/ai-chat-tools.spec.js`).

## Review Focus

- Exa 406 without Accept header → expect success when Accept is sent.
- Parallel `isError: missing objective/search_queries` → expect mapped args to succeed.
- Firecrawl 401 keyless → expect keyless pool excludes firecrawl, keyed path preserved.
- All-providers-fail message lists per-provider status → expect `details: [{provider, status}]` in error.
- Empty query still ValidationError with zero fetch calls.

---

### Task 1: MCP transport + per-provider args

**Files:**
- Modify: `packages/agent-loop/src/websearch.js:64-96,165-191`
- Test: `packages/agent-loop/test/websearch.test.js`

**Model:** `sonnet` — multi-provider arg mapping + header change needs judgment.

**Interfaces:**
- Consumes: MCP `tools/list` schemas (Exa requires `query+objective`, Parallel requires `objective+search_queries`).
- Produces: `mcpCall(url, tool, args, opts)` always sends `Accept: application/json, text/event-stream`; `buildArgs(provider, query, count)` exported for tests.

- [x] **Step 1: Write failing tests** in `packages/agent-loop/test/websearch.test.js`: Exa called with `{query, objective, numResults}`, Parallel called with `{objective, search_queries}`, fetch headers contain Accept, Firecrawl excluded from keyless `buildPool`.
- [x] **Step 2: Run to verify fail** Run: `npm --prefix packages/agent-loop test -- websearch.test.js` Expected: FAIL (args still `{query,count}`, no Accept header).
- [x] **Step 3: Implement `buildArgs` + Accept header + Firecrawl keyless removal** in `packages/agent-loop/src/websearch.js`.
- [x] **Step 4: Run tests to verify pass** Run: `npm --prefix packages/agent-loop test -- websearch.test.js` Expected: PASS.
- [x] **Step 5: Live probe (manual)** Run: `node --input-type=module -e` calling Exa + Parallel via new builder; expect `ok:true` with results. Paste output in commit message trailer.
- [x] **Step 6: Commit** `git add packages/agent-loop/src/websearch.js packages/agent-loop/test/websearch.test.js; git commit -m "fix(websearch): per-provider args and Accept header for Exa/Parallel"`

### Task 2: Truthful aggregate error

**Files:**
- Modify: `packages/agent-loop/src/websearch.js:193-215`
- Modify: `apps/jscad-web/src/aiSearch.js:88-96`
- Test: `packages/agent-loop/test/websearch.test.js`, `apps/jscad-web/test/aiSearch.test.js`

**Model:** `sonnet` — error shape touches page fallback logic.

**Interfaces:**
- Consumes: Task 1 `searchVia` results.
- Produces: `toolError('SearchUnavailableError', msg, {details})` where `details=[{provider,status,retryable}]`; page relay fallback still triggers only on `SearchUnavailableError`.

- [x] **Step 1: Write failing tests** asserting `res.error.details` contains per-provider `{provider, status}` and message no longer claims cooling down when `retryable:false` for all.
- [x] **Step 2: Run to verify fail** Run: `npm --prefix packages/agent-loop test -- websearch.test.js; npm --prefix apps/jscad-web test -- aiSearch.test.js` Expected: FAIL (no details field).
- [x] **Step 3: Implement aggregate details** in `websearch.js` return path; keep `aiSearch.js` fallback condition on `name==='SearchUnavailableError'`.
- [x] **Step 4: Run tests to verify pass** Run same suites. Expected: PASS.
- [x] **Step 5: Commit** `git add packages/agent-loop/src/websearch.js apps/jscad-web/src/aiSearch.js ...test files; git commit -m "fix(websearch): report per-provider failure detail"`

### Task 3: E2E + docs sync

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat-tools.spec.js:184-215`
- Modify: `docs/superpowers/specs/2026-10-15-websearch-design.md:25-48`
- Test: `apps/jscad-web/e2e/ai-chat-tools.spec.js`

**Model:** `haiku` — mechanical stub + doc updates.

**Interfaces:**
- Consumes: Tasks 1-2 behavior.
- Produces: e2e `stubMcp` asserts new arg shapes; spec CORS matrix notes Firecrawl OAuth-only + Exa Accept requirement.

- [x] **Step 1: Update `stubMcp` expectations** for Exa `{query, objective}` and Parallel `{objective, search_queries}` shapes.
- [x] **Step 2: Run e2e subset** Run: `npm --prefix apps/jscad-web run e2e -- ai-chat-tools.spec.js -g "websearch runs keyless"` Expected: PASS.
- [x] **Step 3: Update spec matrix** lines 25-48 with 2026-10-18 probe results.
- [x] **Step 4: Full unit suites** Run: `npm test` (root turbo). Expected: PASS.
- [x] **Step 5: Commit** `git add apps/jscad-web/e2e/ai-chat-tools.spec.js docs/...; git commit -m "fix(websearch): sync e2e and spec for provider drift"`

---

## Follow-up 2026-10-18: cooldown-cause reporting (commit `a89b327c`)

Cooldown skips hid the triggering failure (`status: 'cooldown'` with no
cause). `lastFailure` per provider is now reported as
`causedBy: {status, retryable}` plus `retryInMs`; message names causing
statuses. Tests: cooldown-cause pin, post-cooldown recovery
(`websearch.test.js`, 73 green with dispatch/tools/standard suites).
