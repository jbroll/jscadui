# Project correctness batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runs, the panel, and the chat transcript belong to the project on screen: editor runs never create phantom projects or store URL scripts, the versions panel follows row clicks, and the chat shows the open project's conversation.

**Architecture:** A tested path predicate guarding the record path plus boot id wiring; selection state owned by the panel (click selects, New selects-and-opens); transcript load extracted for reuse on switch with a stale-switch guard.

**Tech Stack:** ES2022, vitest (`/** @vitest-environment jsdom */` for panel/chat DOM tests).

## Global Constraints

- Targets modern browsers only, ES2022+ with no polyfills.
- npm workspaces monorepo; run package-scoped vitest files, not the full OpenSCAD suite locally.
- TDD: failing test first, watch it fail, minimal code, watch it pass.
- `npm run lint` and `npm run typecheck` must stay exit 0.
- YAGNI: no delete control, no New-chat control, no storage-mode routing for conversations, no auto-open-newest at boot, no save-path (Ctrl+S) changes.
- Commit each task separately on the current branch (working in place per user choice).
- The pre-commit hook is red on a pre-existing unrelated failure (`apps/jscad-web/test/storage-rowboat.test.js`, tracked in `docs/backlog.md` Remaining issues). When scoped gates are green and the hook blocks only on that failure, commit with `--no-verify` and say so in the report.

---

### Task 1: Record runs into the open project, never URL scripts

**Files:**
- Modify: `apps/jscad-web/src/projectFiles.js` (new `isRecordablePath` helper)
- Test: `apps/jscad-web/test/project-files.test.js`
- Modify: `apps/jscad-web/main.js` (recordEdit guard `:382-385`; boot createProject id at `:1010-1012`)

**Interfaces:**
- Consumes: `projectPathOf` (`src/projectFiles.js:13`, null for URLs — already tested in `test/project-files.test.js:117-125`); `projectManager.createProject` returning `{ id, ... }` (`src/storage/projects.js:74-81`); `storageSession.writeFiles` creating on unknown ids.
- Produces: `isRecordablePath(path)`; editor runs of URL scripts are never stored; the boot-created default project's real id is the recording target.

- [ ] **Step 1: Write the failing test**

In `apps/jscad-web/test/project-files.test.js`, near the `projectPathOf` tests (`:117-125`), add (check its import block first and import `isRecordablePath` from `../src/projectFiles.js`):

```js
it('marks URL scripts unrecordable and project paths recordable', () => {
  expect(isRecordablePath('main.js')).toBe(true)
  expect(isRecordablePath('/parts/gear.js')).toBe(true)
  expect(isRecordablePath('http://localhost:5120/examples/jscad/01-two-cars.example.js')).toBe(false)
  expect(isRecordablePath('https://example.com/model.js')).toBe(false)
  expect(isRecordablePath('data:application/gzip;base64,AAA')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/jscad-web/test/project-files.test.js -t "unrecordable"`
Expected: FAIL. `isRecordablePath` does not exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/projectFiles.js`, beside `projectPathOf`:

```js
// An editor run path that belongs to a project (record it) versus a URL —
// an example, remote or data: script — that must never be stored into one.
export const isRecordablePath = (path) => projectPathOf(path) !== null
```

In `apps/jscad-web/main.js`, replace the disk-only guard (`:382-385`):

```js
const recordEdit = async (script, path, { entry } = {}) => {
  if (!isRecordablePath(path)) return
  await storageSession.writeThrough(currentProjectId, path, script, { message: 'edit', ...(entry ? { entry } : {}) }).catch((err) => console.warn('storage write failed:', err))
}
```

(import `isRecordablePath` beside the existing `projectFiles.js` import at `:60`). This subsumes the old `DISK_ID + URL` case: disk-directory files are project paths and still record; URL scripts never do, on any backend.

Boot (`:1010-1012`): use the created id so the first run cannot fork a phantom project:

```js
if ((await projectManager.listAll()).length === 0) {
  currentProjectId = (await projectManager.createProject('default', { entry: 'main.js', files: { 'main.js': defaultCode } })).id
}
```

(`currentProjectId` is module-scope `let` at `:388`; assignment here is in scope. When projects already exist the boot-open behavior is unchanged — see residual below.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/project-files.test.js apps/jscad-web/test/project-build.test.js apps/jscad-web/test/disk-project.test.js apps/jscad-web/test/aiDeps.test.js`
Expected: PASS. The main.js wiring (3 lines) is review-verified; the session-level create-on-unknown-id contract is already pinned by `test/storage-session.test.js`.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/projectFiles.js apps/jscad-web/test/project-files.test.js apps/jscad-web/main.js
git commit -m "fix(projects): record runs into the open project, never URL scripts"
```

Residual (document, do not fix): with pre-existing projects at boot nothing is auto-opened, so a placeholder run still targets the literal `'default'` id. Fixing that means choosing a boot-open project, which is a UX decision for the owner.

### Task 2: Panel selection follows row clicks, New opens what it creates

**Files:**
- Modify: `apps/jscad-web/src/projects.js`
- Test: `apps/jscad-web/test/projects-ui.test.js`

**Interfaces:**
- Consumes: `initProjects({..., onSwitch })` (`src/projects.js:11`); internal `select(id)` (`:49-53`) rendering versions for one project; `manager.createProject` returning `{ id, ... }`.
- Produces: clicking a row selects it (versions + restore act on it, row highlighted) and switches to it; New selects and opens the created project. `select` stays exported for tests and main.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/test/projects-ui.test.js` (harness `setup()` at `:7-23`; note it already works around this bug by selecting inside its own `onSwitch` wrapper at `:17` — leave the harness as is, the new tests must pass with production doing the selecting too):

