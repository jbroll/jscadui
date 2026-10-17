# Chat Tools E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E2E coverage in `apps/jscad-web` proving each chat tool the agent can call works through the real page, with explicit routing proof: browser-direct search calls hit MCP endpoints with no relay traffic, and relayed calls (inference, Tavily search, page fetch) hit the relay paths.

**Architecture:** One new Playwright spec `e2e/ai-chat-tools.spec.js` reusing the stub-relay pattern from `e2e/ai-chat.spec.js` (node `http` stub for `/api/relay/*`, `page.route` stubs for `/api/fetch` and `/api/search` and MCP endpoints). Every test asserts routing as well as results: direct search tests fail if any `**/api/search` request fires; relay tests assert the exact relay path (`/api/relay/<kind>/...`, `/api/fetch`, `/api/search`) and payload shape. No app code changes expected; only test code.

**Tech Stack:** Playwright `@playwright/test`, existing `e2e/helpers.js` (`dismissWelcome`, `waitForRender`, `assertNoError`), node `http` stub relay.

**Spec:** User request 2026-10-17: "set up end to end testing for each tool the agent can use in the chat, including inference, webfetch, websearch, and view image", refined to "test the direct search api calls and other api call through the relay." Routing contract: `src/aiSearch.js:22-24,75-97` (browser-direct MCP pool first, Tavily `POST /api/search` only as fallback/pinned), `src/aiFetch.js:7-9,26-38` (every fetch via `POST /api/fetch`), `src/aiChat.js:relayBaseUrl` (inference via `/api/relay/<kind>/...` or `/api/relay/jscad-web/<id>/...`). No written design doc; this plan argues from the codebase (`packages/agent-loop/src/tools.js` tool catalog, `apps/jscad-web/main.js:980-996` wiring).

## Global Constraints

- New tests live in `apps/jscad-web/e2e/ai-chat-tools.spec.js`; do NOT modify `e2e/ai-chat.spec.js` (it owns the existing write/edit/measure/run parity rounds).
- Every test seeds TOS via `jscad-ai.tos` (`seedTos`) and points the relay via `jscad-ai.relay` addInitScript, exactly like `ai-chat.spec.js:208-214`.
- `fullyParallel: false` and WebGL flags in `playwright.config.js` stay unchanged.
- Each tool round asserts both the model-visible result (last `tool` message in `stub.requests`) and the page rendering (`.chat-tool-mark` ok/failed, `.chat-messages` text).
- Routing proof is mandatory: track every `fetch` URL via `page.route` counters (`directHits: string[]`, `relayHits: string[]`). Direct-search tests MUST assert `relayHits` for `**/api/search` is empty and `directHits` contains an `mcp.*` URL; relay tests MUST assert the exact relay path was hit once with the expected JSON body (`{query,count}` for search, `{url,format}` for fetch, OpenAI chat-completions body for inference).

## Review Focus

- Ungranted websearch/webfetch denies with a `question` grant request and fires no network — pinned by Task 2 test 1 (assert `page.route` never hit on the denied call).
- `webfetch` relay 502 surfaces `failed` on the tool line but the turn still closes with the model's text — pinned by Task 2 test 2.
- `websearch` pinned `off` fails closed with `SearchUnavailableError` and no network — pinned by Task 3 test 2 part A.
- Free inference 402 `inference_quota_exhausted` renders the quota line, not a generic error — pinned by Task 1 test 3.
- `view` with no rendered canvas surfaces `failed` instead of hanging — pinned by Task 4 test 2 (canvas removed via `page.evaluate`).

---

### Task 1: Inference turns e2e (own-key + free route)

**Files:**
- Create: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (spec skeleton + shared stub helpers + these 2 tests)
- Reuse: `apps/jscad-web/e2e/helpers.js`, `apps/jscad-web/e2e/ai-chat.spec.js:126-182` (copy `startStubRelay`, `seedTos`, `keepMode`, `chunk` patterns — do not import across specs)

