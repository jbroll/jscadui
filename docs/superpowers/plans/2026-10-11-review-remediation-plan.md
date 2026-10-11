# 2026-10-01 review remediation plan

Scope: the code-fixable findings from the 2026-10-01 review, plus the safe
Refactoring items. Findings live in `docs/backlog.md` under the ID index
("Remediation finding IDs"). Reserved for findings discovered mid-run:
`SEC3+`, `PRJ4+`, `UI7+`, `API11+`, `REF18+`.

Excluded by decision or dependency (not in any group):
- Deploy decisions with no code in this repo: relay `trust proxy`
  (`server/src/index.ts` + `deploy.sh`), the launcher `/models/` Host/Origin
  gate, CSP/COOP. See D9.
- GPU/model-dependent work: render sweep, OpenSCAD comparison triage, jscad
  engine perf, complex-grader calibration, dialogue/assembly/skill eval groups.
- `API4` (`jf.polygon` winding) — the fix is in the pinned jscad-fluent
  checkout, not this repo. See D3.
- Large structural refactors needing their own spec: `REF1` (async module
  loading), `REF3`, `REF4`, `REF5`, `REF7`, `REF9`, `REF10`, `REF17`.

## Decisions

| ID | Blocks | Question | Options | Recommendation |
|---|---|---|---|---|
| D1 | G | `PRJ1` dedupe lives in the out-of-repo `rowboat-client` (`/home/john/src/rowboat/packages/client`); the in-repo call is `src/storage/rowboat.js:110`. | (a) fix upstream, bump the `file:` pin; (b) hash-check in `rowboat.js` before upload; (c) defer. | (b) if upstream cannot change now, else (a). |
| D2 | G | `PRJ2` scope. | (a) full IndexedDB backing now; (b) minimal: warn before the sign-in redirect and on unload, keep the hash in `callbackURL`. | (b) now; IndexedDB as a follow-up spec. The storage docs already describe `local` as in-memory. |
| D3 | C | `API4` fix is outside this repo. | (a) edit `.deps-cache/jscad-fluent` and bump the pin; (b) defer to a jscad-fluent release. | (b) defer; the chat's reversal fallback already covers it. |
| D4 | M | `REF6`: jscad-web's non-proxy params path is dead. | (a) delete the dead path; (b) port animation to the params tree. | (a) this pass; the animation port is a separate spec. |
| D5 | K | `API5` delete-tool shape. | agree tool name and semantics across agent-loop, eval backend and app. | `delete({ path })`, success no-op when the file is absent. |
| D6 | G,H,I,J,K,L,M | `main.js`, `main.css`, `index.html`, `aiAccount.js`, `paramsUI.js` are shared by most of wave 2. | (a) keep wave 2 serial (skill default); (b) allow region-partitioned concurrent edits to the hot files. | (a). If (b), the supervisor must hand each group one file region. |
| D7 | C | `API3` target: the backlog names `src/hints.js`, but there are two (`apps/jscad-web/src/hints.js`, `packages/agent-loop/src/hints.js`). | (a) agent-loop shared `hints.js`; (b) both. | (a); add the app copy only if it holds the sibling table. |
| D8 | F | `REF15` scope. | (a) studio remnants only, plus opportunistic per-group label cleanup; (b) the full ~131-label sweep across ~41 files. | (a). A global sweep collides with every group's files. |
| D9 | — | Confirm the three deploy-only security items stay out. | (a) exclude; (b) re-scope to include a repo-side change. | (a). |

## Waves

Wave 1 (six groups, no shared files — run in parallel):
`sec-hardening`, `transpiler-cleanup`, `chat-hints-options`, `eval-guardrails`,
`worker-modelpath`, `studio-demo-cleanup`.

Wave 2 (all conflict on `main.js` and friends; run one at a time per D6):
`projects-storage` -> `ui-shell` -> `ui-interactions` -> `ui-chat` ->
`chat-help-panel` -> `chat-delete` -> `params-dead`.

