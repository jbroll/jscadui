# 2026-10-11 backlog remediation plan

Scope: the open review findings that carry stable IDs in `docs/backlog.md`
(`PRJ4`, `API11`-`API14`, `REF17`, `REF18`) plus the small, self-contained
findings that had no ID (`TRN1`, `TRN2`, `LIB1`, `API15`, `FMT1`). Findings and
their requirement text live in `docs/backlog.md` under the ID index. This plan
only references IDs.

New IDs registered for this round: `TRN1` (`_$f$obj` renamed key), `TRN2`
(`cleanExports.defaultText`), `LIB1` (missing font fatal in browser), `API15`
(trim chat context files), `FMT1` (3MF `matrix2str`). Reserved for findings
discovered mid-run: `SEC3+`, `PRJ5+`, `UI7+`, `API16+`, `REF19+`, `TRN3+`,
`LIB2+`, `FMT2+`.

Excluded by decision or size (not in any group):
- Deploy-only security findings with no code in this repo (relay `trust proxy`,
  launcher `/models/` Host/Origin gate, CSP/COOP): `deploy.sh` is external.
- External-only: `API4` (jscad-fluent pin), jscad-fluent 0.7.0 publish.
- Breaking/out-of-scope refactors: `REF1`, `REF3`, `REF4`, `REF5`, `REF7`,
  `REF9`, `REF10`.
- Large, design-needing library bugs deferred with the rest of their bullet:
  `!` root modifier (`LIB2`, needs a `main()` root-selection channel), the
  font **propagation/cache-identity/`textmetrics`** parts (`LIB3`), grid ghosts
  (`LIB4`, needs the claim/stream protocol to carry `previewOnly`).
- GPU/model-dependent work: render sweep triage, OpenSCAD comparison, jscad
  engine perf, complex-grader calibration, dialogue/assembly/skill eval groups.

## Decisions

| ID | Blocks | Question | Options | Recommendation |
|---|---|---|---|---|
| D1 | storage-persistence | IndexedDB is absent in the compute frame and in private-mode browsers. Behaviour when `indexedDB` is unavailable? | (a) fall back to the in-memory `Map`s, keep the dirty flag; (b) throw at boot. | (a). The frame never uses `local.js`; a private-mode user keeps working, just without persistence. |
| D2 | chat-context-trim | Where does "most recently mentioned" come from? The app's `forModel` (`aiChat.js:29`) strips `toolCalls`, so `buildMessages` sees no paths. | (a) preserve `toolCalls` through `forModel` and read `input.path` in `buildMessages`; (b) pass an explicit recency list from the app's tool handler. | (a). Keeps one source of truth and covers the eval too. Give the project block its own budget, drop oldest-mentioned first. |
| D3 | demo-dedupe | Shared home for `observeResize`/`testThree`/`esbuildUtil`/the vue3 modules. | (a) new workspace package (e.g. `packages/demo-utils`) reachable by both Vite and esbuild; (b) relative imports into `apps/jscad-web`. | (a). `vue3-jscad` (Vite) cannot import from `apps/jscad-web` cleanly. |
| D4 | crt-sandbox | Where the tmpfs `size=` and `cpus` limit are applied. `configProblem` (`sandbox.js:359-382`) rejects any `mount` line in `ci/jscad-eval.crt`. | (a) allow a `mount` line for the sized tmpfs and add a `--cpus` arg, updating `configProblem`; (b) crt CLI flags only. | (a). Only `mount`/`env`/`keep-fd` are rejected today; loosen for the tmpfs mount. Live crt verification is a host step. |
| D5 | fmt-3mf | `@jscadui/3mf-export` workspace claims 0.5.0 but differs from the registry. | (a) fix `matrix2str` to pass string transforms through, keep the workspace, publish 0.6.0 later; (b) drop the workspace, resolve registry 0.5.0. | (a). Immediate correctness for manifold-3d without dropping the #131 rewrite; publishing is a follow-up (manifold declares `^0.5.0`, so 0.6.0 needs its range widened externally). |

