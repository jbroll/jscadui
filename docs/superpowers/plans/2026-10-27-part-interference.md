# Part Interference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate parts that share volume fail the build; reference parts are checked but never exported.

**Architecture:** `@jscadui/model-tools` `check` computes real pairwise shared volume and reads each part's `reference` tag. `@jscadui/agent-loop`'s `assembleReport` turns interference and bad tags into build errors that keep the geometry. The worker copies a root node's `reference` tag onto its evaluated solids, and every export drops reference parts and ghosts.

**Tech Stack:** Node ESM, vitest, `@jscad/modeling` booleans and measurements, Playwright for the frame e2e test.

**Spec:** `docs/superpowers/specs/2026-10-27-part-interference-design.md`

## Global Constraints

- `INTERFERENCE_EPSILON = 0.001` (mm³); a pair sharing more is interference.
- `MAX_INTERSECTIONS = 300` candidate pairs intersected; the rest are counted as `interferenceUnchecked`.
- `interference.pairs` sorted by volume, largest first, at most 20; `interference.total` counts all.
- Error names: `InterferenceError`, `PartTagError`.
- Tag forms: `reference = '<reason>'` or `reference = { reason, allow?: [selector, ...] }`; selectors as `measure`'s `parts` (index, `"N-M"` range, anchor part name).
- Failed interference/tag reports keep `geometry` and `params`.
- `previewOnly` items are never parts: not checked, not exported.
- Comments: minimal, only the non-obvious why. Docs change in the same commit as the code.
- Commit on branch `interference-check`; never push, never open a PR. End commit messages with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never run plain `npm install`.

## Review Focus

- A tag on a nested array item or a non-geometry item: ignored by interference, no crash (Task 1 test).
- Two reference parts that overlap with no allow: interference, like a motor hitting a bearing (Task 1 test).
- An `allow` that names a part by anchor name rather than index (Task 1 test).
- A build whose only failure is interference still answers `measure` and `check` in the eval backend (Task 3 test).
- A geom2 array (2D outlines) never runs `intersect` and reports no interference (Task 1 test).

---

### Task 1: Interference and reference tags in model-tools `check`