Order inside wave 2 follows the conflicts: `chat-delete` after
`eval-guardrails` (shared `eval/backend.js`), `chat-help-panel` after
`chat-hints-options` (shared `api/index.json`).

## Conflicts

| Group pair | Shared file(s) |
|---|---|
| worker-modelpath / every wave-2 group | `apps/jscad-web/main.js` |
| worker-modelpath / ui-interactions, params-dead | `apps/jscad-web/src/paramsUI.js` |
| projects-storage / ui-shell | `apps/jscad-web/static/main.css`, `apps/jscad-web/e2e/project-ui.spec.js` |
| projects-storage / ui-interactions, ui-chat, chat-help-panel, chat-delete, params-dead | `apps/jscad-web/main.js` |
| projects-storage / ui-chat | `apps/jscad-web/src/aiAccount.js` |
| ui-shell / ui-interactions | `apps/jscad-web/static/index.html` |
| ui-shell / ui-chat | `apps/jscad-web/static/main.css` (`.chat-input`) |
| ui-interactions / params-dead | `apps/jscad-web/src/paramsUI.js` |
| chat-hints-options / chat-help-panel | `packages/agent-loop/api/index.json` |
| eval-guardrails / chat-delete | `packages/agent-loop/eval/backend.js` |

Wave-1 groups share no files with each other: `sec-hardening` (remote.js,
params-form), `transpiler-cleanup` (packages/openscad), `chat-hints-options`
(agent-loop hints/optionChecks/build-index), `eval-guardrails` (agent-loop
eval), `worker-modelpath` (packages/worker, packages/require, src_frame),
`studio-demo-cleanup` (studio remnants, demo apps).

## Groups

### sec-hardening (tier: standard)
Items: SEC1, SEC2.
Files: `apps/jscad-web/src/remote.js` (`fetchUrl` gzip branch 181-204),
`apps/jscad-web/test/remote.test.js`, `packages/params-form/src/params.js:114`.
Notes: SEC1 needs a new `#data:` gzip test with an output cap. SEC2 escapes
`inputType`; the package has no unit target, so verify via
`apps/jscad-web/e2e/params.spec.js`.
Verify: `npx vitest run test/remote.test.js` (in `apps/jscad-web`).

### transpiler-cleanup (tier: most capable)
Items: REF2, REF8.
Files: `packages/openscad/src/transpiler/transpile.ts`,
`managers/CodeGenState.ts`, `helpers/{color,extrusions,imports,transforms,vector}.ts`,
new `bundling/deduplicator.ts` and `bundling/symbolMerger.ts`.
Notes: REF8 is pure deletion (~354 lines) but removes the `used*` sets, so ~50
write sites in `expressions.ts`, `builtins.ts`, `statements.ts`,
`comprehensions.ts` go with it. REF2 moves `buildOutputCode` and the three
dedup loops; keep first-wins order. Land both together.
Verify: `npx vitest run` in `packages/openscad`; root `npm run typecheck`.

### chat-hints-options (tier: standard)
Items: API3, API8, API9. (API4 deferred per D3.)
Files: `packages/agent-loop/src/hints.js` (D7), `src/optionChecks.js`
(both agent-loop and `apps/jscad-web/src/optionChecks.js`),
`api/build-index.js`, generated `api/index.json`, `api/optionTable.js`,
`prompt/sheet-*.md`.
Notes: generator change — run `npm run api-index` and commit the regenerated
files in the same commit. Do not touch `eval/backend.js` (eval-guardrails owns
it) or `apps/jscad-web/src/aiAccount.js`.
Verify: `npx vitest run test/hints.test.js test/optionChecks.test.js
test/api-index.test.js` in `packages/agent-loop`.

