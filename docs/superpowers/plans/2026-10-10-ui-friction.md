# UI friction batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long runs stoppable with visible cell progress, make export failures and filenames behave, and stop number params from mangling half-typed input.

**Architecture:** A new frame `jscadAbort` message reusing the existing kill path; a small tested DOM module for the Stop button fed by the job tracker; busy/error handling inside the exporter click flow with the project name threaded through project open; snap+clamp moved from keystroke to commit in the number input.

**Tech Stack:** ES2022, vitest (`/** @vitest-environment jsdom */` for DOM tests), existing frame test harness.

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run package-scoped vitest files, not the full OpenSCAD suite locally.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0.
- YAGNI: no debounce, no zoom-in-viewer, no export retry, no new frame messages beyond `jscadAbort`.
- Commit each task separately on the current branch (working in place per user choice).
- The pre-commit hook is red on a pre-existing unrelated failure (`apps/jscad-web/test/storage-rowboat.test.js`, tracked in `docs/backlog.md` Remaining issues). When scoped gates are green and the hook blocks only on that failure, commit with `--no-verify` and say so in the report.
- Per-keystroke runs with raw (unclamped) values remain: removing the mangling is this batch; debouncing runs is explicitly out of scope.

---

### Task 1: Stop button for long runs with a cell count

