# Backlog Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the backlog items that cost chat users and the agent work: model wipes and stale builds, a reversed range, a racing editor buffer, opaque minified errors, unchainable `.scad` parts, unrecoverable agent writes, relay hangs and boot crashes, and the missing local fetch relay.

**Architecture:** Each task fixes one backlog item where the research located it (file:line below), with a test first, and deletes its `docs/backlog.md` item in the same commit. Undo reuses the existing per-turn version rows and `restoreVersion`. The fetch relay's page logic moves to a framework-free `.js` module that the server route and the local launcher both load.

**Tech Stack:** Node 24 ESM, vitest, jsdom, esbuild, Express + supertest (server), plain `node:http` (launcher).

**Spec:** `docs/backlog.md`, the items each task names; the research behind each task is summarized in its own text.

## Global Constraints

- Docs change in the same commit as the code: `apps/jscad-web/docs/architecture.md`, `apps/jscad-web/docs/user-manual.md`, `packages/agent-loop/docs/*.md` or `apps/jscad-web/server/RELAY.md`, whichever describes the behavior.
- Delete the `docs/backlog.md` item in the commit that completes it; leave the rest of an item that is only partly done, reworded.
- Comments: none by default; one or two lines saying why, never what.
- Modern browsers and Node 24 only; no polyfills or compat shims.
- Every commit runs the pre-commit gate (build, lint, typecheck, unit tests); never bypass it.
- App tests: `npx vitest run apps/jscad-web/test/<file>`; server tests: `cd apps/jscad-web/server && npx vitest run test/<file>`; package tests: `npx vitest run packages/<pkg>/<path>`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push, never open a PR.

## Review Focus

- Undo pressed while the editor holds unsaved edits: the discard confirm declines and nothing is restored (Task 8).
- A `.scad` export that returns a number, `undefined` or a list of mixed 2D and 3D parts under the fluent style: returned unchanged or wrapped per item, never thrown (Task 6).
- The local fetch relay asked for `http://127.0.0.1/` or a host resolving to a private address: refused with the server's `BlockedHostError`, never fetched (Task 13).
- A client that closes while the relay waits for `drain`: the record is logged once and the in-flight slot released (Task 10).
- `CHAT_LOG_RETAIN_DAYS=` (empty) at boot: treated as unset, the default window kept, nothing pruned (Task 9).

---

### Task 1: The worker keeps the model on a stray error or rejection

**Files:**
- Modify: `packages/worker/worker.js:91-102` (the `error` and `unhandledrejection` listeners)
- Test: create `packages/worker/worker.listeners.test.js`
- Modify: `docs/backlog.md` (delete "A stray scratch rejection clears the loaded model"); add the 2026-10-26 deploy to the Deploy section: "2026-10-26: deployed `9ae19c37`, the chat-review rounds of 10-20 to 10-26 (tool, hint, manifold and synth fixes, jscad-fluent pin `30a6c769`); smoke passed."

**Model:** `sonnet` — small change, but the test must capture listeners the other worker tests stub away.

**Interfaces:**
- Produces: nothing new; `workerState.clearGeometry()` stays for `jscadMain`'s own catch (`worker.js:568`).

- [ ] **Step 1: Write the failing test** `keeps the model when a stray rejection or error reaches the worker`: stub `globalThis.self = { addEventListener: (type, fn) => (listeners[type] = fn), postMessage }` before `await import('./worker.js')` (copy `reset()` from `worker.scratch.test.js:15-25`), set `workerState.solids = marker`, call `listeners.unhandledrejection({ reason: new Error('x') })` and `listeners.error({ error: new Error('y') })`, then `expect(workerState.solids).toBe(marker)`.
- [ ] **Step 2: Run it**: `npx vitest run packages/worker/worker.listeners.test.js` — FAIL (solids cleared).
- [ ] **Step 3: Implement**: both listeners log (`console.error`) and `resetScriptLock()`, and no longer call `workerState.clearGeometry()`. A failing build already clears its own geometry in `jscadMain`'s catch.
- [ ] **Step 4: Run** the new test and `npx vitest run packages/worker` — PASS.
- [ ] **Step 5: Commit** `fix(worker): a stray error or rejection no longer clears the model`.

### Task 2: A syntax-gated write is the last build