```js
it('shows versions for the clicked project with a highlight', async () => {
  const { manager, local, panel } = await setup()
  const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
  await local.writeFiles(second.id, { 'main.js': 'b2' }, { message: 'second-edit' })
  await panel.render()
  const rows = [...document.querySelectorAll('.project-row')]
  expect(rows).toHaveLength(2)
  rows[1].querySelector('.project-open').click()
  await vi.waitFor(() => expect(document.querySelector('.project-row.selected')).not.toBeNull())
  expect(document.querySelector('.project-row.selected').dataset.projectId).toBe(second.id)
  await vi.waitFor(() => expect(document.querySelector('.version-row')?.textContent).toMatch(/second-edit/))
})

it('restores the clicked project, not the first listed', async () => {
  const { manager, onRestore, panel } = await setup()
  const second = await manager.createProject('Bracket', { files: { 'main.js': 'b' } })
  await panel.render()
  const rows = [...document.querySelectorAll('.project-row')]
  rows[1].querySelector('.project-open').click()
  await vi.waitFor(() => expect(document.querySelector('.project-row.selected')).not.toBeNull())
  document.querySelector('.version-restore').click()
  await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(second.id))
})

it('opens the project New creates', async () => {
  const { manager, onSwitch, panel } = await setup()
  await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
  document.querySelector('.project-new').click()
  const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
  expect(created).toBeDefined()
  await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith(created.id))
  expect(document.querySelector('.project-row.selected')?.dataset.projectId).toBe(created.id)
})
```

