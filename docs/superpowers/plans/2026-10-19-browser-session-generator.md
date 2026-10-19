# Browser Session Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a curated set of 3D build scenarios through the real jscad-web app in headless chromium, with a free-model simulated user, and write the sessions as relay logs plus a batch manifest that `read-log --batch` and `chat-review` consume.

**Architecture:** Pure Node logic (stumble counting, free-model gate, Go client, model probe, simulated user, session orchestration, manifest, batch compare, scenarios) lives in `packages/agent-loop/synth/` and `packages/agent-loop/log/`, unit-tested with fakes. The browser side lives in `apps/jscad-web/synth/`: it starts the local launcher per session, drives the chat through Playwright, and reaches the app's own tool handlers through a localStorage-gated `globalThis.jscadHarness` hook added in `main.js`. A `ci/synth` job runs the batch on the GPU host.

**Tech Stack:** Node ESM, vitest, `@playwright/test` (bundled chromium), the launcher `apps/jscad-web/scripts/jscad.mjs`, opencode Go endpoint.

**Spec:** `docs/superpowers/specs/2026-10-19-browser-session-generator-design.md`

## Global Constraints

- Free models only: `longcat-2.5-preview-free`, `minimax-m3.1-flash-free`, `beam-free` on `https://opencode.ai/zen/go/v1`. A batch refuses to start if any configured model is outside that list or fails the availability probe. Never call the Zen endpoint, never imitate the OpenCode client.
- Every Go request carries `x-opencode-session`. Key: `opencode-go` in `$JSCAD_CHAT_KEYS` or `~/.config/jscad-chat/keys.json`. Never print, log or write the key anywhere but the page's localStorage.
- Roles: builder longcat → sim user minimax; builder minimax → sim user longcat (output capped); builder beam (no `view`) → sim user minimax. Builder at default temperature; sim user `temperature: 0`.
- Fluent only. Selection `api: 'fluent'`. No style field in the manifest.
- At most 3 user turns per session, the opening request included. 2 runs per scenario and builder.
- Logs and manifests go under `<data>/logs/synthetic/<batch>/` (`chatLogDir()` + `synthetic/<batch>`), never into jscadui.
- Ports: avoid 5120–5123 (`ci/render`) and 5150–5153 (`ci/web`). Synth uses base 5170, lane `i` uses `5170 + 10*i` (app) and `+1` (frame).
- Launcher runs with `JSCAD_TRACKED=1`, `--no-open`, `JSCAD_CHAT_LOG=<batch dir>`.
- Playwright bundled chromium, `--use-gl=angle --ignore-gpu-blocklist`, no retries.
- Waits exceed the app's limits: 32 rounds, 120 s per tool call, 30 s per `run`. Turn timeout default 30 min (`SYNTH_TURN_TIMEOUT_MS=1800000`).
- CI job cap 7200 s. Heavy runs go through simple-ci (`sci push jscadui/synth`), not locally.
- Docs change in the same commit as the code. Comments only for a non-obvious why.
- Never open a PR. Commit on `feat/browser-session-generator`; no pushes.

## Review Focus

1. A builder turn that never ends (silent reasoning model, a hung tool). The turn timeout clicks Stop, records `timedOut: true` on the session, and the batch moves on.
2. A Go error for the simulated user (429, 5xx, empty choice) mid-session. The session records `error` and ends; the batch continues; nothing retries against another model.
3. No geometry at critique time (last build failed). `view` rejects with `NoGeometryError`; the simulated user critiques from text and the report alone; checks record `{ passed: 0, total, noGeometry: true }`.
4. A session whose requests carry no `x-jscad-chat-id` (consent not seeded, custom `baseUrl`). The session errors with `no chat id seen`, so a manifest never holds a session the log cannot match.
5. A launcher that fails to start or a port already in use. `startLauncher` rejects within 120 s with the launcher's stderr tail instead of hanging the lane.

Each line's test sits in the owning task (5, 4, 4, 5, 5).

---

### Task 1: Shared stumble counter and `read-log --batch`

**Files:**
- Create: `packages/agent-loop/log/stumbles.js`, `packages/agent-loop/log/stumbles.test.js`
- Modify: `packages/agent-loop/log/read-log.js`, `packages/agent-loop/log/read-log.test.js`
- Docs: `packages/agent-loop/docs/user-manual.md` (read-log section, near line 398)