**Model:** `sonnet` — multi-file coordination (relay stub + page wiring + assertions), prose-to-Playwright work.

**Interfaces:**
- Consumes: none (first task).
- Produces: `startStubRelay(rounds, opts)` helper in the new spec exporting `{ server, port, requests, paths }`; `seedTos()`; `openChatWithKey(page, stub)` helper used by Tasks 2-4.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/e2e/ai-chat-tools.spec.js`, add:

```js
test('own-key inference turn offers web tools and completes', async ({ page }) => {
  // configure openai/stub-model/sk-test via .ai-gear, stub [{text:'Hello from stub.'}],
  // send 'say hello', expect .chat-messages to contain 'Hello from stub.',
  // expect stub.requests[0].tools names to contain websearch + webfetch,
  // expect offered NOT to contain 'view' or 'eval'.
  // ROUTING: expect stub.paths[0] to be '/api/relay/openai/v1/chat/completions'
  //   (proves inference goes through the relay, never direct to the provider).
})
test('free jscad-web inference turn rides the free route', async ({ page }) => {
  // stub [{text:'Free reply.'}], select provider jscad-web/deepseek-v4-flash,
  // send 'model a cube', expect 'Free reply.',
  // expect stub.paths to equal ['/api/relay/jscad-web/deepseek-v4-flash/v1/chat/completions'],
  // expect stub.requests[0].model to be 'deepseek-v4-flash'.
  // ROUTING: assert no direct provider fetch fired (only stub.paths seen); catalog GET
  //   '/api/relay/jscad-web/v1/models' returns the deepseek option.
})
test('free quota exhaustion renders the quota line', async ({ page }) => {
  // stub relay POST answers status 402 JSON {error:{message:'inference_quota_exhausted'}} (extend startStubRelay with `status` per round);
  // select free provider, send 'model a cube', expect .chat-msg.error contains 'out of budget',
  // expect no .chat-tool line added.
})
```

Shared helpers to include in the same file: `chunk`, `seedTos` (import `TOS_VERSION` from `../src/aiConsent.js`), `keepMode(page)`, `startStubRelay` (support `GET /api/relay/jscad-web/v1/models` catalog + `POST /api/relay/openai/...` + free-turn regex, same as `ai-chat.spec.js:126-182`), `openChatWithKey` (goto `/`, `dismissWelcome`, `waitForRender`, open `#ai-chat`, gear-select provider/model/key, `keepMode` device, save).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "inference"`
Expected: FAIL with "ENOENT / no such file" (spec does not exist yet) or locator timeouts.

- [ ] **Step 3: Implement the spec skeleton + helpers + 2 tests**