### eval-guardrails (tier: standard)
Items: API1, API7, API10.
Files: `packages/agent-loop/eval/backend.js`, `eval/grade.js`, `eval/probe.js`,
`eval/sandbox.js`.
Notes: API1 restricts the CDN stub to the frame allowlist
(`src_frame/frameHost.js` `workerBundles`). API10 caps the `bodies` probe.
API7 re-tunes the conservation threshold.
Verify: `npx vitest run eval/backend.test.js eval/grade.test.js
eval/probe.test.js eval/sandbox.test.js` in `packages/agent-loop`.

### worker-modelpath (tier: most capable)
Items: REF11, REF12, REF13, REF14.
Files: `packages/worker/worker.js`, `packages/worker/src/state/workerState.js`,
`apps/jscad-web/src_frame/{bundle.frame-worker.js,frameHost.js,gridRun.js,optionWarnings.js}`,
`apps/jscad-web/main.js`, `apps/jscad-web/src/paramsUI.js`,
`packages/require/src/require.js`, `packages/require/package.json`,
`packages/worker/package.json`.
Notes: unify the superseded-error shape (REF12) in one helper; REF11 fixes the
free `importData` ReferenceError and drops unused `WorkerState` members; REF13
declares the sibling deps and drops `getLegacyCacheObjects`; REF14 stops the
silent catches. Owns `main.js` and `paramsUI.js` for wave 1, so no wave-2 group
starts until it lands.
Verify: `npm test -w packages/worker -w packages/require`;
`npx vitest run` in `apps/jscad-web`; `npm run typecheck`.

### studio-demo-cleanup (tier: cheap)
Items: REF15 (studio remnants only per D8), REF16.
Files: `apps/jscad-web/src/studioBridge.js` + its test,
`apps/jscad-web/server/src/index.ts` (`StudioServer` name, 37/47),
`apps/jscad-web/static/frame/index.html:15`,
`apps/{engine-test,cardboard-cutter,model-page,vanilla-three}/src/observeResize.js`,
`apps/{engine-test,cardboard-cutter,model-page}/src/testThree.js`,
`apps/{engine-test,linearcs,model-page,jscad-web}/src_build/esbuildUtil.js`,
`apps/vue3-jscad/src/jscad/` (12 files),
tracked `apps/linearcs/build_dev/`.
Notes: verify no other consumer before deleting the `vue3-jscad` copies and the
linearcs build output. Skip a global label sweep (D8); each group removes
labels in the files it already edits.
Verify: `npm run lint`; `npx vitest run test/frame-html.test.js` in
`apps/jscad-web`.

### projects-storage (tier: most capable) — wave 2, first
Items: PRJ1, PRJ2, PRJ3. Needs: D1, D2.
Files: `apps/jscad-web/src/storage/{local.js,rowboat.js,projects.js}`,
`src/aiAccount.js`, `src/fileSystem.js`, `main.js:440-486,488-502,1046-1055`,
`static/main.css:67-78`, `e2e/project-ui.spec.js:24-31`,
`test/storage-*.test.js`, `test/aiAccount.test.js`, `test/file-system.test.js`,
`test/projects-ui.test.js`, `README.md:155-204`, `docs/architecture.md:1164-1192`.
Notes: PRJ3 fixes the body `dragover`/`#dropModal` capture and the second
`extractEntries` call after an await (`main.js:497`); add the missing e2e that
drops on the row directly. PRJ2 per D2.
Verify: `npx vitest run test/storage- test/aiAccount.test.js
test/file-system.test.js test/projects-ui.test.js`; `npx playwright test
e2e/project-ui.spec.js`.

### ui-shell (tier: standard) — wave 2
Items: UI3, UI6.
Files: `apps/jscad-web/static/main.css` (117-129, 476-501, 700-723, 858-923,
952-986), `static/index.html` (75-78, 95-102), `src/error.js`,
`e2e/editor.spec.js`, `e2e/project-ui.spec.js`.
Notes: give `#ai-drawer`/`#project-drawer` one stacking rule; add the `.dark`
variants and a dismiss on `#error-message`. Add a dark-mode and a
dismiss e2e.
Verify: `npx playwright test e2e/editor.spec.js e2e/project-ui.spec.js`.