(`setup` returns `{ manager, local, onSwitch, onRestore, panel }` — destructure what each test needs. `onSwitch` in the harness is `vi.fn` wrapped with select; production will select too — double select is idempotent.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/jscad-web/test/projects-ui.test.js`
Expected: FAIL. No `.selected` marker exists; versions stay on the first project; New never calls `onSwitch`.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/projects.js`:

```js
const paintSelection = () => {
  for (const row of list.querySelectorAll('.project-row')) {
    const on = row.dataset.projectId === selectedId
    row.classList.toggle('selected', on)
    if (on) row.setAttribute('aria-current', 'true')
    else row.removeAttribute('aria-current')
  }
}

const select = async (id) => {
  selectedId = id
  paintSelection()
  await refreshMode()
  await renderVersions()
}
```

Row click (`:90`): `label.addEventListener('click', async () => { await select(p.id); onSwitch(p.id) })`.

`render()` (`:82-115`): after building rows, call `paintSelection()` (before the `if (!selectedId)` block) so re-renders keep the highlight.

New (`:117-121`):

```js
newBtn.addEventListener('click', async () => {
  const { code, path } = readBuffer()
  const created = await manager.createProject('Untitled', { entry: path, files: { [path]: code } })
  await select(created.id)
  onSwitch(created.id)
  render()
})
```

(No delete control: explicitly out of scope.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/projects-ui.test.js`
Expected: PASS, all tests including the 3 new ones and the 6 pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/projects.js apps/jscad-web/test/projects-ui.test.js
git commit -m "fix(panel): selection follows clicks, New opens what it creates"
```

### Task 3: Chat transcript follows the project switch

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js` (extract resume rendering, add `switchTo`, return it)
- Test: `apps/jscad-web/test/aiChat.test.js` (extend `openChat` to return controls; switch tests)
- Modify: `apps/jscad-web/main.js` (keep `initChat` return; call `switchTo` in `onOpen`)

**Interfaces:**
- Consumes: `storage.readConversation(pid)` / `writeConversation(pid, messages)` (`aiChat.js:107-114, 142-153`); `projectId` option (string or `() => string`, `:98`); `onOpen(id, entry)` in main.js (`:386-390`).
- Produces: `initChat(...)` returns `{ switchTo }`; `switchTo(id)` clears the view, loads that project's conversation, and renders it. In-flight-turn behavior is unchanged (documented residual). Storage-mode routing and New-chat controls are out of scope.

- [ ] **Step 1: Write the failing tests**

In `apps/jscad-web/test/aiChat.test.js`, extend the `openChat` helper (`:102-117`) to return initChat's return value:

```js
const openChat = (options = {}) => {
  ...
  const controls = initChat({ ... })
  ...
  return { container, q, type, controls }
}
```

(Read the exact helper body first and preserve everything, only adding the return.)

Add tests near the resume test (`:318-361`):

```js
it('loads the new project conversation on switch and stores per project', async () => {
  const store = {}
  const storage = {
    readConversation: async (pid) => (store[pid] ? { messages: store[pid], updated: 1 } : null),
    writeConversation: vi.fn(async (pid, messages) => { store[pid] = messages }),
  }
  const runTurnFn = vi.fn(async ({ onText }) => {
    onText('ok')
    return { messages: [] }
  })
  const chat = openChat({ runTurnFn, storage, projectId: 'p1' })
  chat.type('for one')
  await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toHaveLength(2))
  await chat.controls.switchTo('p2')
  expect(chat.q('.chat-messages').textContent).not.toContain('for one')
  chat.type('for two')
  await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[0]).toBe('p2'))
  await chat.controls.switchTo('p1')
  await vi.waitFor(() => expect(chat.q('.chat-messages').textContent).toContain('for one'))
})
```

(Assumes `openChat` exposes `q` for queries as today. If `switchTo` must be awaited for render, await it — the brief does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/jscad-web/test/aiChat.test.js -t "switch"`
Expected: FAIL. `controls.switchTo` does not exist; the p2 view still shows p1's messages.

- [ ] **Step 3: Write minimal implementation**

In `apps/jscad-web/src/aiChat.js`, extract the resume-render loop (`:145-151`) into:

```js
const renderLoaded = (messages) => {
  transcript = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  messagesEl.innerHTML = ''
  assistantEl = null
  turnReasoning = []
  for (const m of transcript) {
    for (const step of m.reasoning ?? []) addReasoningBlock(thoughtLabel(step.seconds), step.text)
    if (m.role === 'user') addMessage(m.content, 'user')
    else if (m.content) addMessage(m.content, 'assistant')
    if (m.stopped) addStopped()
  }
}
```

Replace the init resume block (`:142-153`) with a call on load, and add:

```js
// The open project changed: show its conversation, not the previous
// project's. A turn in flight keeps its own prior/messages and still
// persists under pid() — switching mid-turn is best-effort (residual).
const switchTo = async (id) => {
  transcript = []
  messagesEl.innerHTML = ''
  assistantEl = null
  turnReasoning = []
  if (!storage || !id) return
  try {
    const resumed = await storage.readConversation(id)
    if (!resumed || pid() !== id) return
    renderLoaded(resumed.messages)
  } catch (err) {
    console.warn('chat resume failed:', err)
  }
}
```

Init becomes `if (storage && pid()) switchTo(pid())` (same behavior, one path). Return `{ switchTo }` from `initChat` (check the function's current return — if it returns nothing today, add the return at the end; verify no caller depends on undefined).

In `apps/jscad-web/main.js`: keep the return — `const chatControls = initChat({ ... })` — and in `onOpen` (`:386-390`) add `chatControls.switchTo(id)` after the id assignments. (Grep all `initChat` callers first; tests call it directly — an added return value is backward compatible.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/jscad-web/test/aiChat.test.js`
Expected: PASS, all tests including the new switch test and the pre-existing resume/persistence tests.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js apps/jscad-web/main.js
git commit -m "fix(chat): transcript follows the project switch"
```

Residuals (document, do not fix): a turn in flight across a switch still persists under the new pid; conversations ignore per-project storage modes (always `getActiveStore`); no New-chat control.