**Model:** `sonnet`. Two files plus CLI wiring, rules from prose.

**Interfaces:**
- Consumes: `readConversations(dir, {since})` conversation shape `{chatId, model, api, turns: [{ts, user, steps: [{name, input, result, ok, error?}], final, error?}]}`.
- Produces:
  - `countStumbles(conversation) -> { failedCalls: number, unbuiltTurns: number }` in `log/stumbles.js`.
  - `readBatch(logDir, batchId) -> Promise<Array<conversation & { label: {scenario, builder, simUser, run} | null, stumbles }>>` exported from `read-log.js`.
  - Every conversation from `readConversations` gains `stumbles` (via `countStumbles`); `formatConversations` header appends `failed:<n> unbuilt:<n>` and, when `label` is set, `<scenario> <builder>#<run>`.

Rules (chat-review step 2): a failed call is a step with `ok === false`. A turn is unbuilt when it has no `write`/`edit` step with `ok === true`, or its last `write`/`edit` step has `ok === false`. Corrections are not counted here.

- [ ] **Step 1: Write the failing tests** in `stumbles.test.js`:
  - `counts failed tool calls across turns`: two turns, steps `ok:false, ok:true, ok:false` → `failedCalls: 2`.
  - `a turn with no successful write or edit is unbuilt`: turn with only `run ok:true` → `unbuiltTurns: 1`.
  - `a turn whose last write failed is unbuilt even after an earlier good write`: `write ok:true`, `edit ok:false` → `unbuiltTurns: 1`.
  - `a turn ending in a successful edit is built` → `unbuiltTurns: 0`.

  In `read-log.test.js`:
  - `readBatch reads only that batch and labels from the manifest`: write `logs/2026-10-19.jsonl` (chat `real`), `logs/synthetic/b1/2026-10-19.jsonl` (chat `syn`), `logs/synthetic/b1/manifest.json` with `sessions: [{chatId:'syn', scenario:'jeep-1-10', builder:'beam-free', simUser:'minimax-m3.1-flash-free', run:1}]`. `readBatch(dir,'b1')` returns one conversation, `chatId 'syn'`, `label.scenario 'jeep-1-10'`.
  - `plain readConversations skips synthetic batches`: same tree, `readConversations(dir)` returns only `real`.
  - `readBatch fails with the path when the batch is missing`: rejects with a message containing `synthetic/nope`.
- [ ] **Step 2: Run** `npx vitest run log/` in `packages/agent-loop`. Expected: the new tests fail (`countStumbles` / `readBatch` not exported).
- [ ] **Step 3: Implement** `countStumbles` and `readBatch`; add `stumbles` in `readConversations`; CLI gains `--batch <id>` (mutually exclusive with `--since`; `--json` still applies). Update the usage comment on line 1.
- [ ] **Step 4: Run** `npx vitest run log/`. Expected: PASS.
- [ ] **Step 5: Docs.** user-manual read-log section: `--batch <id>`, the `failed`/`unbuilt` header fields, and that `logs/synthetic/` is skipped unless `--batch` names a batch.
- [ ] **Step 6: Commit** `feat(read-log): stumble counts and --batch for synthetic sessions`.

---

### Task 2: Harness hook in the app