**Files:**
- Modify: `apps/jscad-web/src_frame/frameHost.js` (new `jscadAbort` branch in `handleMessage`)
- Modify: `apps/jscad-web/src_frame/workerPool.js` (no change expected; read `kill` at `:118-129` to confirm the branch can reuse it — if it cannot, stop and report NEEDS_CONTEXT instead of redesigning)
- Test: `apps/jscad-web/test/frame-host.test.js`
- Create: `apps/jscad-web/src/runStop.js`
- Create: `apps/jscad-web/test/runstop.test.js` (lowercase name matches the repo's test file casing style; check neighboring test filenames first — if they use kebab, use `run-stop.test.js` instead)
- Modify: `apps/jscad-web/src/frameSetup.js` (`createJobTracker` gains an optional third `onJobs` callback)
- Modify: `apps/jscad-web/static/index.html` (Stop button after `#progress`)
- Modify: `apps/jscad-web/main.js` (wire button, jobs, cells; ~5 lines)

**Interfaces:**
- Consumes: `pool.kill(slot, expiredId, reason, errorName)` (`workerPool.js:118-129`); `post({method: RESPONSE, ...})` (`frameHost.js:74-75`); `createJobTracker(progress, onProgress)` (`frameSetup.js:246-264`); `workerApi` proxy passes any method through (`frameSetup.js:215-225`); streamed cell counts arrive at main.js `onCells` (`main.js:247`).
- Produces: `workerApi.jscadAbort()` resolving `{ aborted: boolean }`; `bindStopButton({ button, workerApi, onError })` returning `{ setRunning, setCells }`.

**Frame behavior to implement** (in `handleMessage`, before the `pool.relay` line, after `entry` exists):

```js
if (data?.method === 'jscadAbort' && data?.id != null) {
  const had = state.active !== null
  if (state.active) pool.kill(state.active, null, 'stopped by the user', 'AbortError')
  if (had && !state.active) {
    try {
      state.active = pool.start({ replay: true })
    } catch {
      // Worker creation itself is blocked; the terminated post stands.
    }
  }
  post({ method: RESPONSE, id: data.id, params: { aborted: had } })
  return
}
```

Rationale for each line (do not simplify away): `kill` answers every pending app request with `AbortError` via `slotOps.end`, so nothing hangs; the spare (same source) is promoted when one exists and no `frameWorkerTerminated` is posted; the `start({replay:true})` fallback covers kill-without-replacement so the next request does not hit a dead frame (mirrored setup replays, no script — the stopped run stays stopped). The running run's own promise rejects with the AbortError and the app shows it as the run's error.

- [ ] **Step 1: Write the failing frame test**

In `apps/jscad-web/test/frame-host.test.js`, using its `setup`/`send`/`answer`/`workerIdOf` harness (`:10-36`), add:

```js
it('aborts the active run on jscadAbort and answers the abort', async () => {
  const { posted, workers, send } = setup()
  send({ method: 'jscadMain', id: 1, params: [] })
  send({ method: 'jscadAbort', id: 2 })
  expect(workers[0].terminate).toHaveBeenCalled()
  expect(posted.find((m) => m.id === 1)?.error?.name).toBe('AbortError')
  expect(posted.find((m) => m.id === 2)).toMatchObject({ method: '__RESPONSE__', params: { aborted: true } })
})

it('answers aborted:false when nothing runs, starting no worker', async () => {
  const { posted, workers, send } = setup()
  send({ method: 'jscadAbort', id: 1 })
  expect(workers).toHaveLength(0)
  expect(posted).toEqual([{ method: '__RESPONSE__', id: 1, params: { aborted: false } }])
})
```

(Check how existing kill/timeout tests shape a pending `jscadMain` first — e.g. whether `answer` must stay uncalled for the request to count as pending. Mirror the neighboring timeout test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/test/frame-host.test.js -t "jscadAbort"`
Expected: FAIL. Unknown method falls through to relay; no terminate, no abort answer.

- [ ] **Step 3: Write the frame implementation** (the block above).

- [ ] **Step 4: Write the failing button tests, then the module**

Create `apps/jscad-web/src/runStop.js`:

```js
// The Stop button beside the progress bar: visible while the frame has jobs,
// calling jscadAbort once per run. Test seam: everything DOM lives here;
// main.js only constructs it and forwards jobs/cells.
export const bindStopButton = ({ button, workerApi, onError = console.error }) => {
  let cells = null
  const paint = () => {
    button.textContent = cells === null ? 'Stop' : `Stop (${cells} cells)`
  }
  const setRunning = (running) => {
    button.style.display = running ? '' : 'none'
    if (running) button.disabled = false
  }
  const setCells = (count) => {
    cells = count
    paint()
  }
  button.style.display = 'none'
  button.addEventListener('click', () => {
    button.disabled = true
    workerApi.jscadAbort().catch(onError)
  })
  return { setRunning, setCells }
}
```

Tests in the new test file (jsdom; no imports needed beyond the module):

```js
it('hides until a run starts, disables on click, re-enables on the next run', async () => {
  document.body.innerHTML = '<button id="stop">Stop</button>'
  const workerApi = { jscadAbort: vi.fn(async () => ({ aborted: true })) }
  const { setRunning } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError: vi.fn() })
  const btn = document.getElementById('stop')
  expect(btn.style.display).toBe('none')
  setRunning(true)
  expect(btn.style.display).toBe('')
  btn.click()
  expect(workerApi.jscadAbort).toHaveBeenCalledTimes(1)
  expect(btn.disabled).toBe(true)
  setRunning(true)
  expect(btn.disabled).toBe(false)
  setRunning(false)
  expect(btn.style.display).toBe('none')
})