Create the file per Step 1, following `ai-chat.spec.js:192-252` (own-key flow) and `:495-524` (free flow) for selectors: `#menu-button`, `#ai-chat-btn`, `.ai-gear`, `.ai-provider-select`, `.ai-model-input`, `.ai-model-select`, `.ai-key-input`, `.ai-save-key`, `.chat-input`, `.chat-send`, `.chat-messages`. Set `test.setTimeout(60_000)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "inference"`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat-tools.spec.js
git commit -m "e2e: cover own-key and free inference turns"
```

### Task 2: Webfetch e2e (grant gate + relay fetch)

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (append 2 tests)
- Reuse: Task 1 helpers + `src/aiFetch.js:26-58` (`POST /api/fetch` contract), `src/aiChat.js:60-63,72-77` (grant gate)

**Model:** `sonnet` — stub `page.route('**/api/fetch')`, grant-denied vs granted flows.

**Interfaces:**
- Consumes: `startStubRelay`, `openChatWithKey` from Task 1.
- Produces: `stubFetch(page, handler)` pattern reused by Task 3 (document as local helper `routeApi(page, path, body)`).

- [ ] **Step 1: Write the failing tests**

```js
test('webfetch asks for permission first, then fetches through the relay', async ({ page }) => {
  // relay rounds: [{name:'webfetch', args:{url:'https://example.com/part'}},
  //                {name:'question', args:{question:'Allow fetching?', header:'Permit'}},
  //                {text:'Fetched.'}]
  // page.route('**/api/fetch') -> {ok:true,title:'Part',finalUrl:url,content:'# Part\nsteel',truncated:false}
  // send 'fetch https://example.com/part'; expect first webfetch tool result denied (grant request text in stub.requests[1] tool message);
  // after question grant, expect page.route hit once, final .chat-messages contains 'Fetched.',
  // first .chat-tool-target contains 'example.com', mark 'ok'.
  // ROUTING: capture the /api/fetch POST body, assert it equals {url:'https://example.com/part',format:'markdown'};
  //   assert the page NEVER fetched https://example.com/part directly (no route outside **/api/fetch).
})
test('webfetch relay failure renders failed, keeps turn alive', async ({ page }) => {
  // relay rounds: [{name:'webfetch', args:{url:'https://example.com/down'}},{text:'Could not fetch.'}]
  // grant pre-allowed via Chat settings checkbox .ai-websearch-allow (check it) OR setWebsearchGranted path;
  // page.route('**/api/fetch') -> status 502 {error:'boom',name:'FetchError'}
  // expect .chat-tool.failed visible, mark 'failed', .chat-messages contains 'Could not fetch.'.
})
```

Note: grant pre-allow UI is the gear dialog `.ai-websearch-allow` checkbox (see `src/aiAccount.js:468`); if flaky, drive two-turn flow (deny → question → allow) like the first test instead of clicking the checkbox.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "webfetch"`
Expected: FAIL (tests not found / route never hit).

- [ ] **Step 3: Implement the 2 tests**