## Waves

Wave 1 (nine groups, pairwise no shared files — run in parallel):
`storage-persistence`, `openscad-exports`, `eval-grader`, `params-ui-split`,
`crt-sandbox`, `fmt-3mf`, `chat-context-trim`, `font-missing-tolerant`,
`demo-dedupe`.

Wave 2 (conflicts; run after the wave-1 groups named):
`api-help-extract` — after `storage-persistence` (shared `main.js`) and
`demo-dedupe` (shared `test/apiIndex.test.js`).

## Conflicts

| Group pair | Shared file(s) |
|---|---|
| storage-persistence / api-help-extract | `apps/jscad-web/main.js`, `apps/jscad-web/docs/architecture.md` |
| demo-dedupe / api-help-extract | `apps/jscad-web/test/apiIndex.test.js`, `apps/jscad-web/src_build/esbuildUtil.js` |

Wave-1 groups share no file with each other. `storage-persistence` owns
`apps/jscad-web/main.js` for the whole of wave 1, so `api-help-extract` waits.

## Groups

### storage-persistence (tier: most capable)
Items: PRJ4, API14. Needs: D1.
Files: `apps/jscad-web/src/storage/{local.js,idb.js (new),session.js,rowboat.js,disk.js}`,
`apps/jscad-web/src/aiDeps.js` (`createProjectTools` deps `:17-32`, `save :54-65`,
`remove :67-77`), `apps/jscad-web/main.js` (`:366` instantiation, `:897-932`
storeFile/removeFile deps), `packages/agent-loop/src/tools.js:59-60` (delete
description), `apps/jscad-web/test/{storage-interface,storage-session,storage-rowboat,storage-disk,aiDeps,disk-project}.test.js`,
`apps/jscad-web/README.md`, `apps/jscad-web/docs/architecture.md` (`:1205-1249`
storage, `:940-948` delete).
Notes: PRJ4 backs `local.js` with IndexedDB (new `idb.js`); the public methods
are already `async` and every consumer already `await`s, so keep
`createLocalStorage()` synchronous and open the DB lazily behind a `ready`
promise. `kindFromEntry` (`local.js:1`) must stay exported (`rowboat.js:2`,
`disk.js:1`). API14 adds `removeFiles` (or a delete sentinel) to local/rowboat/
disk and `removeThrough` to `session.js`, wires a `removeFile` dep in
`main.js`, and uses it in `aiDeps.js`'s `remove`, then updates the
`tools.js` description. Fix the two stale backlog doc anchors while here
(root `README.md:156-170` and root `docs/architecture.md:1111-1116` no longer
exist; the storage prose is in `apps/jscad-web/`).
Verify: `npx vitest run` in `apps/jscad-web` (storage, aiDeps, disk-project,
projects-ui, reloadDetection).

### openscad-exports (tier: standard)
Items: TRN1, TRN2.
Files: `packages/openscad/src/transpiler/statements.ts` (`transpileFunctionDeclaration`
`_$f$obj` wrapper `:1703-1720`, `objectDestructureNames` `:1706-1710`,
`objectCode :1720`), `packages/openscad/src/transpiler/cleanExports.ts`
(`defaultText :8-14`, `paramsOf :16-22`),
`packages/openscad/test/function-args.test.ts`, `test/clean-exports.test.ts`,
`packages/openscad/ARCHITECTURE.md`.
Notes: TRN1's cited function `buildDestructurePattern` (`statements.ts:1088-1124`)
is correct; the bug is that the `_$f$obj` wrapper joins shorthand
`{ screw$1, k }` instead of the aliased form the module path emits. Emit
`${paramName}: ${renamedParam}` there. TRN2 strips `//` and `/* */` from the
sliced default text and defines the no-file fallback (today unreachable through
`parse()`, which always supplies a `CodeFile`); pin both with tests.
Verify: `npx vitest run test/function-args.test.ts test/clean-exports.test.ts`
in `packages/openscad`; root `npm run typecheck`.