### ui-interactions (tier: most capable) — wave 2
Items: UI1, UI2, UI5.
Files: `apps/jscad-web/src/viewState.js`, `main.js` (600, 629-636, 853-891),
`src/paramsUI.js`, `src/editor.js`, `src/diskProject.js`, `src/saveFile.js`,
`packages/params-ui/src/ParamsTree.js`, `static/index.html:89-90`.
Notes: UI1 applies zoom in the viewer instead of re-running; UI2 carries
params/collapse state and adds a Reset control; UI5 makes Ctrl+S save to the
stored project. U2 crosses into `packages/params-ui`.
Verify: `npm test -w packages/params-ui`; `npx vitest run
test/params-ui.test.js test/param-change.test.js test/disk-project.test.js
test/saveFile.test.js`; `npx playwright test e2e/params.spec.js
e2e/editor.spec.js`.

### ui-chat (tier: standard) — wave 2
Items: UI4, API2.
Files: `apps/jscad-web/src/aiChat.js`, `src/aiAccount.js`, `main.js`,
`static/main.css` (`.chat-input` 1162-1165), `test/aiChat.test.js`,
`test/aiAccount.test.js`, `e2e/ai-chat.spec.js`.
Notes: keep the draft until the provider check passes, stop forcing scroll on
every chunk, unify the "Chat settings" copy, and add the API-style radio
(`persistSelection` must carry `api`).
Verify: `npx vitest run test/aiChat.test.js test/aiAccount.test.js`;
`npx playwright test e2e/ai-chat.spec.js`.

### chat-help-panel (tier: standard) — wave 2 (after chat-hints-options)
Items: API6.
Files: `apps/jscad-web/src/apiIndex.js`, `main.js` (321, 998),
`static/index.html` (menu 100-133), `packages/agent-loop/src/docs.js`,
`api/index.json`, `test/apiIndex.test.js`, `test/docs.test.js`.
Notes: a panel over `api/index.json` + `docsTool`; reads the file
`chat-hints-options` regenerated, so it runs after that group.
Verify: `npx vitest run test/apiIndex.test.js` (app);
`npx vitest run test/docs.test.js` (agent-loop).

### chat-delete (tier: standard) — wave 2 (after eval-guardrails)
Items: API5. Needs: D5.
Files: `packages/agent-loop/src/{tools.js,dispatchTool.js,project.js,index.js}`,
`eval/backend.js`, `apps/jscad-web/src/aiDeps.js`, `main.js` (chatTools
957-987), `test/tools.test.js`, `test/dispatchTool.test.js`,
`test/project.test.js`, `test/aiDeps.test.js`.
Notes: register `delete` in both tool lists and the eval backend; teach
`grade.js`'s `SAVES`/`free` classification about it. Shares `eval/backend.js`
with `eval-guardrails`, hence the order.
Verify: `npx vitest run test/tools.test.js test/dispatchTool.test.js
test/project.test.js` (agent-loop); `npx vitest run test/aiDeps.test.js`
(app).

### params-dead (tier: cheap) — wave 2 (last)
Items: REF6. Needs: D4.
Files: `apps/jscad-web/main.js` (166, 335, 505-563, 665-724, 803-818),
`src/paramsUI.js`, `src/animRunner.js`, `packages/params-core/src/createParamsProxy.js`,
`test/anim-runner.test.js`, `test/param-change.test.js`,
`e2e/frame.spec.js:34`.
Notes: per D4, delete the dead non-proxy path in jscad-web; remove the
`animRunner` labels while here. Do not touch `packages/params-core` behavior
that the demo apps still use.
Verify: `npx vitest run test/anim-runner.test.js test/param-change.test.js
test/params-ui.test.js`; `npm run typecheck`.

## Execution

`supervising-parallel-remediation` runs this: fill free worktrees with wave-1
groups, review and fast-forward each as it completes, then run the wave-2
chain in order. Delete this file in the commit that lands the last group.