**Files:**
- Create: `apps/jscad-web/src/harnessHook.js`, `apps/jscad-web/test/harnessHook.test.js` (or the directory the app's unit tests already use for `src/` modules; match it), `apps/jscad-web/e2e/harness-hook.spec.js`
- Modify: `apps/jscad-web/main.js` (after `aiDeps`, ~line 1103), `ci/web` (add the spec to the playwright list)
- Docs: `apps/jscad-web/docs/architecture.md` (AI chat section)

**Model:** `sonnet`. Small module plus wiring into a large file.

**Interfaces:**
- Consumes: `aiDeps.view`, `chatTools.measure`, `chatTools.check`, `projectBuilds.report` in `main.js`.
- Produces:
  - `HARNESS_FLAG_KEY = 'jscad-harness'` and `installHarnessHook({ storage, target, view, measure, check, buildReport }) -> boolean` in `src/harnessHook.js`. When `storage.getItem(HARNESS_FLAG_KEY) === '1'`, sets `target.jscadHarness = { view, measure, check, buildReport }` (each `async (args) => result`, `buildReport` takes no args) and returns true; otherwise leaves `target` untouched and returns false.
  - In the page: `globalThis.jscadHarness.view({views:['iso-front','iso-back','top']})` resolves `{ok:true, shots:[{image:{dataUrl,mime}, camera}]}`; `.measure({})` and `.check({})` resolve the same JSON the chat tools return (`withUnits({ok:true,...})`); `.buildReport()` resolves the last build report.

- [ ] **Step 1: Write the failing unit tests:**
  - `installs nothing without the flag`: empty storage → returns false, `target.jscadHarness` undefined.
  - `installs the four handlers with the flag`: storage `{ 'jscad-harness': '1' }`, fakes → `await target.jscadHarness.measure({})` returns the fake's value; same for `view`, `check`, `buildReport`.
- [ ] **Step 2: Run** `npx vitest run test/harnessHook.test.js` in `apps/jscad-web`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `installHarnessHook`; call it in `main.js` right after `aiDeps` with `storage: globalThis.localStorage, target: globalThis`.
- [ ] **Step 4: Run** the unit test. Expected: PASS.
- [ ] **Step 5: Write the e2e spec** `harness-hook.spec.js`: init script sets `jscad-harness` to `'1'`; load `/`, `dismissWelcome`, `waitForRender`; `page.evaluate` calls `view({views:['iso-front','top']})` → 2 shots, each `dataUrl` starting `data:image/png;base64,`; `measure({})` → `ok: true` with numeric `volume`; `buildReport()` → `ok: true`. A second test without the flag: `typeof globalThis.jscadHarness === 'undefined'`. Not run locally; it runs in `ci/web` (Task 7 pushes it).
- [ ] **Step 6: Docs.** architecture.md: the hook, its flag, that it exposes the chat's own handlers for the session generator and is absent unless the flag is set.
- [ ] **Step 7: Commit** `feat(app): localStorage-gated harness hook exposing view, measure, check and build report`.

---

### Task 3: Free-model gate, Go client, model probe, simulated user

**Files:**
- Create in `packages/agent-loop/synth/`: `roles.js`, `goClient.js`, `modelProbe.js`, `simUser.js`, and `roles.test.js`, `goClient.test.js`, `modelProbe.test.js`, `simUser.test.js`
- Reference: `/tmp/claude-1000/-home-john-src-jscadui-wt2/a3720abc-7bc1-464d-ab5e-2daf22806cd2/scratchpad/vision-probe.mjs` (PNG builder and probe to port)

**Model:** `sonnet`. Four small modules, prompt wording within stated rules.

**Interfaces:**
- Produces:
  - `roles.js`: `GO_BASE_URL = 'https://opencode.ai/zen/go/v1'`; `FREE_MODELS = ['longcat-2.5-preview-free','minimax-m3.1-flash-free','beam-free']`; `ROLES = [{ builder:'longcat-2.5-preview-free', vision:true, simUser:'minimax-m3.1-flash-free', simUserMaxTokens:1500 }, { builder:'minimax-m3.1-flash-free', vision:true, simUser:'longcat-2.5-preview-free', simUserMaxTokens:600 }, { builder:'beam-free', vision:false, simUser:'minimax-m3.1-flash-free', simUserMaxTokens:1500 }]`; `assertFree(models: string[], probe: Record<string,{available:boolean}>) -> void` throws `Error('refusing to start: <model> is not a confirmed free model')`.
  - `goClient.js`: `createGoClient({ apiKey, fetchImpl = fetch, session }) -> { complete({ model, messages, temperature?, maxTokens? }) -> Promise<{ text, ms, inputTokens, outputTokens, status }> }`. Non-streaming POST to `${GO_BASE_URL}/chat/completions`, headers `authorization: Bearer`, `x-opencode-session: session`. A non-2xx or a missing `choices[0].message.content` rejects with `Error` naming model, status and the provider's error message (never the key).
  - `modelProbe.js`: `probeModel(client, model) -> Promise<{ available: boolean, vision: boolean, error?: string }>`: one text call (`'Reply with OK.'`), then, if available, one image call with the red-square/blue-circle PNG; `vision` true only when the answer names red, square/rectangle, blue and circle. `probeModels(client, models)` runs them in sequence and returns the map. Export `shapesPng() -> Buffer`.
  - `simUser.js`: `ACCEPT = 'ACCEPT'`; `createSimUser({ client, model, maxTokens, vision, scenario }) -> { answer(question: string, history) -> Promise<{text, call}>, critique({ history, finalText, report, images: string[] }) -> Promise<{ accepted: boolean, text: string|null, call }> }`. `history` is `[{ role:'user'|'assistant'|'question', text }]`. `call` is `{ ms, inputTokens, outputTokens }`. Images are sent only when `vision` is true. The report is JSON-stringified and clipped to 4000 chars.

Simulated-user prompt rules (spec, "Simulated user" and anti-goals): speaks as the persona, knows only the fact card, never names APIs, code, functions or tools, never coaches a fix, answers a question from the card or says it does not mind, critiques like that person (size off from the card, missing feature the card names, earlier work replaced), replies with exactly `ACCEPT` when satisfied, otherwise one short user message.

- [ ] **Step 1: Write the failing tests** with a fake `fetchImpl` / fake client:
  - roles: `assertFree throws for a paid model` (`'deepseek-v4.1-flash'`), `throws for a free model the probe marked unavailable`, `passes for probed free models`.
  - goClient: `sends x-opencode-session, temperature and max_tokens`; `returns text and usage tokens` (`usage.prompt_tokens: 12, completion_tokens: 3`); `rejects with status and provider message on 400`, and the rejection message does not contain the key.
  - modelProbe: `text-only model is available without vision` (image call answers 400 "Beam supports text input only"); `vision model names both shapes`; `unavailable model skips the image call`; `shapesPng starts with the PNG signature`.
  - simUser: `answer sends persona and facts but never code`; `critique returns accepted on exactly ACCEPT` (also `'ACCEPT.'` and `' accept '` count; `'I accept the size but...'` does not); `critique omits images when vision is false`; `system prompt forbids naming APIs or code` (assert the prompt string contains the rule text you wrote).
- [ ] **Step 2: Run** `npx vitest run synth/` in `packages/agent-loop`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** `npx vitest run synth/`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(synth): free-model gate, Go client, model probe and simulated user`.

---

### Task 4: Session orchestration, manifest, batch compare

**Files:**
- Create in `packages/agent-loop/synth/`: `session.js`, `manifest.js`, `compare.js`, and their `.test.js`
- Modify: `packages/agent-loop/package.json` (script `"synth:compare": "node synth/compare.js"`)
- Docs: `packages/agent-loop/docs/user-manual.md` (new section "Synthetic sessions": manifest fields, compare)

**Model:** `opus`. The turn loop's failure handling is the subtle part of the system.

**Interfaces:**
- Consumes: `createSimUser` (Task 3), `countStumbles` and `readBatch` (Task 1).
- Produces:
  - `session.js`: `runSession({ driver, scenario, simUser, maxUserTurns = 3, turnTimeoutMs }) -> Promise<SessionResult>` where `driver` is `{ send(text), waitTurn({ timeoutMs, onQuestion: (text) => Promise<string> }) -> Promise<{ timedOut: boolean }>, stop(), lastAssistantText() -> Promise<string>, view(spec), measure(args), check(args), buildReport() }` and `SessionResult = { userTurns, accepted, timedOut, error: string|null, checks: { passed, total, failed: string[], noGeometry?: true } | null, simUserCalls: [{ms,inputTokens,outputTokens}], views: [{ turn, name, dataUrl }] }`.
    Loop: send `scenario.prompt`; `waitTurn` with `onQuestion` → `simUser.answer`; on `timedOut` call `driver.stop()`, set `timedOut`, end. After each turn take `view({views:['iso-front','iso-back','top']})` (on rejection: no images), `buildReport()`, `lastAssistantText()`; `simUser.critique`; `accepted` → end; else if `userTurns < maxUserTurns` send the critique text, else end. Then run checks: `scenario.checks?.(m, { solid })` with `m = measure({})`, `solid = check({})`; a measure result with `ok:false` or a rejection → `{ passed: 0, total: null, failed: [], noGeometry: true }`; a scenario without `checks` → `checks: null`. Any sim-user or driver rejection sets `error` to its message and ends the session; `runSession` itself never rejects.
  - `manifest.js`: `createManifest({ batch, jscaduiCommit, scenarioSetCommit, probe }) -> manifest`; `addSession(manifest, entry)`; `writeManifest(dir, manifest)` (atomic: write `manifest.json.tmp`, rename); `sessionEntry({ chatId, scenario, builder, simUser, run, rounds, result, stumbles }) -> entry` with `stumbles.corrections = userTurns - 1` (every sim-user message after the opening is a non-`ACCEPT` critique). Entry fields exactly as the spec's manifest plus `rounds`, `timedOut`, `error`.
  - `compare.js`: `compareBatches(a, b) -> rows` keyed `scenario|builder`, each `{ scenario, builder, a: stats, b: stats }` with `stats = { sessions, checkPassRate, accepted, meanUserTurns, meanRounds, meanFailedCalls, meanUnbuiltTurns, meanCorrections }`; CLI `node synth/compare.js <batchA> <batchB>` resolves each id under `chatLogDir()/synthetic/` and prints a table.

- [ ] **Step 1: Write the failing tests** for `runSession` with a fake driver and fake sim user:
  - `accepts after the first turn`: critique accepts → `userTurns 1, accepted true`, driver received one `send`.
  - `stops at three user turns`: critique never accepts → `userTurns 3`, three sends, critique called 3 times.
  - `answers a question through the sim user`: driver's `waitTurn` calls `onQuestion('How long?')` → `simUser.answer` received `'How long?'` and its text is what `onQuestion` resolved.
  - `a timed-out turn stops and ends the session`: `waitTurn` → `{timedOut:true}` → `driver.stop` called, `timedOut true`, no critique.
  - `a sim-user error ends the session with error, never throws`: critique rejects `Error('go 429')` → `error 'go 429'`.
  - `no geometry critiques without images and records noGeometry`: `view` rejects `NoGeometryError`, `measure` resolves `{ok:false}` → critique got `images: []`, `checks.noGeometry true`.
  - `runs scenario checks on the final build`: checks return `[{pass:true},{pass:false,name:'long'}]` → `{ passed:1, total:2, failed:['long'] }`.
  - manifest: `sessionEntry counts corrections as sim-user turns after the opening` (`userTurns 3` → `corrections 2`); `writeManifest leaves valid JSON`.
  - compare: `pairs rows by scenario and builder`; `a row missing from one batch shows null stats`.
- [ ] **Step 2: Run** `npx vitest run synth/`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** `session.js`, `manifest.js`, `compare.js`; add the npm script.
- [ ] **Step 4: Run** `npx vitest run synth/`. Expected: PASS.
- [ ] **Step 5: Docs** in agent-loop user-manual, section "Synthetic sessions": what a batch is, the manifest fields, `corrections` meaning, `npm run synth:compare -w @jscadui/agent-loop -- <a> <b>`.
- [ ] **Step 6: Commit** `feat(synth): session loop, batch manifest and batch compare`.

---

### Task 5: Browser runner

**Files:**
- Create in `apps/jscad-web/synth/`: `launcher.js`, `pageDriver.js`, `defaultFiles.js`, `run-batch.mjs`, `launcher.test.js`, `defaultFiles.test.js`
- Modify: `apps/jscad-web/e2e/helpers.js` (add `seedTos`), `e2e/ai-chat-tools.spec.js` and `e2e/ai-chat.spec.js` (import `seedTos` from helpers, drop their local copies), `apps/jscad-web/package.json` (script `"synth": "node synth/run-batch.mjs"`)
- Docs: `apps/jscad-web/docs/user-manual.md` or `packages/agent-loop/docs/user-manual.md` "Synthetic sessions" (how to run a batch locally, env vars)

**Model:** `opus`. Browser timing, process lifecycle and the chat DOM, mostly untestable without a live run.

**Interfaces:**
- Consumes: `installHarnessHook` flag `jscad-harness` (Task 2); `runSession`, `createManifest`, `addSession`, `writeManifest`, `sessionEntry` (Task 4); `ROLES`, `FREE_MODELS`, `assertFree`, `createGoClient`, `probeModels`, `createSimUser` (Task 3); `countStumbles`, `readConversations` (Task 1); scenarios via `loadScenarios()` (Task 6; until it lands, accept a `--scenario <file>` path).
- Produces:
  - `launcher.js`: `startLauncher({ modelDir, port, logDir, webDir }) -> Promise<{ url, stop() }>`: spawns `node scripts/jscad.mjs <modelDir> --port <port> --no-open` with `JSCAD_TRACKED=1`, `JSCAD_CHAT_LOG=logDir`; resolves on the stdout line `jscad: <dir> → <url>/#...` with the full page URL; rejects after 120 s, or on early exit, with the last 20 lines of stderr. First checks the port is free and rejects `port <n> is in use`.
  - `defaultFiles.js`: `productionDefaultFiles(webDir) -> { 'main.js': string, '02-hierarchical-car.example.js': string }` read from `examples/jscad/jscad-examples/01-two-cars.example.js` and `02-hierarchical-car.example.js`, the same pair `defaultProjectFiles` stores in a fresh production project (`src/projectFiles.js`). `seedModelDir(dir, files)` writes them. This replaces the spec's launcher flag: a directory that already holds `.js` files is never scaffolded (`scripts/local/scaffold.js`), so no launcher change is needed.
  - `pageDriver.js`: `openSession(browser, { url, key, model, vision }) -> Promise<driver & { chatIds(): string[], rounds(): number, close() }>`. Seeds localStorage by init script: `jscad-ai.tos` = `seedTos()`, `jscad-studio.key` = `{mode:'device', key}`, `jscad-ai.selection` = `{kind:'opencode-go', model, baseUrl:'', api:'fluent', keyMode:'device'}`, `jscad-ai.vision-overrides` = `{[model]: true}` when `vision`, `jscad-harness` = `'1'`. Navigates to `url`, `waitForRender`, opens the chat (`#menu-button`, `#ai-chat-btn`). Records each request to `/api/relay/` with its `x-jscad-chat-id` header. `send(text)` fills `.chat-input` and clicks `.chat-send`. `waitTurn` polls with `page.waitForFunction` (no shell loops) for either `.chat-send` without class `running` or an open `.chat-question` (read `aiChat.js`'s question card to tell an open card from an answered one), answers a question by filling `.chat-input` and clicking `.chat-send`, and returns `{timedOut:true}` past `timeoutMs`. `stop()` clicks `.chat-send` while running. `lastAssistantText()` reads the last `.chat-msg.assistant`. The harness calls go through `page.evaluate` on `globalThis.jscadHarness`, rethrowing the page error's `name: message`.
  - `run-batch.mjs`: env `SYNTH_OUT` (default `chatLogDir()/synthetic`), `SYNTH_BUILDERS` (default all three), `SYNTH_SCENARIOS` (comma list, default all), `SYNTH_RUNS` (default 2), `SYNTH_DEADLINE_S` (default 6600: no session starts after it; unstarted ones go into the manifest as `skipped: true`), `SYNTH_TURN_TIMEOUT_MS`, `SYNTH_PORT` (default 5170). Steps: batch id = ISO time with `:` replaced by `-`; probe all role models with `probeModels`; `assertFree`; record probe in the manifest; a builder that fails availability is skipped and recorded; a sim user without vision critiques text-only. One lane per builder, lanes concurrent, sessions within a lane sequential. Per session: fresh `mkdtemp` model dir seeded with `scenario.files` or `productionDefaultFiles`, `startLauncher` on the lane port, `openSession`, `runSession`, then exactly one chat id must have been seen (else session error `no chat id seen`), `rounds` from the driver, `stumbles` from `countStumbles` of that chat id's conversation in the batch dir, save views as `views/<chatId>-t<turn>-<name>.png`, `addSession` + `writeManifest`, close page, stop launcher, delete the model dir. Write `index.txt` listing every file in the batch dir (relative paths) after each session, and write the batch id to `<SYNTH_OUT>/latest` at batch start. `jscaduiCommit` from `sourceStamp` (`scripts/local/build.js`); `scenarioSetCommit` from `git log -1 --format=%H -- packages/agent-loop/synth/scenarios`. Exit 0 unless the gate refused or every lane failed.

- [ ] **Step 1: Write the failing tests:**
  - launcher: `rejects when the port is in use` (open a `net` server on a port, call `startLauncher` with it, expect `port <n> is in use`); `rejects with stderr tail when the process exits early` (inject `spawnImpl` returning a fake child that writes `boom` to stderr and exits 1).
  - defaultFiles: `returns the two-cars pair under production names`, contents equal the example files on disk.
- [ ] **Step 2: Run** `npx vitest run synth/` in `apps/jscad-web`. Expected: FAIL.
- [ ] **Step 3: Implement** `launcher.js` (inject `spawnImpl` for the test), `defaultFiles.js`, then `pageDriver.js` and `run-batch.mjs`. Move `seedTos` into `e2e/helpers.js` and import it in both chat specs.
- [ ] **Step 4: Run** `npx vitest run synth/` and `npx vitest run` in `apps/jscad-web`. Expected: PASS.
- [ ] **Step 5: Docs.** "Synthetic sessions": `npm run synth -w @jscadui/jscad-web` (check the workspace name in `apps/jscad-web/package.json`), each env var with its default, where the batch lands.
- [ ] **Step 6: Commit** `feat(synth): browser runner driving the launcher app with a simulated user`.

---

### Task 6: Starting scenario set

**Files:**
- Create: `packages/agent-loop/synth/scenarios/*.js` (one per scenario), `packages/agent-loop/synth/scenarios/index.js` exporting `loadScenarios() -> Promise<Scenario[]>` (sorted by `name`), `packages/agent-loop/synth/scenarios.test.js`
- Reference: existing fixtures `eval/fixtures/{nameplate,shelf-bracket,spur-gears,toy-caboose,enclosure,turret-lower}.js`; production log `~/src/jscad-chat-evals/logs/prod/` (chat `bb17e98f…` at 2026-10-19T02:15:08Z, chat `8d3c5d92…`), read with `npm run read-log -w @jscadui/agent-loop -- --since 2026-10-19 --json`.

**Model:** `sonnet`. Writing from real sessions, judgment on checks.

**Interfaces:**
- Produces: each file `export const scenario = { name, category, prompt, persona, facts: string[], files?: Record<string,string>, checks?: (m, { solid } = {}) => Array<{ name, pass }> }`. `checks` read only `m` (the harness `measure({})` result: `dimensions`, `volume`, `boundingBox`, parts) and `solid` (the `check({})` result, e.g. `watertight`); no probes, no `params`, no `sections`.

Set (12): `jeep-1-10` (prompt `create a 1:10 scale model of a WW2 Willys Jeep`, facts include `about 340 mm long`, `display piece, not printed as one part`); `jeep-inspect-fix` (prompt `use the view tool to find errors in the Jeep and fix them`, `files` = the Jeep source from the 02:15:08Z bb17e98f request); `turret-gear-assembly` (from chat 8d3c5d92, 10:1 drives); `text-vertical-face` (raised lettering on the side of a box); `enclosure-lid`; `shelf-bracket`; `spur-gear`; `nameplate`; `caboose-toy`; and three for categories with no real session (pick e.g. a hinged part, a threaded or snap-fit pair, an organic/lofted shape). Prompts are casual user text, never specs, never naming an API. Fact cards hold what the persona knows (sizes, use, preferences) and nothing about code.

- [ ] **Step 1: Write the failing test** `scenarios.test.js`:
  - `loads twelve scenarios with unique names`.
  - `every scenario has a prompt, persona and at least one fact`.
  - `no prompt or fact names an API` (none matches `/jscad|fluent|@jscad|modeling|cuboid|require\(/i`).
  - `checks run on an empty measure without throwing` (`checks({}, {})` returns an array of `{name, pass}` with boolean `pass`).
  - `jeep-inspect-fix carries the Jeep source` (`files` has a `.js` entry longer than 1000 chars).
- [ ] **Step 2: Run** `npx vitest run synth/scenarios.test.js`. Expected: FAIL.
- [ ] **Step 3: Write** the 12 scenario files and `index.js`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(synth): starting scenario set`.

---

### Task 7: CI job, batch fetch, first batch

**Files:**
- Create: `ci/synth`, `ci/synth.conf`, `packages/agent-loop/synth/fetch-batch.js`, `packages/agent-loop/synth/fetch-batch.test.js`
- Modify: `ci/README.md` (new section "Synthetic sessions (`ci/synth`)"), `packages/agent-loop/package.json` (script `"synth:fetch": "node synth/fetch-batch.js"`)

**Model:** `sonnet`. Follows `ci/eval` and `eval/fetch-ci-results.js` patterns.

**Interfaces:**
- Consumes: `run-batch.mjs` env (Task 5); `sciPath`, `parseIndex` from `eval/fetch-ci-results.js`.
- Produces:
  - `ci/synth`: `bootstrap sources install deps grids workspace` as `ci/web` does, `JSCAD_SKIP_DOCS=1`, checks the keys file has `opencode-go` (message as `ci/eval`, never printing it), refuses if 5170–5191 are served, `npx playwright install chromium`, sources `ci/synth.conf`, runs `npm run synth -w <app workspace>` with `SYNTH_OUT=$WORKTREE/synth-results`.
  - `ci/synth.conf`: `SYNTH_BUILDERS`, `SYNTH_SCENARIOS`, `SYNTH_RUNS=2`, `SYNTH_DEADLINE_S=6600`, each with a one-line comment.
  - `fetch-batch.js JOB-ID`: reads the batch id from `synth-results/latest`, then `synth-results/<batch>/index.txt`, through `sci artifact`, copies each listed file into `chatLogDir()/synthetic/<batch>/`, binary-safe for PNGs, rejects any path containing `..`.

- [ ] **Step 1: Write the failing tests** for `fetch-batch.js` with an injected `run`: `copies every listed file into the batch dir`; `rejects a listed path with ..`; `writes PNGs byte for byte`.
- [ ] **Step 2: Run** `npx vitest run synth/fetch-batch.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `fetch-batch.js`, `ci/synth`, `ci/synth.conf`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Docs** in `ci/README.md`: push, settings, where results land, `npm run synth:fetch -w @jscadui/agent-loop -- JOB-ID`.
- [ ] **Step 6: Commit** `feat(ci): synth job and batch fetch`. The commit's own CI job also runs `ci/web` with the new e2e spec.
- [ ] **Step 7: Smoke batch.** Edit `ci/synth.conf` in the working tree only: `SYNTH_SCENARIOS=nameplate`, `SYNTH_RUNS=1`. Run `sci push jscadui/synth`, then wait with Bash `run_in_background` on `sci wait <JOB-ID>`. Expected: 3 sessions (one per builder), `manifest.json` with three entries each carrying a `chatId`. Restore the conf (`git checkout ci/synth.conf`). On failure, read `sci log <JOB-ID>`, fix, commit, repeat.
- [ ] **Step 8: Fetch and read.** `npm run synth:fetch -w @jscadui/agent-loop -- <JOB-ID>`, then `npm run read-log -w @jscadui/agent-loop -- --batch <batch>`. Expected: three labeled conversations with stumble counts.

---

### Task 8: chat-review skill and docs fold

**Files:**
- Modify: `.claude/skills/chat-review/SKILL.md`, `packages/agent-loop/docs/architecture.md`, `apps/jscad-web/docs/architecture.md` (if Task 2 left the hook under-described), `docs/backlog.md`
- Delete: `docs/superpowers/specs/2026-10-19-browser-session-generator-design.md`, `docs/superpowers/plans/2026-10-19-browser-session-generator.md`

**Model:** `sonnet`. Prose edits that must keep existing content.

- [ ] **Step 1: chat-review.** Scope: add tools, tool descriptions (`packages/agent-loop/src/tools.js`) and skills (`packages/agent-loop/skills/` or wherever `SKILLS` is defined; find it from `main.js`) to the editable set, still one change measured at a time. Step 1: a batch is reviewed as its own pass with `read-log --batch <id>`; plain `read-log` never includes synthetic logs. Step 2: failed calls and unbuilt turns come from the `failed`/`unbuilt` header counts (`log/stumbles.js`); corrections in a synthetic batch come from the manifest; in real logs they stay a judgment. Step 6: a harness change can also be measured by a new batch compared with `synth:compare`. Keep every existing rule.
- [ ] **Step 2: Fold the spec.** agent-loop `architecture.md`: the generator's parts and data flow (roles table, why sim-user calls bypass the relay, why grading happens in the browser, why synthetic logs sit two levels down, why the runner seeds the production default files instead of a launcher flag).
- [ ] **Step 3: Backlog.** Add two items: prune the scenario set after the first full batches; raise per-model concurrency above 1 once session length is measured.
- [ ] **Step 4: Delete** the spec and this plan.
- [ ] **Step 5: Commit** `docs: chat-review reads synthetic batches; fold the generator design into architecture docs`.