**Files:**
- Modify: `apps/jscad-web/src/projectBuild.js` (`createProjectBuilds`, add `recordReport`)
- Modify: `apps/jscad-web/src/aiDeps.js:84-134` (`save`, the `blocked` branch at 95-116)
- Modify: `apps/jscad-web/main.js` (wire the new dep where `createProjectTools` is built, ~1002-1039)
- Modify: `packages/agent-loop/eval/backend.js:353-381` (`saved`, the `blocked` branch at 361-373)
- Test: `packages/agent-loop/eval/backend.test.js:496-503` (`it.fails` → `it`), `apps/jscad-web/test/project-build.test.js`, `apps/jscad-web/test/aiDeps.test.js`, `apps/jscad-web/e2e/ai-chat.spec.js:187` (restore the `refused` round)
- Modify: `docs/backlog.md` (delete "A syntax-gated write leaves the previous build as the last build")

**Model:** `sonnet` — app, eval and e2e must agree.

**Interfaces:**
- Produces: `projectBuilds.recordReport(report)` — `report` is a build report `{ ok: false, entry, error, warnings, console, params }`; after it, `report()` resolves to it and `noGeometry()` answers `noGeometryError(report)`. `createProjectTools` takes a new dep `recordGated(report)`, wired in `main.js` to `projectBuilds.recordReport`.

- [ ] **Step 1: Write the failing tests**:
  - `project-build.test.js` `a recorded gated report is the last build, so measure answers the failure`: `b.recordLoad(url, { result: {} })`, then `b.recordReport({ ok: false, entry: 'main.js', error: { name: 'SyntaxError', message: 'Syntax error in: x' }, warnings: [], console: [], params: [] })`; `expect((await b.noGeometry()).error.message).toMatch(/the last build failed/)`.
  - `aiDeps.test.js` `a syntax-gated write records its report as the last build`: with `loadIndex: async () => index` and a `recordGated` spy, a write of `const x = ` calls `recordGated` once with `expect.objectContaining({ ok: false, error: expect.objectContaining({ name: 'SyntaxError' }) })` and never calls `build`.
  - `backend.test.js:496`: change `it.fails` to `it`.
- [ ] **Step 2: Run them** — FAIL.
- [ ] **Step 3: Implement**: `recordReport` sets `last = { entry: report.entry, report: Promise.resolve(report) }`; `save`'s `blocked` branch calls `recordGated(report)` before returning; the eval's `saved` sets `current = { report: gated }` in its `blocked` branch.
- [ ] **Step 4: Restore the e2e round**: in `ai-chat.spec.js`, `[written, measured, broken, refused, fixed, ran]` and the two dropped assertions (`expect(refused).toMatchObject({ ok: false, error: { name: 'NoGeometryError' } })`, `expect(refused.error.message).toMatch(/the last build failed/)`); delete the comment at line 225. The e2e runs in CI.
- [ ] **Step 5: Run** the unit tests above — PASS; `npx vitest run apps/jscad-web/test packages/agent-loop/eval/backend.test.js` — PASS.
- [ ] **Step 6: Commit** `fix(chat): a write refused by the syntax check is the last build`, with the `architecture.md` sentence on the gate updated.

### Task 3: `measure` refuses a reversed range

**Files:**
- Modify: `packages/model-tools/src/measure.js:38-45` (`selectorRange`)
- Test: `packages/model-tools/test/measure.test.js`
- Modify: `docs/backlog.md` (delete "`measure` accepts a reversed range")

**Model:** `haiku` — one guard, wording fixed here.

- [ ] **Step 1: Write the failing test** `measureParts refuses a range written high to low`: `expect(() => measureParts([cube(0), cube(10), cube(20), cube(30)], 'geom3', ['3-1'])).toThrow('part 3-1 runs high to low; write it 1-3')`.
- [ ] **Step 2: Run**: `npx vitest run packages/model-tools/test/measure.test.js` — FAIL.
- [ ] **Step 3: Implement**: in `selectorRange`, `if (from > to) throw new Error(\`part ${selector} runs high to low; write it ${to}-${from}\`)` before the range check. `measureBetween` and `axisOf` share it through `selectItems`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `fix(model-tools): measure refuses a part range written high to low`.

### Task 4: Opening a file keeps the old path until its text is in