it('shows the streamed cell count and reports an abort failure', async () => {
  document.body.innerHTML = '<button id="stop">Stop</button>'
  const onError = vi.fn()
  const workerApi = { jscadAbort: vi.fn(async () => { throw new Error('frame gone') }) }
  const { setRunning, setCells } = bindStopButton({ button: document.getElementById('stop'), workerApi, onError })
  setRunning(true)
  setCells(1234)
  expect(document.getElementById('stop').textContent).toBe('Stop (1234 cells)')
  document.getElementById('stop').click()
  await vi.waitFor(() => expect(onError).toHaveBeenCalled())
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/frame-host.test.js apps/jscad-web/test/runstop.test.js`
Expected: PASS. Then run the replay/relay neighbors: `npx vitest run apps/jscad-web/test/frame-setup.test.js apps/jscad-web/test/stream-runs.test.js`.

- [ ] **Step 6: Wire the app (index.html + frameSetup.js + main.js)**

`static/index.html`: after `<progress id="progress" title="Processing..."></progress>` add `<button id="stop-button" type="button" style="display:none">Stop</button>`.

`src/frameSetup.js` `createJobTracker(progress, onProgress)`: add optional third parameter `onJobs`, called with the job count on every invocation:

```js
export function createJobTracker(progress, onProgress, onJobs) {
  ...
  return (jobs) => {
    onJobs?.(jobs)
    if (jobs === 1) {
    ...
```

`main.js`: near the progress block (`:153-156`) declare `let stopCtl = null`; change the tracker construction (`:267`) to `createJobTracker(progress, onProgress, (jobs) => stopCtl?.setRunning(jobs > 0))`; after `createFrame` resolves (`:272-280`, where `workerApi` exists) add:

```js
stopCtl = bindStopButton({ button: byId('stop-button'), workerApi, onError: setError })
```

and extend the stream `onCells` (`:247`) to forward the count: `onCells: count => { document.documentElement.dataset.cells = String(count); stopCtl?.setCells(count) }`. Import `bindStopButton` from `./src/runStop.js` beside the other src imports. Also ensure the aborted run's stream state is discarded: read the `jscadScript` wrapper's error path (`main.js:644-680`) — if it does not already discard stream state on rejection, add `streamRuns.discard()` there.

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src_frame/frameHost.js apps/jscad-web/test/frame-host.test.js apps/jscad-web/src/runStop.js apps/jscad-web/test/runstop.test.js apps/jscad-web/src/frameSetup.js apps/jscad-web/static/index.html apps/jscad-web/main.js
git commit -m "feat(run): stop button aborting the active frame run with cell count"
```

### Task 2: Export busy state, errors, and per-project filename

**Files:**
- Modify: `apps/jscad-web/src/exporter.js`
- Create: `apps/jscad-web/test/exporter-ui.test.js` (`/** @vitest-environment jsdom */`; `vi.mock('@jscadui/scene', ...)` for `downloadBlob`; dynamic `import('../src/exporter.js')` after setting `document.body.innerHTML` — follow the `parts-browser.test.js` resetModules pattern; stub `URL.createObjectURL`/`revokeObjectURL` only if the mock needs them)
- Modify: `apps/jscad-web/main.js` (`exporter.init(workerApi)` at `:890` gains `{ onError: setError }`; `onOpen` at `:386-389` sets the export filename from the opened project's name)
- Modify: `apps/jscad-web/src/projectFiles.js` (`onOpen` call site threads the project name; update its JSDoc at `:65`)
- Test: `apps/jscad-web/test/project-files.test.js` (pin the name threading; read its switch tests first and mirror them)

**Interfaces:**
- Consumes: `workerApi.jscadExportData({format})` / `jscadGetExportFormats()`; `exportConfig.projectName`; `createProjectSwitch({..., onOpen })`; `setError` in main.js.
- Produces: `init(workerApi, { onError })`; click disables the button with `Exporting…`, restores after; failures and empty results go to `onError`; `exportConfig.projectName` follows the opened stored project.

- [ ] **Step 1: Write the failing tests**

In the new `apps/jscad-web/test/exporter-ui.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { downloadBlob } from '@jscadui/scene'

vi.mock('@jscadui/scene', () => ({ downloadBlob: vi.fn() }))

const shell = () => {
  document.body.innerHTML = '<button id="export-button">Export</button><select id="export-format"></select>'
}

const formats = [{ id: 'stlb', label: 'STL', extension: 'stl' }]

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
})

const load = async (workerApi, opts) => {
  shell()
  const exporter = await import('../src/exporter.js')
  await exporter.init(workerApi, opts)
  return exporter
}

describe('export button', () => {
  it('disables with Exporting… during the run and downloads under the project name', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const workerApi = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: vi.fn(async () => { await gate; return { data: [new ArrayBuffer(8)] } }),
    }
    const exporter = await load(workerApi, { onError: vi.fn() })
    exporter.exportConfig.projectName = 'bracket'
    const btn = document.getElementById('export-button')
    const clicked = (async () => btn.click())()
    await vi.waitFor(() => expect(btn.disabled).toBe(true))
    expect(btn.textContent).toBe('Exporting…')
    release()
    await clicked
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'bracket.stl')
    expect(btn.disabled).toBe(false)
    expect(btn.textContent).toBe('Export')
  })

  it('reports a frame failure and an empty result instead of dropping them', async () => {
    const onError = vi.fn()
    const failing = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: async () => { throw new Error('frame gone') },
    }
    await load(failing, { onError })
    document.getElementById('export-button').click()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'frame gone' })))
    expect(document.getElementById('export-button').disabled).toBe(false)

    const empty = {
      jscadGetExportFormats: async () => formats,
      jscadExportData: async () => ({}),
    }
    const onError2 = vi.fn()
    await load(empty, { onError: onError2 })
    document.getElementById('export-button').click()
    await vi.waitFor(() => expect(onError2).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/no geometry/) })))
  })
})
```

(If `vi.mock('@jscadui/scene')` breaks module resolution in this workspace, fall back to stubbing `URL.createObjectURL`/`revokeObjectURL` globals and spying on the real `downloadBlob`'s link click via `HTMLAnchorElement.prototype.click`. Verify the chosen approach passes before implementing.)

For the filename threading, read `src/projectFiles.js:60-80` and `test/project-files.test.js` switch tests first, then add a test asserting `onOpen` receives the project's name. Mirror the existing switch-test shape exactly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/jscad-web/test/exporter-ui.test.js`
Expected: FAIL. No busy state, no catch (unhandled rejection, `onError` never called), empty result silent.

- [ ] **Step 3: Write minimal implementation**

`src/exporter.js`:

```js
export const init = async (newWorkerApi, { onError = (err) => console.error(err) } = {}) => {
  ...
  // Bind export buttons
  exportButton.addEventListener('click', async () => {
    const format = /** @type {ExportFormatEntry} */ (exportFormats.find((f) => f.name === exportFormatSelect.value))
    if (!format) return
    const label = exportButton.textContent
    exportButton.disabled = true
    exportButton.textContent = 'Exporting…'
    try {
      await format.execute()
    } catch (err) {
      onError(err)
    } finally {
      exportButton.disabled = false
      exportButton.textContent = label
    }
  })
}
```

and in `exportAsFile`, after the `if (data)` block add:

```js
  else {
    onError?... 
```

No — `onError` is `init`-scoped, `exportAsFile` is module scope. Restructure: pass `onError` into `exportAsFile(format.id, format.extension, onError)` from the `execute` closures (they close over `init`'s `onError`), and in `exportAsFile`:

```js
const exportAsFile = async (formatName, formatExtension = formatName, onError = (err) => console.error(err)) => {
  let { data } = (await workerApi.jscadExportData({ format: formatName })) || {}
  if (!data) {
    onError(new Error('export produced no geometry'))
    return
  }
  if (!(data instanceof Array)) data = [data]
  ...
}
```

`main.js:890`: `await exporter.init(workerApi, { onError: setError })`. Confirm `setError` is in scope at `:890` (it is used at `:372` and below; verify before editing).

Filename on switch — `src/projectFiles.js` switch `onOpen(id, project.entry)`: thread the name. First read what `manager.readForSwitch` returns (storage manager row includes `name`; verify in `src/storage/projects.js`). Then:

```js
onOpen(id, project.entry, project.name)
```

JSDoc at `:65` gains the name. `main.js:386-389`:

```js
onOpen: (id, entry, name) => {
  currentProjectId = id
  currentEntry = entry
  if (typeof name === 'string' && name) exporter.exportConfig.projectName = name
},
```

Grep all other `onOpen`/`createProjectSwitch` callers (diskProject, tests) and update signatures that must stay compatible (extra arg is backward compatible for callbacks that ignore it; only the single call site changes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/exporter-ui.test.js apps/jscad-web/test/project-files.test.js apps/jscad-web/test/aiExport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/exporter.js apps/jscad-web/test/exporter-ui.test.js apps/jscad-web/main.js apps/jscad-web/src/projectFiles.js apps/jscad-web/test/project-files.test.js
git commit -m "fix(export): busy state, reported errors, and per-project filename"
```

### Task 3: Snap and clamp number params on commit, not keystroke

**Files:**
- Modify: `packages/params-ui/src/inputs.js` (`createNumberInput` at `:86-149`)
- Test: `packages/params-ui/src/inputs.test.js` (update snap/clamp-on-`oninput` tests to `onchange`; add typing/commit tests)

**Interfaces:**
- Consumes: `onChange` callback; `snapToStep(val, effectiveStep, min)` (existing helper — read its exact signature before editing); `min`/`max`/`type`.
- Produces: keystrokes send the raw parsed value with no display rewrite; commit (`change` event: blur/Enter, and spinner clicks which fire both) snaps, clamps, rewrites the display when it changed, and sends the final value only when it differs from the last sent one. `updateValue` (external refresh) also refreshes the last-sent baseline.

- [ ] **Step 1: Update the failing tests first**

In `packages/params-ui/src/inputs.test.js`, change every snap/clamp test under `describe('createNumberInput')` that drives `input.oninput()` to drive `input.onchange()` instead (the snap-to-grid tests at `:145-199` and any clamp tests after `:200` — grep `oninput()` in that describe and convert each one whose assertion involves snapped/clamped values or rewritten display). Leave the raw-parse tests (`:117-143`, no min/max/step) on `oninput()` — they still pass unchanged.

Then add, in the same describe:

```js
it('sends half-typed values raw without rewriting the display', () => {
  const onChange = vi.fn()
  const result = createNumberInput({
    param: { path: 'test.x', name: 'x', type: 'number', min: 10 },
    value: 10,
    onChange
  })

  const input = result.value.querySelector('input')
  input.value = '5'
  input.oninput()
  expect(onChange).toHaveBeenCalledWith(5)
  expect(input.value).toBe('5')
})

it('clamps on commit, rewrites the display, and sends the final value once', () => {
  const onChange = vi.fn()
  const result = createNumberInput({
    param: { path: 'test.x', name: 'x', type: 'number', min: 10 },
    value: 10,
    onChange
  })

  const input = result.value.querySelector('input')
  input.value = '5'
  input.oninput()
  input.onchange()
  expect(input.value).toBe('10')
  expect(onChange).toHaveBeenLastCalledWith(10)
})

it('restores the last value when the commit is not a number', () => {
  const onChange = vi.fn()
  const result = createNumberInput({
    param: { path: 'test.x', name: 'x', type: 'number', min: 10 },
    value: 10,
    onChange
  })

  const input = result.value.querySelector('input')
  input.value = ''
  input.onchange()
  expect(input.value).toBe('10')
  expect(onChange).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/params-ui/src/inputs.test.js`
Expected: FAIL. Converted tests fail (no `onchange` handler yet); new tests fail (display rewritten on input; no clamp on commit).

- [ ] **Step 3: Write minimal implementation**

In `createNumberInput`, track the last value sent and split live vs commit (read `snapToStep`'s signature and `effectiveStep` first — keep both exactly as today):

```js
let lastSent = value
input.oninput = () => {
  const val = type === 'int' ? parseInt(input.value) : parseFloat(input.value)
  if (!isNaN(val)) {
    lastSent = val
    onChange(val)
  }
}
input.onchange = () => {
  let val = type === 'int' ? parseInt(input.value) : parseFloat(input.value)
  if (isNaN(val)) {
    input.value = String(lastSent ?? '')
    return
  }
  val = snapToStep(val, effectiveStep, min)
  if (min !== undefined && val < min) val = min
  if (max !== undefined && val > max) val = max
  if (val !== Number(input.value)) input.value = String(val)
  if (val !== lastSent) {
    lastSent = val
    onChange(val)
  }
}
```

and in `updateValue`: `updateValue: (newValue) => { lastSent = newValue; input.value = String(newValue) }`.

Keep the `min`/`max`/`step` element attributes and the range hint exactly as today (native spinners still bound them). Keep the `oninput` comment block updated to describe the split (replace the "No separate blur handler needed" claim).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/params-ui/src/inputs.test.js`
Expected: PASS. Then run the package suite (`npm test -w @jscadui/params-ui` or the package's test script — check `packages/params-ui/package.json` first) plus the app params tests: `npx vitest run apps/jscad-web/test/params-ui.test.js apps/jscad-web/test/param-change.test.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/params-ui/src/inputs.js packages/params-ui/src/inputs.test.js
git commit -m "fix(params): snap and clamp number inputs on commit, not keystroke"
```