Add `page.route` stubs before `page.reload()` + relay init (routes survive reload when set before navigation — set after `goto` but re-arm after reload, or use `page.route` after reload before sending). Assert on `stub.requests.at(-1).messages` tool contents (`ok:true`, `content` contains 'steel') and DOM (`.chat-tool-mark`, `.chat-tool-target`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "webfetch"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat-tools.spec.js
git commit -m "e2e: cover chat webfetch grant and relay fetch"
```

### Task 3: Websearch e2e (direct pool + relay fallback + off)

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (append 2 tests)
- Reuse: `src/aiSearch.js:27-98` (browser-direct pool, `pinned`, `/api/search` fallback), `packages/agent-loop/src/websearch.js:50-62` (pool)

**Model:** `sonnet` — MCP endpoint stubbing + pinned-provider behavior.

**Interfaces:**
- Consumes: `startStubRelay`, `openChatWithKey`, `routeApi` from Tasks 1-2.
- Produces: nothing downstream (Task 4 only needs Task 1 helpers).

- [ ] **Step 1: Write the failing tests**

```js
test('websearch runs keyless through the direct pool and logs provider', async ({ page }) => {
  // relay rounds: [{name:'websearch', args:{query:'608 bearing dimensions'}},{text:'Found.'}]
  // page.route('https://mcp.exa.ai/mcp', ...) + parallel + firecrawl -> {result:{results:[{title:'608',url:'https://example.com/bearing',snippet:'8x22x7'}]}}
  // pre-grant via gear checkbox; send 'bearing size?'; expect route hit, .chat-messages 'Found.',
  // tool result ok:true with provider-tagged hit, no '**/api/search' request made (track via route flag).
  // ROUTING (direct): assert at least one directHits entry matches /mcp\.(exa|parallel|firecrawl)/;
  //   assert relayHits for '**/api/search' is EMPTY (proves no relay hop);
  //   assert the MCP POST body is JSON-RPC {method:'tools/call'} (per packages/agent-loop/src/websearch.js mcpCall).
})
test('websearch pinned off fails closed; Tavily fallback tags provider', async ({ page }) => {
  // part A: getPinned off path — set provider select .ai-websearch-provider to 'off' in gear dialog,
  //   relay round [{name:'websearch',...}] -> expect tool result SearchUnavailableError, no network hit.
  // part B (same test, second turn after switching pin to 'tavily' + storing key is heavy; instead):
  //   fresh context: page.route direct MCP -> 429 {}, page.route('**/api/search') -> {ok:true,results:[{title:'t',url:'https://example.com',snippet:'s',provider:'tavily'}]}
  //   expect tool result provider 'tavily', .chat-tool-mark 'ok'.
  // ROUTING (relay): assert direct MCP routes were hit and returned 429 (pool exhausted),
  //   then '**/api/search' POST body equals {query, count:8}; assert relay response results get
  //   retagged provider:'tavily' (per aiSearch.js relaySearch).
})
```

If the gear-dialog pin selector (`.ai-websearch-provider`, `src/aiAccount.js:482`) proves flaky, part A may instead assert the unit-covered off path via the relay round returning `question` grant flow — keep the no-network assertion either way.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "websearch"`
Expected: FAIL.

- [ ] **Step 3: Implement the 2 tests**

Stub MCP with `page.route('https://mcp.exa.ai/mcp', route => route.fulfill({json:{result:{results:[...]}}}))` (same shape as `test/aiSearch.test.js:17-22` `mcpOk`). For fallback, fulfill direct with `{ok:false,status:429}` JSON `{}` and `/api/search` with relay results. Keep `count` default 8.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "websearch"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat-tools.spec.js
git commit -m "e2e: cover chat websearch direct pool and relay fallback"
```

### Task 4: View image e2e (canvas capture)

**Files:**
- Modify: `apps/jscad-web/e2e/ai-chat-tools.spec.js` (append 1 test)
- Reuse: `apps/jscad-web/main.js:982-988` (`view` handler: `canvas.toDataURL`, `{ok,image,camera}`), `packages/agent-loop/test/dispatchTool.test.js:18` (view shape)

**Model:** `sonnet` — canvas/WebGL assertion, screenshot-free verification.

**Interfaces:**
- Consumes: `startStubRelay`, `openChatWithKey` from Task 1.
- Produces: full spec file complete; no downstream tasks.

- [ ] **Step 1: Write the failing test**

```js
test('view captures the rendered canvas as an image result', async ({ page }) => {
  // relay rounds: [{name:'view', args:{}} , {text:'I see a cube.'}]
  // send 'what do you see?'; expect stub.requests.at(-1) tool message content JSON has ok:true,
  // image startsWith 'data:image/png', camera object present;
  // expect .chat-tool-name 'view', mark 'ok', .chat-messages contains 'I see a cube.';
  // expect canvas exists: page.locator('#viewer canvas') visible.
})
test('view with no canvas fails the tool line without hanging', async ({ page }) => {
  // relay rounds: [{name:'view', args:{}},{text:'No view.'}]
  // before sending: await page.evaluate(() => document.querySelector('#viewer')?.replaceChildren());
  // send 'what do you see?'; expect .chat-tool.failed visible, mark 'failed',
  // .chat-messages contains 'No view.'.
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "view captures"`
Expected: FAIL.

- [ ] **Step 3: Implement the test**

No `page.route` needed. Rely on the default model already rendered (`waitForRender` in helper). Assert `JSON.parse(toolMessage.content).image.slice(0,22) === 'data:image/png;base64,'`. Note `view` is NOT in the offered tools list (`tools.test.js:19-20`) — the stub must still request it; the app serves it via `aiDeps.view`. If the loop's toolFilter rejects unknown tools, request `view` directly and assert it is served (that is the regression this test pins).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js -g "view captures"`
Expected: PASS. Then full file: `cd apps/jscad-web && npx playwright test e2e/ai-chat-tools.spec.js`

Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/e2e/ai-chat-tools.spec.js
git commit -m "e2e: cover chat view image capture"
```