### eval-grader (tier: standard)
Items: API12.
Files: `packages/agent-loop/eval/complex.js` (`renderFacts :96-99`,
`harnessGates :36-44`, `connectedGroups :19-34`),
`packages/agent-loop/eval/probe.js` (`MAX_BODIES :19`, `runProbe :320-343`),
`packages/agent-loop/eval/complex.test.js`, `eval/probe.test.js`,
`packages/agent-loop/docs/user-manual.md` (`:817-826`, `:947-952`).
Notes: read `bodyCount` when `bodiesCapped` is set, for the render facts' part
count and for the `connected` grouping; treat a capped group list conservatively.
No existing fixture reaches the cap.
Verify: `npx vitest run eval/complex.test.js eval/probe.test.js` in
`packages/agent-loop`.

### params-ui-split (tier: standard)
Items: REF17.
Files: `packages/params-ui/src/ParamsTree.js` (920 lines; `createParamsTree`
`:33-643`, `createClassInput :353-560`, `paramsTreeStyles :649-920`),
`packages/params-ui/src/inputs.js`, new `createClassInput.js` (and/or a
render module), `packages/params-ui/test` (`ParamsTree.test.js`,
`ParamsTree.cleanup.test.js`, `inputs.test.js`).
Notes: pure extraction, no behaviour change. `createClassInput` (about 200
lines) is the first seam; keep the returned controller API
(`update`/`destroy`/`setShowHidden`/`collapseAll`/`expandAll`/`getExpandedPaths`/`reset`)
and `paramsTreeStyles` export intact. Only consumer is `apps/jscad-web`.
Verify: `npm test -w packages/params-ui`.

### crt-sandbox (tier: standard)
Items: API11. Needs: D4.
Files: `packages/agent-loop/eval/sandbox.js` (`ISOLATION :130`,
`crtRunArgs :161-185`, `probe :278-317`, `limitInForce :326-335`,
`configProblem :359-382`, `notEnforced :410-411`, `sandboxProblem :416-478`),
`ci/jscad-eval.crt`, `scripts/eval-sandbox-setup.sh`,
`packages/agent-loop/eval/sandbox.test.js`, `eval/sandbox-crt.test.js`,
`packages/agent-loop/docs/architecture.md` (`:573-586`).
Notes: size the private `/tmp` and `/dev/shm` tmpfs; set `memory.swap.max`
with `memory.max`; fail (not warn) when a requested limit cannot be applied;
pass a `cpus` limit. `configProblem` rejects any `mount` line, so it must be
loosened for the sized tmpfs mount. The live crt suite is `skipIf(problem)`, so
unit tests gate locally and live verification is a host step.
Verify: `npx vitest run eval/sandbox.test.js` in `packages/agent-loop`.

### fmt-3mf (tier: cheap)
Items: FMT1. Needs: D5.
Files: `file-format/3mf-export/src/matrix2str.js` (`:14-33`),
`file-format/3mf-export/package.json` (add a `test` script),
new `file-format/3mf-export/test/matrix2str.test.js`.
Notes: manifold-3d passes a 16-element array of `toFixed` strings;
`matrix2str` currently maps every non-number to `0`. Restore pass-through for
string transforms while keeping the length-16 validation and the number-only
NaN/Infinity guard. Pin with a unit test; no behaviour change for the registry
copy.
Verify: `npx vitest run` in `file-format/3mf-export`.