**Files:**
- Create: `packages/model-tools/src/interference.js`
- Modify: `packages/model-tools/src/check.js` (`checkArray`, `check`), `packages/model-tools/src/measure.js` (export a selector resolver), `packages/model-tools/index.js` (export constants)
- Test: `packages/model-tools/test/interference.test.js`
- Docs: `packages/model-tools/README.md` (check's new fields)

**Model:** `sonnet` — new module with a pinned algorithm, tests from prose.

**Interfaces:**
- Produces: `check(geometry, { bed?, interference?: boolean })` (default `true`). For an array result adds, only when non-empty: `interference: { pairs: Array<{ a: string, b: string, volume: number, size: [x, y, z] }>, total: number }`, `references: Array<{ part: string, reason: string, allow?: string[], overlaps: Array<{ part: string, volume: number }> }>`, `tagErrors: string[]`, `interferenceUnchecked: number`. Exports `INTERFERENCE_EPSILON`, `MAX_INTERSECTIONS` from `index.js`.
- Produces in `measure.js`: `partIndexes(items, selector) → number[]` (throws the same errors `selectedItems` throws).

- [ ] **Step 1: Write the failing tests** in `interference.test.js`, building items with `@jscad/modeling` `primitives.cuboid`:
  - `two overlapping cubes are interference`: cubes size 10 at x 0 and x 5 → `interference.pairs[0]` is `{ a: '0', b: '1' }`, volume ≈ 500 (toBeCloseTo, 3), size ≈ `[5, 10, 10]`, `total` 1.
  - `cubes that touch at a face share nothing`: x 0 and x 10 → no `interference` key.
  - `a reference part collides`: second cube tagged `'NEMA 17'` → interference, and `references` is `[{ part: '1', reason: 'NEMA 17', overlaps: [] }]`.
  - `allow lets a reference overlap the named part`: second cube tagged `{ reason: 'film path', allow: ['0'] }` → no `interference`, `references[0].overlaps` is `[{ part: '0', volume: ≈500 }]`.
  - `allow takes an anchor part name`: same, with the first cube carrying anchors named `gate` (build with `@jbroll/jscad-anchors` as `packages/model-tools/test/measure.test.js` does) and `allow: ['gate']`.
  - `two reference parts collide`: both tagged, no allow → interference.
  - `a reference that allows itself is a tag error` → `tagErrors` contains `part 1: reference allows itself`.
  - `malformed tags`: `{}` (no reason), `{ reason: '' }`, `{ reason: 'x', allow: '0' }`, `{ reason: 'x', allow: ['9'] }` → one `tagErrors` entry each naming the part index.
  - `pairs are sorted largest first and capped at 20`: 22 cubes stacked at the same spot → `pairs.length` 20, `total` 231, `pairs[0].volume >= pairs[19].volume`.
  - `past MAX_INTERSECTIONS candidates are counted, not intersected`: mock nothing; 26 coincident small cubes (325 pairs) → `interferenceUnchecked` 25.
  - `interference: false skips the work`: overlapping cubes with `{ interference: false }` → no `interference` key.
  - `geom2 items never intersect`: two overlapping squares → no `interference` key.
  - `nested arrays and non-geometry items are skipped`: `[cube, [cube], 'x']` → no throw, no `interference`.
  - `previewOnly items are not parts`: overlapping cube with `previewOnly: true` → no `interference`.

- [ ] **Step 2: Run** `cd packages/model-tools && npx vitest run test/interference.test.js` — expected FAIL (module missing).

- [ ] **Step 3: Implement `interference(items) → { interference?, references?, tagErrors?, interferenceUnchecked? }`** in `interference.js`. Read `item.reference` from the raw item before `wrapOne` (wrapOne drops it). Candidates: geom3 pairs, neither `previewOnly`, bounding boxes overlapping strictly on all three axes (as `boxesOverlap` in `packages/agent-loop/eval/probe.js:295`). For each of the first `MAX_INTERSECTIONS` candidates, `measureVolume(booleans.intersect(a, b))`; above `INTERFERENCE_EPSILON` the pair overlaps; `size` is `measureDimensions` of the intersection, rounded to 1e-4. A pair is allowed when either side is a reference whose resolved `allow` holds the other's index; allowed pairs go to that reference's `overlaps`, the rest to `interference`. Call it from `checkArray` unless `options.interference === false`; thread the option through `check` → `checkGeom` → `checkArray`.

- [ ] **Step 4: Run** the new test file and the whole package: `npx vitest run` — expected all PASS.

- [ ] **Step 5: Commit** `feat(model-tools): check reports shared volume between parts and reference tags`.

### Task 2: Build report errors that keep geometry

**Files:**
- Modify: `packages/agent-loop/src/buildReport.js` (`assembleReport`, `buildReport`, `summarizeRun`)
- Test: `packages/agent-loop/test/buildReport.test.js`
- Docs: `packages/agent-loop/docs/user-manual.md`, "Tool routing and build reports"

**Model:** `sonnet` — small, but the report shape is shared by app and eval.

**Interfaces:**
- Consumes: Task 1's `check` fields.
- Produces: a report with `ok: false`, `error: { name: 'InterferenceError' | 'PartTagError', message }`, plus `geometry`, `params`, `warnings`, `console`, and `interference` / `references` copied from check. `references` also rides on ok reports. `interferenceUnchecked > 0` appends the warning `{ severity: 'warning', source: 'check', message: '<n> overlapping part pairs were not checked for shared volume' }`. `summarizeRun(run, measure, check)` calls `check(items, { interference: false })`.

- [ ] **Step 1: Write the failing tests**:
  - `interference fails the build and keeps the geometry`: `assembleReport` with `check` returning `{ watertight: true, interference: { pairs: [{ a: '0', b: '1', volume: 273.66, size: [29.4179, 44.5922, 14.5] }, ...4 more], total: 5 } }` → `ok: false`, `error.name` `'InterferenceError'`, `error.message` equals `parts 0 and 1 share 273.7 mm³ (a 29.4 x 44.6 x 14.5 mm region); 4 more pairs overlap. Separate parts must not share volume: move or resize one, or union them into one part. Purchased hardware is a reference part and is checked too (docs reference).`, `geometry.parts` present, `params` present, `interference.total` 5.
  - With `total: 1` the message has no "more pairs" clause; with `total: 2` it reads `1 more pair overlaps`.
  - `a bad tag fails the build`: `tagErrors: ['part 1: reference needs a reason']` → `PartTagError`, message is the tag errors joined with `; `, geometry kept.
  - `references ride on a passing report`.
  - `unchecked pairs add a warning`.
  - `summarizeRun asks check to skip interference`: a spy `check` receives `{ interference: false }`.

- [ ] **Step 2: Run** `cd packages/agent-loop && npx vitest run test/buildReport.test.js` — expected FAIL.

- [ ] **Step 3: Implement** in `buildReport.js`. Format volume to 1 decimal and size to 1 decimal. Tag errors win over interference when both are present.

- [ ] **Step 4: Run** `npx vitest run` in `packages/agent-loop` — expected all PASS.

- [ ] **Step 5: Commit** `feat(agent-loop): interference and bad reference tags fail the build report`.

### Task 3: Geometry gate, eval ghosts and eval export

**Files:**
- Modify: `apps/jscad-web/src/projectBuild.js` (`noGeometry`), `apps/jscad-web/src_frame/bundle.frame-worker.js:110` (`setRunSummary` check call), `packages/agent-loop/eval/backend.js` (`build` current geometry, `exportModel`, ghost filter)
- Test: `apps/jscad-web/test/project-build.test.js`, `packages/agent-loop/eval/backend.test.js`
- Docs: `packages/agent-loop/docs/user-manual.md`, "Tools in the eval"

**Model:** `sonnet` — two packages, small edits.

**Interfaces:**
- Consumes: Task 2's report shape (`geometry` present on interference failures).
- Produces: `noGeometry()` returns null whenever the last report has `geometry`; eval `current.geometry` set whenever the report has `geometry`.

- [ ] **Step 1: Write the failing tests**:
  - project-build: `an interference failure still has geometry for measure and check` → `noGeometry()` resolves null for a report `{ ok: false, entry: 'main.js', error: { name: 'InterferenceError' }, geometry: { parts: 2 } }`; a syntax-error report (no geometry) still answers `noGeometryError`.
  - backend: write a `main.js` returning two overlapping `cuboid`s → write result `ok: false`, `error.name` `'InterferenceError'`; then `measure({})` and `check({})` answer `ok: true`.
  - backend: `ghosts are not parts in the eval`: main returns a cube and an overlapping cube with `previewOnly: true` → write `ok: true`, `geometry.parts` 1.
  - backend: `export drops reference parts`: base cube plus a separate tagged cube (`reference = 'motor'`) → `export({ format: 'stl' })` result size is smaller than the same model untagged (or compare triangle counts if the result exposes them; read `exportModel` to pick the stronger assertion).

- [ ] **Step 2: Run** `cd packages/agent-loop && npx vitest run eval/backend.test.js` and `cd apps/jscad-web && npx vitest run test/project-build.test.js` — expected FAIL.

- [ ] **Step 3: Implement.** Eval `build`: `geometry = [loaded.value].flat(Infinity).filter((g) => !g?.previewOnly)`; keep geometry when `report.geometry`. `exportModel`: filter `!g.reference`. Frame `setRunSummary`: pass `{ interference: false }` through the `check` it hands `summarizeRun` (Task 2 already passes it; make sure the frame lambda forwards its second argument).

- [ ] **Step 4: Run** both test files, then `npx vitest run` in each package — expected all PASS.

- [ ] **Step 5: Commit** `feat: an interfering build keeps its geometry for measure, check and view`.

### Task 4: Worker carries the tag; exports drop reference parts

**Files:**
- Modify: `packages/worker/worker.js` (`evaluateStreamed` ~:370, `evaluateNodes` ~:450, `evaluateScratch` ~:764, `jscadExportData` ~:786), `apps/jscad-web/src_frame/bundle.frame-worker.js` (`serialize` ~:118)
- Test: `packages/worker/worker.reference.test.js` (new, modeled on `worker.ghosts.test.js`), `apps/jscad-web/test/with-solids.test.js` or the test that covers frame export, `apps/jscad-web/e2e/frame.spec.js`
- Docs: `docs/WORKER_PROTOCOL.md` or `apps/jscad-web/docs/architecture.md`, wherever `previewOnly` is described

**Model:** `opus` — tree evaluator and streaming paths, Manifold class instances.

**Interfaces:**
- Consumes: the tag shape from the spec.
- Produces: every solid evaluated from a root node whose own `reference` is set carries the same `reference` value (assigned directly, not spread); `workerState.solids` keeps reference parts; worker and frame exports omit solids with `reference` or `previewOnly`.

- [ ] **Step 1: Write the failing tests**:
  - worker: `a reference set on a returned tree node reaches the evaluated solid` — through the tree evaluator path the worker tests already use; assert the stored solid has `reference` deep-equal to the tag, for the plain, streamed and scratch paths.
  - worker: `export leaves out reference parts and ghosts`.
  - frame unit test (pick the one covering `serialize`): reference solids are not serialized.
  - e2e `frame.spec.js`: `jscadCheck reports shared volume between overlapping parts` — load a script returning two overlapping cuboids through the frame, call `jscadCheck`, expect `interference.pairs[0].volume` ≈ 500. This proves `booleans.intersect` and `measureVolume` work on the frame's tree-bundle `@jscad/modeling`. If they do not, fix model-tools to evaluate or use the bundle's eager path, and add the case to Task 1's tests.

- [ ] **Step 2: Run** `cd packages/worker && npx vitest run worker.reference.test.js` — expected FAIL.

- [ ] **Step 3: Implement** the copy beside the `previewOnly` handling (`isRootGhostNode`, :247) and the export filters.

- [ ] **Step 4: Run** `npx vitest run` in `packages/worker` and `apps/jscad-web`; run the one e2e test: `cd apps/jscad-web && npx playwright test e2e/frame.spec.js -g "shared volume"` — expected PASS. If the e2e cannot run locally, say so; CI runs it on commit.

- [ ] **Step 5: Commit** `feat(worker): reference parts keep their tag through evaluation and stay out of exports`.

### Task 5: Agent-facing text and backlog

**Files:**
- Modify: `packages/agent-loop/src/tools.js` (`check` description, `measure.overlaps` description), `packages/agent-loop/src/docs.js` (new `REFERENCE_QUERY` / `REFERENCE_ANSWER` beside `PARAMS_ANSWER`), `packages/agent-loop/prompt.md` (one sentence in the tool policy), `docs/backlog.md`
- Test: `packages/agent-loop/test/docs.test.js`, `packages/agent-loop/test/tools.test.js`, `packages/agent-loop/test/prompt.test.js` if it pins prompt text

**Model:** `sonnet` — copy against fixed facts.

**Interfaces:**
- Consumes: the tag forms and report fields from Tasks 1-2.
- Produces: `docs('reference')`, `docs('interference')` and `docs('overlap')` answer `REFERENCE_ANSWER`.

- [ ] **Step 1: Write the failing tests**: docs returns `REFERENCE_ANSWER` for each of the three queries, in both API styles; the `check` tool description mentions `interference` and `references`; the `overlaps` description says bounding boxes only.

- [ ] **Step 2: Run** `cd packages/agent-loop && npx vitest run test/docs.test.js test/tools.test.js` — expected FAIL.

- [ ] **Step 3: Write the text.** `REFERENCE_ANSWER` covers: each item of main()'s array is a separate part; parts sharing volume fail the build with InterferenceError; no allowance for press fits, size the pocket; a reference part (`part.reference = 'reason'`, or `{ reason, allow: ['gate'] }`) is shown and checked but never exported; set the tag last, on the object main returns, or the app loses it; `allow` takes measure's part selectors and only exempts pairs with that reference part; every allowed overlap is listed in the build report's `references`. Short sentences, both styles' syntax identical. `prompt.md`: one sentence, per the spec. Backlog: two items from the spec's out-of-scope list, each with this chat id.

- [ ] **Step 4: Run** `npx vitest run` in `packages/agent-loop` — expected all PASS.

- [ ] **Step 5: Commit** `docs(agent-loop): teach reference parts and interference errors`.

### Task 6: Replay the film holder

**Files:**
- Create: `packages/agent-loop/eval/fixtures/film-holder-interference.js` only if it fails on the current prompt (per `.claude/skills/chat-review/SKILL.md`); otherwise nothing in the repo.

**Model:** `sonnet`.

- [ ] **Step 1:** Rebuild the project files of chat `972a48f1-8caa-4412-aa22-cb7e03f76087` as they stood before turn 3's last `write` (`npm run read-log -w @jscadui/agent-loop -- --since 2026-10-28T00:00:00Z --json`, applying each `write` and successful `edit` in order). Keep the scratch in the session scratchpad, not the repo.
- [ ] **Step 2:** Build them through the eval backend (`createBackend` in `packages/agent-loop/eval/backend.js`). Expected: `ok: false`, `error.name` `InterferenceError`, the base/supply-reel pair listed with ≈273.7 mm³.
- [ ] **Step 3:** Report the result; no commit unless a fixture was added.

### Final step (controller)

Fold the spec's decisions into `packages/agent-loop/docs/user-manual.md` and the model-tools README if not already there, delete the spec and this plan, commit `chore: drop the interference spec and plan`.
