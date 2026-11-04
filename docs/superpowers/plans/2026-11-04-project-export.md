# Project Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An **Export project (zip)** entry in the export dropdown downloads the project's files, `params.json`, the assembly STL and one STL per part captured from `main()`'s maker calls.

**Architecture:** The page synthesizes an in-memory entry, `.export-view.js` (like the part view's `.part-view.js`), that wraps every maker export, runs the real entry's `main(params)`, stashes the direct maker outputs on a frame global, and returns the assembly. The page exports the assembly with the existing `jscadExportData`, fetches the parts with a new frame command `jscadExportParts`, zips everything with `fflate.zipSync`, and reloads the viewer's model.

**Tech Stack:** browser JS (ESM), vitest, Playwright, fflate.

**Spec:** `docs/superpowers/specs/2026-11-03-project-export-design.md`

## Global Constraints

- Worktree `/home/john/src/jscadui/.worktrees/ui-small`, branch `feat/project-export`. Run git as `git -C /home/john/src/jscadui/.worktrees/ui-small …`.
- Model code runs only in the frame; the page never evaluates project code.
- No new dependency: `fflate` (`zipSync`, `strToU8`) is already in `apps/jscad-web`.
- STL inside the zip is binary STL: format id `stlb` (`@jscadui/format-common` `ExportFormats`; confirm the id in `defaultSerializerConfigs`).
- Unit tests: `npx vitest run <file>` from `apps/jscad-web`. e2e: Playwright specs in `apps/jscad-web/e2e/`.
- Commits run the pre-commit gate; never `--no-verify`. One commit per task; each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments: none unless they state a non-obvious why, one or two lines.

## Review Focus

- A maker that throws inside `main()`: the wrappers must still be restored and the error reach the error line (Task 2 test).
- Export while the chat is mid-turn or the viewer shows a part: the viewer and the chat's build must come back to what they held (Task 4 `borrow` test).
- Two exports in a row: the second must capture again, so the entry cannot stay cached with wrapped makers from the first (Task 4: cache clear before and after).
- A maker returning a Promise of an array: one part, flattened (Task 2 test).
- A project with no maker files at all: zip still holds code, `params.json`, assembly (Task 1 zip test).

---

### Task 1: Naming and zip assembly

**Files:**
- Create: `apps/jscad-web/src/projectExport.js`
- Test: `apps/jscad-web/test/project-export.test.js`

**Model:** `sonnet` — pure functions from prose.

**Interfaces:**
- Produces:
  - `partName(maker: string): string`. `makeTruck` → `truck`, `makeSideFrame` → `sideFrame`.
  - `stlEntries(parts: {maker: string, file: string, data: Uint8Array}[]): Record<string, Uint8Array>`. Keys are `stl/<name>.stl`. The input is in call order.
  - `zipProject({ name: string, files: Record<string, string|Uint8Array>, params: Record<string, unknown>, assembly: Uint8Array, parts: Record<string, Uint8Array> }): Uint8Array`

- [ ] **Step 1: Write the failing tests**
  - `partName('makeTruck') === 'truck'`
  - `partName('makeSideFrame') === 'sideFrame'`
  - One maker with one output gives `{'stl/truck.stl': a}`.
  - Three byte-identical outputs of `makeWheel` give `{'stl/wheel-x3.stl': a}`.
  - Outputs `a, b, a` of `makeWheel` give `{'stl/wheel-1.stl': a, 'stl/wheel-2.stl': b}`. Distinct outputs are numbered in first-seen order, and repeats fold into their first occurrence.
  - If identical and distinct outputs mix, a group with a count above 1 keeps its number and gets the count as well: `a, a, b` gives `wheel-1-x2.stl` and `wheel-2.stl`.
  - `makeSideFrame` exported from both `truck.js` and `lib/frame.js` gives `stl/truck-sideFrame.stl` and `stl/frame-sideFrame.stl`, using the file base name without `.js`.
  - The `zipProject` output unzipped with `fflate.unzipSync` lists:
    - every key of `files` at its own path, with a `Uint8Array` file byte-equal;
    - `params.json`, equal to `JSON.stringify(params, null, 2)`;
    - `stl/<name>.stl`, equal to `assembly`;
    - every `parts` key.
  - `zipProject` with `parts: {}` still has the code, `params.json` and the assembly.

- [ ] **Step 2: Run** `npx vitest run test/project-export.test.js`. The tests fail because the module doesn't exist yet.
- [ ] **Step 3: Implement** the three functions. Compare byte equality by length plus every byte.
- [ ] **Step 4: Run.** All the tests pass.
- [ ] **Step 5: Commit** with `feat(export): name part STLs and assemble the project zip`

### Task 2: The capture entry script

**Files:**
- Modify: `apps/jscad-web/src/projectExport.js`
- Test: `apps/jscad-web/test/project-export.test.js`

**Model:** `opus` — subtle runtime behavior, async depth and restoration.

**Interfaces:**
- Consumes: `exportsMaker(text)` from `src/projectBuild.js`. Export it if it is not exported yet.
- Produces:
  - `EXPORT_VIEW = '.export-view.js'`
  - `CAPTURES = '__jscadExportCaptures'`, the frame global name.
  - `makerFiles(files: Record<string, unknown>): string[]`, the bare project paths of the text files for which `exportsMaker` is true.
  - `exportScript(entry: string, makerFiles: string[]): string`, the CommonJS source of an entry placed at the project root. It works as follows:
    - When `main(params)` runs, it first does `globalThis[CAPTURES] = []`.
    - It `require`s each maker file as `./<path>`.
    - It replaces each `make[A-Z]*` function on that file's exports object with a wrapper and keeps the originals.
    - It then `require`s `./<entry>`, awaits `entryModule.main(params)`, and returns that value.
    - In a `finally` block, it puts the originals back.
    - The wrapper increments a shared `depth` counter, calls the original, and decrements the counter in a `finally` before returning, so the count covers only the synchronous span.
    - When `depth` was 0 at entry, the wrapper pushes `{ maker, file, value }` to `globalThis[CAPTURES]`. `value` is the awaited return, recorded with `Promise.resolve(ret).then(...)`, and `main` awaits all pending records before it returns.

- [ ] **Step 1: Write the failing tests.** Evaluate `exportScript` with `new Function('require','module','exports', src)`. Give it a fake `require` that returns in-memory module objects, then call the resulting `main`.
  - `main.js` calls `makeA()` directly. Captures are `[{maker:'makeA', file:'a.js', value}]`.
  - `makeA` calls `makeB` internally. Only `makeA` is captured.
  - `main` does `await Promise.all([makeA(), makeB()])` with async makers. Both are captured.
  - An ESM-shaped module, `{ __esModule: true, makeA }`, is captured.
  - A maker returning `Promise.resolve([g1, g2])` is captured as one entry whose value is `[g1, g2]`.
  - After `main` resolves, and after `main` rejects because a maker throws, every module's `make*` is the original function.
  - A maker file `main.js` never calls produces no capture.
  - `makerFiles({'main.js': mainSrc, 'truck.js': 'module.exports = { makeTruck }', 'lib/d.js': 'module.exports = { W: 1 }'})` returns `['truck.js']`.

- [ ] **Step 2: Run.** The tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** All the tests pass.
- [ ] **Step 5: Commit** with `feat(export): capture main()'s direct maker calls`

### Task 3: Frame command `jscadExportParts`

**Files:**
- Modify: `apps/jscad-web/src_frame/bundle.frame-worker.js`, which registers the command in `customHandlers` next to `jscadMeasure`.
- Modify: `apps/jscad-web/src_frame/workerPool.js`, if the command must be routed to the worker that holds the model. Check `NEEDS_MODEL`.
- Create: `apps/jscad-web/src_frame/exportParts.js`
- Test: `apps/jscad-web/test/export-parts.test.js`, or wherever the frame's unit tests live.

**Model:** `opus` — the worker's output normalization must be found and reused.

**Interfaces:**
- Consumes: `CAPTURES` from Task 2. Import it from `../src/projectExport.js` only if the frame bundle can reach that file. If it can't, repeat the string literal and add a test that pins both to the same value.
- Produces: frame command `jscadExportParts({ format }) → { parts: { maker: string, file: string, data: Uint8Array }[] }`.
  - It reads `globalThis.__jscadExportCaptures` and normalizes each `value` into solids. It must use the same flattening and fluent-to-geometry conversion that `jscadMain` applies to `main()`'s return; find it in `packages/worker/src`.
  - It serializes each part with `serializeSolids` and joins the chunks into one `Uint8Array`.
  - It drops parts whose geometry is empty.
  - It deletes the global before returning.
  - With no global set, it returns `{ parts: [] }`.

- [ ] **Step 1: Write the failing tests** against `exportParts.js`, with the serializer and normalizer injected:
  - Two captures give two parts in order, with joined bytes.
  - An empty-geometry capture is dropped.
  - The global is gone afterwards.
  - With the global missing, the result is `{ parts: [] }`.
- [ ] **Step 2: Run.** The tests fail.
- [ ] **Step 3: Implement.** Wire the command into the worker and into any page-side typing or proxy lists that name frame commands. Search for `jscadMeasure` to find every list.
- [ ] **Step 4: Run** the new test plus `npx vitest run test/` for the frame tests. Everything passes.
- [ ] **Step 5: Commit** with `feat(frame): jscadExportParts serializes captured parts`

### Task 4: Wiring, viewer restore, docs, e2e

**Files:**
- Modify: `apps/jscad-web/src/viewRuns.js`. Add `borrow`.
- Modify: `apps/jscad-web/main.js`. Add `exportProject` and pass it to `exporter.init`.
- Modify: `apps/jscad-web/src/exporter.js`. Add the dropdown entry and use the project name for filenames.
- Modify: `apps/jscad-web/README.md` (export section) and `apps/jscad-web/docs/architecture.md`.
- Test: `apps/jscad-web/test/view-runs.test.js`
- Test: new `apps/jscad-web/e2e/project-export.spec.js`

**Model:** `opus` — cross-module state with the chat and the viewer.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `viewRuns.borrow(run: () => Promise<T>): Promise<T>`.
  - It sets `held` to a private marker, awaits `run`, and then, whether `run` succeeded or failed, reloads the viewer's own plan with `load(plan, { user: true })`. The plan is the selected file's, or the entry's when nothing is selected. It then sets `held` to that plan's key.
  - `ensureEntry` must treat the marker as "not the entry", including when `selected` is undefined.
  - `ensureView` must reload when `held` is the marker, even when `selected` is undefined.
  - `exporter.init(api, { onError, exportProject })` adds `{ name: 'project', label: 'Project (zip)', execute: exportProject }` before `scriptUrl`.

`exportProject` in `main.js` runs these steps in order:

1. If no project is open (`currentProjectId` unset, or the loaded model isn't under `PROJECT_BASE`), call `setError(new Error('open a project to export it'))` and return.
2. `files = await fileSystem.projectFiles()`. If `projectEntry(files, currentEntry)` is empty, raise the existing `NO_ENTRY` error.
3. Params:
   - If `viewRuns.selected() === undefined`, use `paramsCtrl.getWorkerParams()`.
   - Otherwise use the code defaults, `{}`.
   - `params.json` gets `{ path: params[path] }` for each path in `userInteractedPaths`.
4. If `editor.isDirty?.()` (find the real dirty check in `editor.js`), call `setNotice('unsaved edits are not in the export')`.
5. Run `viewRuns.borrow` with these steps inside:
   - Clear the worker's file cache for the maker files and the entry: `workerApi.jscadClearFileCache({ files, root: PROJECT_BASE })`, using the cache paths as the editor save path builds them, `main.js:~921`.
   - Load `{ kind: 'export', path: entry, url: EXPORT_VIEW, script: exportScript(entry, makerFiles(files)) }` through the `load` dependency's request path. `planRequest` needs to accept this kind, and `record` must be false.
   - Pass the params from step 3, run `jscadMain` if the user had changes, as `load` already does, then `jscadExportData({ format: 'stlb' })` and `jscadExportParts({ format: 'stlb' })`.
   - In a `finally`, clear the cache again.
6. If the run fails, `setError` the error and download nothing. If the assembly has no data, use the existing `export produced no geometry` message.
7. Otherwise `downloadBlob(new Blob([zipProject(...)], { type: 'application/zip' }), `${name}.zip`)`. `name` is the project's display name, with `exportConfig.projectName` as the fallback. Set `exportConfig.projectName` from the open project's name as well.

- [ ] **Step 1: Write the failing `view-runs` tests.**
  - After `borrow` with nothing selected, `ensureEntry` loads nothing, and `held` is the entry again after the restore.
  - With a part selected, `borrow` restores the part plan with `user: true`.
  - When the borrowed run throws, the restore still runs and the error propagates.
- [ ] **Step 2: Run.** The tests fail. **Step 3:** implement `borrow`. **Step 4:** run again. They pass.
- [ ] **Step 5: Wire** `exportProject` and the exporter entry. Write `e2e/project-export.spec.js`, modeled on `e2e/project-ui.spec.js`, so that it:
  - creates a project with `main.js` requiring `base.js` (`makeBase`) and `peg.js` (`makePeg`), with `makePeg` called twice with the same arguments;
  - picks Project (zip) and clicks Export;
  - catches the download, unzips it with fflate in Node, and expects `main.js`, `base.js`, `peg.js`, `params.json`, `stl/<name>.stl`, `stl/base.stl` and `stl/peg-x2.stl`;
  - checks that the viewer still renders afterwards, with `data-render` not `error`.

  Add a second case that loads an example (not a project), runs Export project, and expects the error text `open a project to export it`.
- [ ] **Step 6: Docs.**
  - The README export section gets the zip's contents, the parameter rule (the `main.js` panel values when it is selected, otherwise the code defaults) and the repeated-part naming.
  - `architecture.md` gets the capture mechanism (synthesized `.export-view.js`, the synchronous-span depth rule, the cache clear and `viewRuns.borrow`).
- [ ] **Step 7: Run** `npx vitest run` in `apps/jscad-web` and the new e2e spec. Both pass.
- [ ] **Step 8: Commit** with `feat(export): Project (zip) export with per-part STLs`

### Task 5: Remove the working documents

- [ ] Delete `docs/superpowers/specs/2026-11-03-project-export-design.md` and this plan. Commit `docs: remove project export spec and plan`.