### chat-context-trim (tier: standard)
Items: API15. Needs: D2.
Files: `packages/agent-loop/src/context.js` (`CONTEXT_BUDGET :1`,
`filesSection :16-26`, `projectMessage :35-44`, `buildMessages :46-56`),
`apps/jscad-web/src/aiChat.js` (`forModel :29-30`, `buildMessages` call `:387-391`),
`packages/agent-loop/eval/run-eval.js` (`:237-248`),
`packages/agent-loop/test/context.test.js`,
`packages/agent-loop/docs/{architecture,user-manual}.md`.
Notes: the project files section is emitted in full, alphabetically, ignoring
the budget. Trim to a project-block budget, most-recently-mentioned first,
binary skipped, `PROJECT_NOTE` preserved. Recency comes from `toolCalls[].input.path`
preserved through `forModel` (D2a).
Verify: `npx vitest run test/context.test.js` in `packages/agent-loop`.

### font-missing-tolerant (tier: cheap)
Items: LIB1.
Files: `packages/agent-loop/src/scadHandler.js` (`:175-187`),
`packages/agent-loop/test/scad-handler.test.js`,
`packages/openscad/ARCHITECTURE.md` (`:177-189`).
Notes: a missing `.ttf`/`.otf` currently throws because `FILE_NOT_FOUND` is
fatal. Soften it for font extensions only (warn and fall back, as
`run-jscad.js` and OpenSCAD do); a genuinely missing `.scad` include stays
fatal. `openscad-runtime/src/text.js:60-75` already has the fallback the frame
never reaches.
Verify: `npx vitest run test/scad-handler.test.js` in `packages/agent-loop`.

### demo-dedupe (tier: standard)
Items: REF18. Needs: D3.
Files: `apps/{cardboard-cutter,engine-test,model-page,vanilla-three}/src/observeResize.js`
(4 identical), `apps/{cardboard-cutter,engine-test,model-page}/src/testThree.js`
(3 identical), `apps/{engine-test,linearcs,model-page,jscad-web}/src_build/esbuildUtil.js`
(4 drifted), `apps/vue3-jscad/src/jscad/` (12 older modules), the new shared
package, and the consumers listed in each app's `main.js`/`build.js`.
Notes: two of the `esbuildUtil` copies are not interchangeable (`linearcs`
aliases `buildBundle`); reconcile rather than pick one. In the vue3 cluster,
`stacktrace.js`, `welcome.js` and `jscad.example.js` have **no** importer
(contradicting "every copy has a live consumer") — confirm dead, then delete.
Each app must build after the move.
Verify: build each consuming app (`engine-test`, `linearcs`, `model-page`,
`cardboard-cutter`, `vanilla-three`, `vue3-jscad`, `jscad-web`);
`npx vitest run test/apiIndex.test.js` in `apps/jscad-web`.

### api-help-extract (tier: standard) — wave 2 (after storage-persistence, demo-dedupe)
Items: API13.
Files: new `apps/jscad-web/src/apiHelp.js` (`apiHelpStyles :32-150`, `el`,
`errorMessage`, `helpPanel`, `closeHelp`, `onHelpKey`, `showApiHelp :190-248`
moved out of `apiIndex.js`), `apps/jscad-web/src/apiIndex.js` (keep
`createIndexLoader :16-23` and `createDocs :30`), `apps/jscad-web/main.js`
(`:71`, `:129`, `:312`, `:943`, `:993-996`), `apps/jscad-web/test/apiIndex.test.js`
(import + two dynamic imports), `apps/jscad-web/docs/architecture.md`
(`:895-900`, `:925-931`).
Notes: pure move, no behaviour change; `showApiHelp` keeps using `escapeCloses`
from `./panelEscape.js`; `apiHelp.js` imports the loader/`createDocs` types from
`apiIndex.js`.
Verify: `npx vitest run test/apiIndex.test.js` in `apps/jscad-web`.

## Execution

`supervising-parallel-remediation` runs this: fill free worktrees with wave-1
groups, review and fast-forward each as it lands, then run `api-help-extract`
once `storage-persistence` and `demo-dedupe` are in. Delete this file in the
commit that lands the last group.