**Files:**
- Modify: `apps/jscad-web/src/editor.js:278-293` (`openTreeFile`)
- Test: `apps/jscad-web/test/editor.test.js` (`describe('file tree')`)
- Modify: `docs/backlog.md` (delete "Opening a file renames the editor's buffer before its text loads")

**Model:** `sonnet` — the test needs a slow read.

- [ ] **Step 1: Write the failing test** `keeps the open file's path until the clicked file's text is in`: `vi.mock('@jscadui/fs-provider', …)` so `readAsText` returns a promise the test resolves by hand (keep the module's other exports with `vi.importActual`); open `/main.js`, click `/helper.js`, and before resolving `expect(editor.getPath()).toBe('/main.js')`; resolve with `'helper text'`, then `vi.waitFor(() => expect(editor.getPath()).toBe('/helper.js'))` and `expect(editor.getSource()).toBe('helper text')`.
- [ ] **Step 2: Run**: `npx vitest run apps/jscad-web/test/editor.test.js` — FAIL.
- [ ] **Step 3: Implement**: remove `currentFile = path` and the `editorFile.textContent = path` line (284-285); `setSource` (216-227) already sets both when the text arrives, for the buffered and the read path alike.
- [ ] **Step 4: Run** the editor tests — PASS.
- [ ] **Step 5: Commit** `fix(editor): opening a file keeps the old path until its text is in`.

### Task 5: Frame bundles keep their identifiers

**Files:**
- Modify: `apps/jscad-web/build.js` (frame bundles L237-328)
- Test: `apps/jscad-web/test/bundle-entries.test.js`
- Modify: `packages/agent-loop/src/optionChecks.js:410-411` comment, `apps/jscad-web/docs/architecture.md` (build section)
- Modify: `docs/backlog.md` (delete "Minified engine errors reach the agent")

**Model:** `sonnet` — build wiring plus a size measurement.

**Interfaces:**
- Produces: `const FRAME_ESBUILD = { minifyIdentifiers: false }` in `build.js`, spread into every frame bundle's options (`buildBundle(frameBuildDir, …, { …FRAME_ESBUILD, … })` and `buildOne` for `frame-worker`).

- [ ] **Step 1: Write the failing test** in `bundle-entries.test.js`, `every frame bundle keeps its identifiers`: read `build.js` text; every `buildBundle(frameBuildDir` and the `frame-worker` `buildOne` call includes `FRAME_ESBUILD`, and `FRAME_ESBUILD` is `{ minifyIdentifiers: false }`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the constant and spread it in.
- [ ] **Step 4: Measure**: `cd apps/jscad-web && node build.js`, then list `build/frame/assets/*.js` sizes and compare with the research table (jscad_modeling 278565, model_tree_manifold 106249, frame-worker 115496, jscad-fluent 23049, openscad 419188). Write the totals before and after in the commit message. If the frame's JS total grows by more than 30%, keep `minifyIdentifiers: false` only on `jscad_modeling`, the four `model_tree_*`, `jscad-fluent`, `jscad-anchors`, `model-tools` and `frame-worker`, and say so in the message.
- [ ] **Step 5: Run** `npx vitest run apps/jscad-web/test` — PASS. Update the `optionChecks.js` comment (fluent names are no longer minified; the factory probe stays because fluent exports no classes).
- [ ] **Step 6: Commit** `build(jscad-web): frame bundles keep their identifiers, so engine errors name real variables`.

### Task 6: `.scad` library parts are fluent shapes in fluent code

**Files:**
- Create: `packages/agent-loop/src/scadFluent.js`
- Modify: `packages/require/src/require.js` (L55-78: add `setScadExportsWrapper`, apply in `forCaller` to a project caller's `.scad` require)
- Modify: `packages/agent-loop/src/optionChecks.js` (`createWarningCollector` L461: add `getApi()`)
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js` (install the wrapper beside `installOptionWarnings`, ~L153)
- Modify: `packages/agent-loop/eval/backend.js` (install it; `runModel` already calls `warnings.setApi(api)` at L265)
- Test: create `packages/agent-loop/test/scadFluent.test.js`; add to `packages/agent-loop/eval/scad-backend.test.js`; add to `packages/require/test/*.test.js`
- Docs: `packages/agent-loop/docs/user-manual.md`, `apps/jscad-web/docs/architecture.md`; `docs/backlog.md` (delete "Wrap `.scad` library results for fluent code")

**Model:** `opus` — crosses the require system, the frame worker and the eval.

**Interfaces:**
- Produces:
  - `wrapScadExports(exports, jf)` → a new object: each own function except `RESERVED` names (`main`, `getParameterDefinitions`, `fn`, `vars`, `$meta`, `$scad`) becomes `(...args) => toFluent(fn(...args), jf)`; values pass through. `toFluent(value, jf)`: a geom3 or dim-3 tree node → `new jf.FluentGeom3(value)`; geom2 or dim-2 node → `new jf.FluentGeom2(value)`; an array → its items mapped; anything else unchanged. Use `jf.isGeom2`/`jf.isGeom3` and `isTreeNode` duck checks (`value.isTreeNode === true`, `value.dim`).
  - `setScadExportsWrapper(fn | null)` in `require.js`: `fn(exports, url)` is applied, cached per exports object, when the resolved module URL ends with `.scad` and the caller is a project file (`base.startsWith(root) && !base.endsWith('.scad')`).
  - `createWarningCollector(...).getApi()` → the current style.

- [ ] **Step 1: Write the failing tests**:
  - `scadFluent.test.js`: `wraps a 3D and a 2D result and maps a list`; `leaves numbers, undefined and reserved exports alone` (an export returning `5`, one returning `undefined`, `main` and `$meta` unchanged); `wraps a dim-3 tree node` (`{ isTreeNode: true, dim: 3, … }` with a `jf` stub whose `FluentGeom3` records its argument).
  - `require` test: `applies the .scad exports wrapper to a project caller only`.
  - `scad-backend.test.js` `a fluent project chains on a .scad part`: `const jf = require('@jbroll/jscad-fluent')\nconst { block } = require('Mini/mini.scad')\nmodule.exports = { main: () => block(M3_block).translate([10, 0, 0]) }` (copy `M3_block` from the existing test at L11) builds under `api: 'fluent'` with `measure` boundingBox min x shifted by 10; under `api: 'modeling'` the export is not wrapped (`.translate` absent).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `scadFluent.js`, the `require.js` hook, `getApi()`, and the installs: the frame worker sets `setScadExportsWrapper((exports) => runWarnings.getApi() === 'fluent' ? wrapScadExports(exports, require('@jbroll/jscad-fluent')) : exports)`; the eval does the same with its warning collector and its fluent module.
- [ ] **Step 4: Run** the three test files, then `npx vitest run packages/agent-loop packages/require apps/jscad-web/test` — PASS.
- [ ] **Step 5: Docs**: user manual (fluent code gets `.scad` parts as fluent shapes; modeling code gets them plain), architecture (where the wrapper is installed).
- [ ] **Step 6: Commit** `feat: fluent code gets .scad library parts as fluent shapes`.

### Task 7: Pin each turn's starting state as a version

**Files:**
- Modify: `apps/jscad-web/src/aiDeps.js:187-195` (`startTurn`, `endTurn`)
- Modify: `apps/jscad-web/main.js:1030-1036` (wire `pinTurnStart`)
- Test: `apps/jscad-web/test/aiDeps.test.js` (use `stored()` at 247-260)
- Docs: `apps/jscad-web/docs/architecture.md` (Storage, ~1375-1382; Agent loop, ~1121-1134)

**Model:** `sonnet` — storage semantics across local and rowboat.

**Interfaces:**
- Consumes: `storageSession.snapshotUnique(projectId, { message })`, `storageSession.listVersions(projectId)` → `[{ versionId, created, message }]` newest first, `peekMode(projectId)` (`'disk'` has no versions).
- Produces: dep `pinTurnStart(projectId) → Promise<string | null>` (main.js: `null` in disk mode; else `snapshotUnique(projectId, { message: 'before chat' })` then the newest `versionId`). `createProjectTools(...).startTurn()` stays sync; the first `save` or `remove` of a turn for a project awaits `pinTurnStart(projectId)` once before writing. `endTurn(excerpt)` resolves to `[{ projectId, versionId }]`, one per project the turn wrote, `versionId` being the pinned start.

- [ ] **Step 1: Write the failing tests** (with `stored()`): `pins the state before a turn's first write, once`: two writes in one turn → one `before chat` row, made before the first write's row; `adds no row when the pre-turn state is already the newest version`; `endTurn answers the pinned start version of each project written`; `pins nothing for a turn that wrote nothing`; `answers null in disk mode`.
- [ ] **Step 2: Run** `npx vitest run apps/jscad-web/test/aiDeps.test.js` — FAIL.
- [ ] **Step 3: Implement** in `aiDeps.js` and wire `pinTurnStart` in `main.js`.
- [ ] **Step 4: Run** `npx vitest run apps/jscad-web/test` — PASS.
- [ ] **Step 5: Commit** `feat(chat): pin each turn's starting files as a version before the agent writes`.

### Task 8: "Undo this turn's changes" in the chat

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js` (`finishTurn` 352-362, `renderLoaded` 391-403, the message stored at ~718, `initChat` options)
- Modify: `apps/jscad-web/main.js` (pass `restoreTurn` to `initChat`, ~1153-1170)
- Modify: `apps/jscad-web/static/*.css` where `.chat-tool` is styled (one rule for `.chat-undo`)
- Test: `apps/jscad-web/test/aiChat.test.js`
- Docs: `apps/jscad-web/docs/user-manual.md` (a short "Undoing the assistant's changes" section), `architecture.md` (Chat UI states, 869); `docs/backlog.md` (shrink "Agent writes can destroy the user's model" to its remaining half: `view` of a scratch model so experiments need no save)

**Model:** `sonnet` — UI plus persistence of a field.

**Interfaces:**
- Consumes: Task 7's `endTurn` → `[{ projectId, versionId }]`.
- Produces: `initChat({ …, restoreTurn })`, `restoreTurn(projectId, versionId) → Promise<boolean>` (true when restored). The assistant message persists `undo: [{ projectId, versionId }]` when the turn wrote. `main.js`'s `restoreTurn`: `if (!(await editor.confirmDiscard())) return false`, then `await projectManager.restoreVersion(projectId, versionId)`, `await switchProject(projectId)`, `refreshHeader()`, `return true`.

- [ ] **Step 1: Write the failing tests**: `shows an undo button after a turn that wrote, calling restoreTurn with the pinned version` (fake `endTurn` resolving `[{ projectId: 'p1', versionId: 'v9' }]`; click `.chat-undo`; `expect(restoreTurn).toHaveBeenCalledWith('p1', 'v9')`); `keeps the undo button across a reload` (stored conversation with `undo` on the assistant message, `switchTo` renders it); `shows no undo button for a turn that wrote nothing`; `leaves the button in place when the restore is declined` (`restoreTurn` resolving `false`); after a `true`, the button reads `Undone` and is disabled.
- [ ] **Step 2: Run** `npx vitest run apps/jscad-web/test/aiChat.test.js` — FAIL.
- [ ] **Step 3: Implement**: `finishTurn` stores `undo` on the reply and appends `button.chat-undo` ("Undo this turn's changes"); `renderLoaded` draws it for stored messages with `undo`; a click awaits `restoreTurn` for each entry, newest project last.
- [ ] **Step 4: Run** `npx vitest run apps/jscad-web/test` — PASS.
- [ ] **Step 5: Commit** `feat(chat): undo a turn's changes from the chat`.

### Task 9: The relay's log retention

**Files:**
- Modify: `apps/jscad-web/server/src/relay/chatLog.js` (export `chatLogFileName(ts)` and `CHAT_LOG_FILE`; use it at L43)
- Modify: `apps/jscad-web/server/src/relay/routes.ts:36-65,94-96` (use `CHAT_LOG_FILE`; clamp in `resolveRetainDays`)
- Test: `apps/jscad-web/server/test/relay.test.ts` (near L296), `apps/jscad-web/server/test/chatLog.test.js`
- Docs: `apps/jscad-web/server/RELAY.md`; `docs/backlog.md` (delete "Retention filename coupling is untested" and "Clamp `CHAT_LOG_RETAIN_DAYS`")

**Model:** `sonnet`.

**Interfaces:**
- Produces: `chatLogFileName(ts) → string` (`` `${ts.slice(0, 10)}.jsonl` ``), `CHAT_LOG_FILE` (`/^\d{4}-\d{2}-\d{2}\.jsonl$/`); `resolveRetainDays(override?)` → an integer in `[1, 3650]`: an unset, empty or non-numeric value is the default, a value below 1 is 1, above 3650 is 3650, a fraction is floored.

- [ ] **Step 1: Write the failing tests**: `prunes the files the writer names` (write through `appendChatRecord` for an old and a new `ts`, then `pruneChatLogs` removes only the old); `clamps the retention window`: `-5` keeps today's file, `1e9` mounts without throwing, `''` keeps the default (90).
- [ ] **Step 2: Run**: `cd apps/jscad-web/server && npx vitest run test/relay.test.ts` and `npx vitest run apps/jscad-web/server/test/chatLog.test.js` — FAIL.
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `fix(relay): prune by the writer's file name; clamp the retention window`.

### Task 10: The relay records a client that closes, and never hangs on drain

**Files:**
- Create: `apps/jscad-web/server/src/relay/pipe.js` (plain JS with JSDoc, `node:` imports only)
- Modify: `apps/jscad-web/server/src/relay/providers/default.js:67-102`, `providers/jscad.js:227-234`, `apps/jscad-web/scripts/local/relay.js:82-98`
- Test: create `apps/jscad-web/server/test/pipe.test.js`; add to `server/test/relay.test.ts` (connect abort on the default hook)
- Docs: `RELAY.md`; `docs/backlog.md` (delete "Client abort during connect logs a misleading 502" and "Drain-wait hang (pre-existing)")

**Model:** `sonnet`.

**Interfaces:**
- Produces: `writeOrClose(res, chunk) → Promise<boolean>`: `true` once written or drained, `false` when the response closed first (resolves on `'close'` as well as `'drain'`). Both providers' stream loops call it and stop reading on `false`.

- [ ] **Step 1: Write the failing tests**: `pipe.test.js` `resolves false when the response closes while waiting for drain` (an `EventEmitter` fake whose `write` returns `false`; emit `'close'`); `relay.test.ts` `records a client that closes during connect as 499 client closed` (the default hook with a `fetchFn` that rejects with an `AbortError` after the request's `close`; the logged record has `status: 499`, `error: 'client closed'`), mirroring `inference.test.ts` ~406.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `default.js`'s catch answers `tee?.finish(499, { error: 'client closed' })` and no 502 body when `abort.signal.aborted`; both stream loops use `writeOrClose`; `scripts/local/relay.js` does the same for its connect abort and awaits `writeOrClose`.
- [ ] **Step 4: Run** server and launcher tests — PASS.
- [ ] **Step 5: Commit** `fix(relay): record a client that closes during connect, and never hang waiting for drain`.

### Task 11: A corrupt spend file stops only the free models

**Files:**
- Modify: `apps/jscad-web/server/src/relay/routes.ts:114` (meter creation), `server/src/relay/providers/jscad.js` (meter use), `server/src/relay/meter.ts:118-139` (validate `ipSpend` values are finite numbers)
- Test: `apps/jscad-web/server/test/meter.test.ts`, `server/test/inference.test.ts`
- Docs: `RELAY.md`; `docs/backlog.md` (delete "Corrupt spend file stops the whole server"; in "Meter hardening", delete the non-numeric `ipSpend` clause)

**Model:** `sonnet`.

**Interfaces:**
- Produces: `mountRelayRoutes` catches a `createMeter` failure, logs it once (`logger({ event: 'meter-unavailable', error })`) and passes `meter: null`; the free hook answers `503 { error: 'free models unavailable: the spend state could not be read' }` when `ctx.meter` is `null`; keyed providers are unaffected.

- [ ] **Step 1: Write the failing tests**: `meter.test.ts` `refuses a state whose ipSpend holds a string`; `inference.test.ts` `a corrupt spend file leaves the relay up and the free models answering 503` (write `{` to the spend path, mount, POST to the free hook → 503 with that error; a keyed provider POST still reaches its `fetchFn`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `cd apps/jscad-web/server && npx vitest run` — PASS.
- [ ] **Step 5: Commit** `fix(relay): a corrupt spend file stops the free models only`.

### Task 12: Move the page fetch into a framework-free module

**Files:**
- Create: `apps/jscad-web/server/src/fetch/fetchPage.js` (plain JS with JSDoc, `node:` imports only, like `relay/policy.js`)
- Modify: `apps/jscad-web/server/src/fetch/routes.ts` (keep CORS, origin check, limiter and body parse; call `fetchPage`)
- Test: `apps/jscad-web/server/test/fetch.test.ts` stays green unchanged; create `apps/jscad-web/server/test/fetchPage.test.js` for the moved helpers

**Model:** `opus` — a refactor of security-relevant code that must not change behavior.

**Interfaces:**
- Produces: `fetchPage({ url, format, fetchFn, dnsLookup, timeoutMs }) → Promise<{ status, body }>`: the validation, redirect loop (`routes.ts` 197-272), caps (`MAX_CONTENT_CHARS` 8000, `MAX_BODY_BYTES` 2_000_000, `MAX_REDIRECTS` 5) and the 400/413/502 mapping, with `body` the exact JSON the route answers today. It also exports those three constants, `escapeFences`, `toText` and `isHttpUrl`.

- [ ] **Step 1: Write** `fetchPage.test.js` with three cases copied from `fetch.test.ts` (private address → 400 `BlockedHostError`; a redirect past 5 hops → 502; a 2.1 MB body → 413), calling `fetchPage` directly. Run — FAIL (module missing).
- [ ] **Step 2: Move** the code; `routes.ts` becomes the Express shell.
- [ ] **Step 3: Run** `cd apps/jscad-web/server && npx vitest run test/fetch.test.ts test/fetchPage.test.js` and `npx tsc --noEmit` — PASS, with every `fetch.test.ts` case unchanged.
- [ ] **Step 4: Commit** `refactor(fetch): the page fetch is a framework-free module`.

### Task 13: The local launcher serves /api/fetch

**Files:**
- Create: `apps/jscad-web/scripts/local/fetchApi.js`
- Modify: `apps/jscad-web/scripts/local/server.js:9-49` (route `/api/fetch`), `apps/jscad-web/scripts/jscad.mjs:68-70` (build and pass the handler)
- Test: create `apps/jscad-web/scripts/local/fetchApi.test.js` (real listening server, as `relay.test.js` does)
- Docs: `apps/jscad-web/docs/user-manual.md` (local launcher), `architecture.md` (the `webfetch` paragraph: the launcher now serves the relay; `NO_RELAY` stays for any server without one); `docs/backlog.md` (shrink "The local launcher has no page-fetch or search relay" to its `/api/search` half)

**Model:** `opus` — a network-facing route on the user's machine.

**Interfaces:**
- Consumes: Task 12's `fetchPage`; `policy.js`'s `isTrustedRequest`, `createLimiter`, `RATE_PER_MIN`.
- Produces: `createFetchHandler({ trustedOrigins, fetchFn = fetch, dnsLookup, timeoutMs }) → async (req, res) => boolean`, matching `fsApi.js`'s handler shape: OPTIONS and POST `/api/fetch`, origin check, limiter, JSON body capped at 16 KB, then `fetchPage`.

- [ ] **Step 1: Write the failing tests**: `fetches a public page for a trusted origin` (stub `fetchFn`, `dnsLookup` answering a public address); `refuses an untrusted origin with 403`; `refuses a private address` (`dnsLookup` → `127.0.0.1` → 400 `BlockedHostError`, `fetchFn` never called); `answers 404 for another path` (handler returns false).
- [ ] **Step 2: Run**: `npx vitest run apps/jscad-web/scripts/local/fetchApi.test.js` — FAIL.
- [ ] **Step 3: Implement** the handler and wire it into `server.js` and `jscad.mjs`.
- [ ] **Step 4: Run** `npx vitest run apps/jscad-web/scripts/local` — PASS.
- [ ] **Step 5: Commit** `feat(launcher): serve /api/fetch locally with the server's guards`.

### Task 14: Delete this plan

**Files:**
- Delete: `docs/superpowers/plans/2026-10-26-backlog-batch.md`

**Model:** `haiku`.

- [ ] **Step 1:** `git rm docs/superpowers/plans/2026-10-26-backlog-batch.md`; check no backlog item a task completed is left behind (`grep` each deleted heading in `docs/backlog.md`).
- [ ] **Step 2: Commit** `docs: remove the backlog batch plan`.
