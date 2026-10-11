# Project & Storage Residuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six project/storage defects in `apps/jscad-web` — boot opens no project, the editor drops edits without warning, an in-flight chat turn persists under the wrong project, chat storage ignores the project's mode and has no New-chat control, there is no delete, and mode-flip/sync state is wrong.

**Architecture:** Localized fixes in each owling module, keeping the app's init-function + module-state pattern (spec `docs/superpowers/specs/2026-10-11-project-storage-residuals-design.md`, approach A). The editor gains a pure dirty-buffer helper; a shared confirm dialog serves discard and delete; the storage manager and backends gain delete; `aiChat` binds a turn to the project it started in; `main.js` wires boot, chat routing, sign-out teardown and the sync-status line.

**Tech Stack:** ES2022 modules, hand-built DOM (no framework), CodeMirror 6, vitest (jsdom for UI), `@jbroll/rowboat-client` (Dexie).

## Global Constraints

- Plain JS with JSDoc `@param`/`@typedef`; no TypeScript in app src; `tsc --noEmit` must stay green.
- Never import `src/storage/schema.js` from app code (TS 4.9 gate; `main.js:51-52`).
- Module style: `export const name = ...`; `el(tag, className, text)` for DOM; init functions return a handle.
- Tests: `npx vitest run <file>` from `apps/jscad-web`; jsdom via `// @vitest-environment jsdom` at file top.
- Commit messages: single line, `type(scope): summary`. Pre-commit runs build+lint+typecheck+unit tests; it must pass without `--no-verify`.
- Delete the matching bullet(s) in `docs/backlog.md` (Projects and storage, lines 91–141) in the commit that lands each item.

---

### Task 1: Boot opens the most recent project

**Files:**
- Modify: `apps/jscad-web/src/projectFiles.js`
- Modify: `apps/jscad-web/main.js:1013-1016`
- Test: `apps/jscad-web/test/project-files.test.js`

**Interfaces:**
- Produces: `pickBootProject(projects: {id:string, mode:string}[]) → string | null` — the most recently updated non-disk project's id, else null.

- [ ] **Step 1: Write the failing test**

Add to `apps/jscad-web/test/project-files.test.js` (import `pickBootProject` in the top import list):

```js
describe('pickBootProject', () => {
  it('returns the first (most recently updated) non-disk project', () => {
    expect(pickBootProject([{ id: 'a', mode: 'local' }, { id: 'b', mode: 'rowboat' }])).toBe('a')
  })

  it('skips the disk row, which sorts first and is opened by its own hash', () => {
    expect(pickBootProject([{ id: 'disk', mode: 'disk' }, { id: 'b', mode: 'local' }])).toBe('b')
  })

  it('is null with no projects or only the disk project', () => {
    expect(pickBootProject([])).toBeNull()
    expect(pickBootProject([{ id: 'disk', mode: 'disk' }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/project-files.test.js`
Expected: FAIL — `pickBootProject is not a function`.

- [ ] **Step 3: Implement `pickBootProject`**

Add to `apps/jscad-web/src/projectFiles.js` (after `loadSource`):

```js
/**
 * The project to open on load: the most recently updated one, skipping the
 * disk row (it sorts first and opens from its own #/models hash).
 * @param {{id:string, mode:string}[]} projects
 * @returns {string | null}
 */
export const pickBootProject = (projects) => projects.find((p) => p.mode !== 'disk')?.id ?? null
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/project-files.test.js`
Expected: PASS.

- [ ] **Step 5: Wire boot in `main.js`**

Import `pickBootProject` in the `projectFiles` import list. Replace `main.js:1013-1016` (the `if ((await projectManager.listAll()).length === 0) { ... }` block) with:

```js
// ============== Project Panel ==============
const bootProjects = await projectManager.listAll().catch(() => [])
if (bootProjects.length === 0) {
  currentProjectId = (await projectManager.createProject('default', { entry: 'main.js', files: { 'main.js': defaultCode } })).id
} else {
  const bootId = pickBootProject(bootProjects)
  if (bootId) await switchProject(bootId).catch(setError)
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/projectFiles.js apps/jscad-web/main.js apps/jscad-web/test/project-files.test.js
git commit -m "fix(projects): boot into the most recent project"
```

---

### Task 2: Editor keeps a per-path dirty buffer

**Files:**
- Create: `apps/jscad-web/src/editorBuffer.js`
- Modify: `apps/jscad-web/src/editor.js`
- Test: `apps/jscad-web/test/editorBuffer.test.js`

**Interfaces:**
- Produces: `createEditorBuffer() → { has(path), get(path), remember(path, text), edit(path, text), clear(), prune(pathSet), isDirty() }`.

- [ ] **Step 1: Write the failing test**

Create `apps/jscad-web/test/editorBuffer.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createEditorBuffer } from '../src/editorBuffer.js'

describe('editor buffer', () => {
  it('remembers loaded content and returns it after a switch away and back', () => {
    const b = createEditorBuffer()
    b.remember('/a.js', 'a1')
    b.remember('/b.js', 'b1')
    b.edit('/a.js', 'a2')
    expect(b.get('/a.js')).toBe('a2')
    expect(b.get('/b.js')).toBe('b1')
    expect(b.isDirty()).toBe(true)
  })

  it('clears on a whole-project replace', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.clear()
    expect(b.has('/a.js')).toBe(false)
    expect(b.isDirty()).toBe(false)
  })

  it('prunes buffers for paths no longer present but keeps the rest', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.edit('/b.js', 'b2')
    b.prune(new Set(['/a.js']))
    expect(b.has('/b.js')).toBe(false)
    expect(b.get('/a.js')).toBe('a2')
    expect(b.isDirty()).toBe(true)
  })

  it('is not dirty after a setSource-style remember of an edited path', () => {
    const b = createEditorBuffer()
    b.edit('/a.js', 'a2')
    b.remember('/a.js', 'a3')
    expect(b.isDirty()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/editorBuffer.test.js`
Expected: FAIL — cannot find module `../src/editorBuffer.js`.

- [ ] **Step 3: Implement the helper**

Create `apps/jscad-web/src/editorBuffer.js`:

```js
/**
 * The editor's per-path text, so switching files never re-reads a stale
 * snapshot. `remember` records authoritative content (clean); `edit` records a
 * user change (dirty).
 * @returns {{
 *   has: (path:string) => boolean,
 *   get: (path:string) => string | undefined,
 *   remember: (path:string, text:string) => void,
 *   edit: (path:string, text:string) => void,
 *   clear: () => void,
 *   prune: (paths:Set<string>) => void,
 *   isDirty: () => boolean,
 * }}
 */
export function createEditorBuffer() {
  const buffers = new Map()
  const dirty = new Set()
  return {
    has: (path) => buffers.has(path),
    get: (path) => buffers.get(path),
    remember: (path, text) => { buffers.set(path, text); dirty.delete(path) },
    edit: (path, text) => { buffers.set(path, text); dirty.add(path) },
    clear: () => { buffers.clear(); dirty.clear() },
    prune: (paths) => {
      for (const path of [...buffers.keys()]) if (!paths.has(path)) buffers.delete(path)
      for (const path of [...dirty]) if (!paths.has(path)) dirty.delete(path)
    },
    isDirty: () => dirty.size > 0,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/editorBuffer.test.js`
Expected: PASS.

- [ ] **Step 5: Use it in `editor.js`**

In `apps/jscad-web/src/editor.js`:

Add the import:
```js
import { createEditorBuffer } from './editorBuffer.js'
```

Add module state near `let currentFile = '/index.js'` (line 36):
```js
const buffer = createEditorBuffer()
```

Add a doc-change listener in the `EditorView` extensions (inside `init`, after `javascript(),`):
```js
      EditorView.updateListener.of((update) => {
        if (update.docChanged) buffer.edit(currentFile, update.state.doc.toString())
      }),
```

Replace `setSource` (lines 171-178) with:
```js
/** 
 * @param {string} source 
 * @param {string} path 
 */
export const setSource = (source, path = '/index.js') => {
  currentFile = path
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } })
  // The doc-change listener has run synchronously and marked the path dirty;
  // this content is authoritative, so it is clean and the label names it.
  buffer.remember(path, source)
  if (editorFile) editorFile.textContent = path
}
```

Replace the file-button click handler in `setFiles` (lines 226-230) with:
```js
      button.addEventListener('click', () => {
        if (currentFile !== file.fullPath) buffer.edit(currentFile, view.state.doc.toString())
        currentFile = file.fullPath
        editorFile.textContent = currentFile
        if (buffer.has(currentFile)) setSource(buffer.get(currentFile), currentFile)
        else readSource(file, currentFile)
      })
```

Change `setFiles` to accept a merge option and prune:
```js
/**
 * @param {FSFileEntry[]} files
 * @param {{keepBuffers?: boolean}} [options]
 */
export const setFiles = (files, { keepBuffers = false } = {}) => {
  const editorFiles = document.getElementById('editor-files')
  editorFilesArr = files
  if (keepBuffers) buffer.prune(new Set(files.map((f) => f.fullPath)))
  else buffer.clear()
  if (files.length < 2) {
    editorNav.classList.remove('visible')
  } else {
    editorFile.textContent = currentFile
    editorFiles.innerHTML = ''
    files.forEach((file) => {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.innerText = file.fullPath
      button.addEventListener('click', () => {
        if (currentFile !== file.fullPath) buffer.edit(currentFile, view.state.doc.toString())
        currentFile = file.fullPath
        editorFile.textContent = currentFile
        if (buffer.has(currentFile)) setSource(buffer.get(currentFile), currentFile)
        else readSource(file, currentFile)
      })
      item.appendChild(button)
      editorFiles.appendChild(item)
    })
    editorNav.classList.add('visible')
  }
}
```

- [ ] **Step 6: Add `confirmDiscard`**

Add near `isDirty`-style exports in `editor.js`:
```js
/** @type {((options:{title:string,message:string,confirmLabel:string,cancelLabel:string}) => Promise<boolean>) | undefined} */
let confirmFn

/** @returns {boolean} whether any open path has unsaved edits */
export const isDirty = () => buffer.isDirty()

/**
 * The gate before a whole-project replace: true to proceed. Clean buffers
 * proceed silently; a dirty buffer asks the injected confirm dialog.
 * @returns {Promise<boolean>}
 */
export const confirmDiscard = async () => {
  if (!buffer.isDirty() || !confirmFn) return true
  return confirmFn({
    title: 'Discard unsaved edits?',
    message: 'Opening this replaces the editor with the project’s saved files. Your unsaved edits will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep edits',
  })
}
```

Add `_confirm` as the fifth parameter of `init` (line 71) and assign it:
```js
export const init = (defaultCode, fn, _saveFn, _getFileFn, _confirm) => {
```
and after `getFileFn = _getFileFn` (line 90): `confirmFn = _confirm`.

- [ ] **Step 7: Verify the app tests and lint still pass**

Run: `cd apps/jscad-web && npx vitest run test/editorBuffer.test.js test/project-files.test.js`
Expected: PASS. (The `init` signature change is additive; `main.js` is updated in Task 3.)

- [ ] **Step 8: Commit**

```bash
git add apps/jscad-web/src/editorBuffer.js apps/jscad-web/src/editor.js apps/jscad-web/test/editorBuffer.test.js
git commit -m "fix(editor): keep a per-path dirty buffer and label the open file"
```

---

### Task 3: Confirm before a whole-project replace

**Files:**
- Create: `apps/jscad-web/src/ui/dialog.js`
- Modify: `apps/jscad-web/src/projectFiles.js` (`createProjectSwitch`)
- Modify: `apps/jscad-web/main.js` (inject `confirm`; gate the direct `setSource` loads; gate `showFile`)
- Modify: `apps/jscad-web/static/main.css` (overlay styles)
- Test: `apps/jscad-web/test/dialog.test.js`, `apps/jscad-web/test/project-files.test.js`

**Interfaces:**
- Consumes: `editor.confirmDiscard()` (Task 2).
- Produces: `confirm({title, message, confirmLabel, cancelLabel}) → Promise<boolean>`.

- [ ] **Step 1: Write the dialog test**

Create `apps/jscad-web/test/dialog.test.js`:

```js
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { confirm } from '../src/ui/dialog.js'

describe('confirm dialog', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('resolves true when the confirm label is clicked', async () => {
    const p = confirm({ title: 'Delete?', message: 'gone', confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    document.querySelector('.confirm-ok').click()
    expect(await p).toBe(true)
    expect(document.querySelector('.confirm-overlay')).toBeNull()
  })

  it('resolves false on cancel', async () => {
    const p = confirm({ title: 'Keep?', message: 'x', confirmLabel: 'Discard', cancelLabel: 'Keep edits' })
    document.querySelector('.confirm-cancel').click()
    expect(await p).toBe(false)
  })

  it('resolves false on a backdrop click', async () => {
    const p = confirm({ title: 'x', message: 'y' })
    const overlay = document.querySelector('.confirm-overlay')
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await p).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/dialog.test.js`
Expected: FAIL — cannot find `../src/ui/dialog.js`.

- [ ] **Step 3: Implement the dialog**

Create `apps/jscad-web/src/ui/dialog.js`:

```js
/**
 * A small modal confirm over the app; resolves true on confirm, false on
 * cancel or a backdrop click.
 * @param {{title:string, message:string, confirmLabel?:string, cancelLabel?:string}} options
 * @returns {Promise<boolean>}
 */
export const confirm = ({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel' }) =>
  new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'
    const box = document.createElement('div')
    box.className = 'confirm-box'
    const heading = document.createElement('h2')
    heading.className = 'confirm-title'
    heading.textContent = title
    const body = document.createElement('p')
    body.className = 'confirm-message'
    body.textContent = message
    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'confirm-cancel'
    cancel.textContent = cancelLabel
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'confirm-ok'
    ok.textContent = confirmLabel
    actions.append(cancel, ok)
    box.append(heading, body, actions)
    overlay.append(box)
    const done = (value) => { overlay.remove(); resolve(value) }
    cancel.addEventListener('click', () => done(false))
    ok.addEventListener('click', () => done(true))
    overlay.addEventListener('click', (event) => { if (event.target === overlay) done(false) })
    document.body.append(overlay)
    ok.focus?.()
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/dialog.test.js`
Expected: PASS.

- [ ] **Step 5: Gate `createProjectSwitch`**

In `apps/jscad-web/src/projectFiles.js`, update the JSDoc `editor` type to include `confirmDiscard?: () => Promise<boolean>` and add the gate at the top of the returned function:

```js
export const createProjectSwitch = ({ manager, fileSystem, editor, clearTempCache, build, onOpen, onError }) => async (id) => {
  if (editor.confirmDiscard && !(await editor.confirmDiscard())) return
  const { project, files } = await manager.readForSwitch(id)
  onOpen(id, project.entry, project.name)
  clearTempCache()
  await replaceProjectFiles(fileSystem, files)
  editor.setFiles(toEditorFiles(files))
  editor.setSource(files[project.entry] ?? '', project.entry)
  build(project.entry).catch(onError)
}
```

Add to the `createProjectSwitch` test in `test/project-files.test.js`:

```js
  it('aborts the switch when the editor refuses to discard', async () => {
    const editor = { setFiles: vi.fn(), setSource: vi.fn(), confirmDiscard: async () => false }
    const manager = { readForSwitch: vi.fn() }
    const onOpen = vi.fn()
    await createProjectSwitch({ manager, fileSystem: { clearProjectCache: async () => {}, addToCacheWrapper: async () => {} }, editor, clearTempCache: vi.fn(), build: vi.fn(), onOpen, onError: vi.fn() })('p1')
    expect(manager.readForSwitch).not.toHaveBeenCalled()
    expect(editor.setFiles).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/project-files.test.js`
Expected: PASS.

- [ ] **Step 7: Inject the dialog and gate the remaining replaces in `main.js`**

Add the import: `import { confirm } from './src/ui/dialog.js'` and pass it to the editor init (change `editor.init(defaultCode, compile, save, getFile)` at `main.js:822` — its call already spans lines 822-886 with the two function args; append `, confirm` as the last argument after the `path => fileSystem.getSwHandler()?.getFile(path),` line at 885).

Gate the two boot loads. `main.js:893-905` (remote init callback): change `editor.setSource(script, fullUrl)` to run only after a discard check:
```js
      async (script, url) => {
        if (!(await editor.confirmDiscard())) return
        const fullUrl = new URL(url, appBase).toString()
        editor.setSource(script, fullUrl)
        jscadScript({ script, url, base: appBase })
        welcome.dismiss()
      },
```
`main.js:914-919` (default script): wrap identically:
```js
if (loadDefault && !hasRemoteScript) {
  const defaultUrl = './examples/jscad/01-two-cars.example.js'
  const fullUrl = new URL(defaultUrl, appBase).toString()
  if (await editor.confirmDiscard()) {
    editor.setSource(defaultCode, fullUrl)
    jscadScript({ script: defaultCode, url: defaultUrl, base: appBase })
  }
}
```
Gate `showFile` (`main.js:951-954`):
```js
  showFile: (path, content, files) => {
    editor.confirmDiscard().then((ok) => {
      if (!ok) return
      editor.setSource(content, path)
      editor.setFiles(toEditorFiles(files), { keepBuffers: true })
    })
  },
```
(The chat write is already stored; "Keep edits" leaves the editor text as the user had it.)

- [ ] **Step 8: Style the dialog**

Add to `apps/jscad-web/static/main.css`:
```css
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.confirm-box {
  background: #fff;
  color: #111;
  border-radius: 8px;
  padding: 16px 20px;
  max-width: 380px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
.confirm-title { margin: 0 0 8px; font-size: 1rem; }
.confirm-message { margin: 0 0 16px; font-size: 0.9rem; }
.confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 9: Verify**

Run: `cd apps/jscad-web && npx vitest run test/dialog.test.js test/project-files.test.js test/editorBuffer.test.js`
Expected: PASS. Then `cd /home/john/src/jscadui && npm run typecheck` — clean.

- [ ] **Step 10: Commit**

```bash
git add apps/jscad-web/src/ui/dialog.js apps/jscad-web/src/projectFiles.js apps/jscad-web/main.js apps/jscad-web/static/main.css apps/jscad-web/test/dialog.test.js apps/jscad-web/test/project-files.test.js
git commit -m "feat(editor): confirm before replacing unsaved edits"
```

---

### Task 4: Bind a chat turn to the project it started in

**Files:**
- Modify: `apps/jscad-web/src/aiChat.js`
- Test: `apps/jscad-web/test/aiChat.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `runTurnLocal` persists every phase under the turn's start project; view writes stop once the live project differs.

- [ ] **Step 1: Write the failing test**

Add to the `describe('project switch', ...)` block in `apps/jscad-web/test/aiChat.test.js`:

```js
  it('persists an in-flight turn under the project it started in, and keeps the new project view', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const store = {}
    const storage = {
      readConversation: async (pid) => (store[pid] ? { messages: store[pid], updated: 1 } : null),
      writeConversation: vi.fn(async (pid, messages) => { store[pid] = messages }),
    }
    const runTurnFn = vi.fn(async ({ onText }) => {
      await gate
      onText('late reply')
      return { messages: [] }
    })
    let openId = 'p1'
    const chat = openChat({ runTurnFn, storage, projectId: () => openId })
    chat.type('hello p1')
    await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalled())
    openId = 'p2'
    await chat.controls.switchTo('p2')
    release()
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({ role: 'assistant', content: 'late reply' }))
    expect(storage.writeConversation.mock.calls.at(-1)[0]).toBe('p1')
    expect(store.p1).toContainEqual({ role: 'assistant', content: 'late reply' })
    expect(chat.q('.chat-messages').textContent).not.toContain('late reply')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js -t "in-flight turn"`
Expected: FAIL — the reply is persisted under `p2` (or rendered into the new view).

- [ ] **Step 3: Thread the turn's project through persistence and the view**

In `apps/jscad-web/src/aiChat.js`:

Change `persistTranscript` (lines 107-114) to take an explicit id:
```js
  const persistTranscript = async (id = pid()) => {
    if (!storage || !id) return
    try {
      await storage.writeConversation(id, transcript)
    } catch (err) {
      console.warn('chat persist failed:', err)
    }
  }
```

In `switchTo` (lines 177-190) and the initial load, keep the default `pid()`. No change needed there.

Replace `runTurnLocal` (lines 311-380) with a version that keeps its own transcript array, persists under the captured project, and only touches the DOM while still live:

```js
  const runTurnLocal = async (message) => {
    const selection = getProvider()
    if (!selection) {
      addMessage('Set your model and API key in AI settings first.', 'error')
      return
    }
    const turnProject = pid()
    const live = () => turnProject === pid()
    let local = [...transcript, { role: 'user', content: message }]
    if (live()) { transcript = local; persistTranscript(turnProject) }
    setRunning(true)
    if (live()) addMessage(message, 'user')
    assistantEl = null
    aborter = new AbortController()
    const { signal } = aborter
    let assistantText = ''
    let stopped = false
    turnReasoning = []
    const reply = (fields) => ({ role: 'assistant', content: assistantText, ...fields, ...(turnReasoning.length > 0 ? { reasoning: turnReasoning } : {}) })
    const commit = (messages) => {
      local = messages
      if (!live()) return
      transcript = messages
      persistTranscript(turnProject)
    }
    try {
      const provider = createProvider({
        ...selection,
        baseUrl: selection.baseUrl || relayBaseUrl(selection.kind),
        sessionId: sessionId(),
        ...(selection.baseUrl ? {} : { chatId: sessionId() }),
      })
      startTurn()
      const files = await projectFiles()
      const build = await lastBuild()
      const api = getApi()
      await runTurnFn({
        conversation: { messages: buildMessages({ systemPrompt: buildSystemPrompt(api), transcript: local.slice(0, -1).map(forModel), files, build, message }) },
        provider,
        api,
        requestTool: handleTool,
        onText: (text) => {
          assistantText += text
          if (!live()) return
          if (!assistantEl) assistantEl = addMessage('', 'assistant')
          assistantEl.textContent += text
          messagesEl.scrollTop = messagesEl.scrollHeight
        },
        onReasoning: (text) => { if (live()) addReasoning(text) },
        onStatus: (next) => { if (live()) setStatus(next) },
        signal,
      })
      endReasoning()
      if (assistantText) commit([...local, reply()])
    } catch (err) {
      endReasoning()
      if (signal.aborted) stopped = true
      else {
        commit([...transcript.slice(0, -1)])
        if (live()) addMessage(err.message, 'error')
      }
    } finally {
      if (stopped) {
        if (live()) addStopped()
        commit([...local, reply({ stopped: true })])
      }
      await finishTurn()
      assistantEl = null
      aborter = null
      setRunning(false)
    }
  }
```

Note: `buildMessages` previously received `prior.map(forModel)` (the transcript before this user message); `local.slice(0, -1)` is the same prior.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js`
Expected: PASS (existing conversation/switch tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiChat.test.js
git commit -m "fix(chat): persist an in-flight turn under the project it started in"
```

---

### Task 5: Chat storage follows the project's mode; New chat

**Files:**
- Modify: `apps/jscad-web/src/storage/session.js`
- Modify: `apps/jscad-web/src/aiChat.js`
- Modify: `apps/jscad-web/main.js:986-1004`
- Test: `apps/jscad-web/test/storage-session.test.js`, `apps/jscad-web/test/aiChat.test.js`

**Interfaces:**
- Produces: `createSession(...)` also returns `readConversation(projectId)` / `writeConversation(projectId, messages)`, routed by `getBackend`.
- Produces: `initChat` returns `{ switchTo, newChat }`; a `.chat-new` button in the header.

- [ ] **Step 1: Write the failing session test**

Add to `apps/jscad-web/test/storage-session.test.js`:

```js
  it('routes a conversation through the project mode backend', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const session = createSession({ local, getRowboat: () => rowboat, getBackend: () => 'rowboat' })
    await session.writeConversation('p1', [{ role: 'user', content: 'hi' }])
    expect((await rowboat.readConversation('p1')).messages).toEqual([{ role: 'user', content: 'hi' }])
    expect((await session.readConversation('p1')).messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('falls back to local when the rowboat backend is unavailable', async () => {
    const local = createLocalStorage()
    const session = createSession({ local, getRowboat: () => null, getBackend: () => 'rowboat' })
    await session.writeConversation('p2', [{ role: 'user', content: 'x' }])
    expect((await local.readConversation('p2')).messages).toEqual([{ role: 'user', content: 'x' }])
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js`
Expected: FAIL — `session.writeConversation is not a function`.

- [ ] **Step 3: Add conversation passthroughs to the session**

In `apps/jscad-web/src/storage/session.js`, before the `return`:
```js
  const readConversation = (projectId) => backendFor(projectId).readConversation(projectId)
  const writeConversation = (projectId, messages) => backendFor(projectId).writeConversation(projectId, messages)
```
and change the return to:
```js
  return { readThrough, writeThrough, snapshot, readConversation, writeConversation }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js`
Expected: PASS.

- [ ] **Step 5: Add the New-chat test to `aiChat.test.js`**

Add to `describe('stored conversation', ...)`:
```js
  it('New chat clears the view and persists an empty conversation for the open project', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const storage = {
      readConversation: async () => ({ messages: [{ role: 'user', content: 'old' }], updated: 1 }),
      writeConversation: vi.fn(async () => {}),
    }
    const chat = openChat({ runTurnFn: vi.fn(), storage, projectId: 'p1' })
    await vi.waitFor(() => expect(container.querySelector('.chat-messages').textContent).toMatch(/old/))
    container.querySelector('.chat-new').click()
    await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalledWith('p1', []))
    expect(container.querySelector('.chat-messages').textContent).toBe('')
  })
```
(Use the local `openChat` helper already defined in the file; if it does not exist for a case, initialise with `initChat` exactly as the neighbouring tests do.)

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js -t "New chat"`
Expected: FAIL — no `.chat-new` button.

- [ ] **Step 7: Implement the New-chat button in `aiChat.js`**

Change the header (line 70) and add the control:
```js
  const header = el('div', 'chat-header')
  header.append(el('span', 'chat-title', 'AI Chat'))
  const newChatBtn = el('button', 'chat-new', 'New chat')
  newChatBtn.type = 'button'
  newChatBtn.title = 'Start a new conversation'
  header.append(newChatBtn)
```

Add `newChat` next to `switchTo` (before the final `return`):
```js
  const newChat = async () => {
    if (running) return
    transcript = []
    messagesEl.innerHTML = ''
    assistantEl = null
    turnReasoning = []
    if (storage && pid()) {
      try {
        await storage.writeConversation(pid(), [])
      } catch (err) {
        console.warn('chat persist failed:', err)
      }
    }
  }
  newChatBtn.addEventListener('click', newChat)
```

Change the return (line 392) to:
```js
  return { switchTo, newChat }
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiChat.test.js`
Expected: PASS.

- [ ] **Step 9: Route chat through the session in `main.js`**

Replace `main.js:988-991` (`const chatStorage = { readConversation: ..., writeConversation: ... }`) with:
```js
  const chatStorage = {
    readConversation: (pid) => storageSession.readConversation(pid),
    writeConversation: (pid, messages) => storageSession.writeConversation(pid, messages),
  }
```
`storageSession` (line 379) already routes by `projectManager.peekMode`.

- [ ] **Step 10: Verify and commit**

Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js test/aiChat.test.js`
Expected: PASS.

```bash
git add apps/jscad-web/src/storage/session.js apps/jscad-web/src/aiChat.js apps/jscad-web/main.js apps/jscad-web/test/storage-session.test.js apps/jscad-web/test/aiChat.test.js
git commit -m "fix(chat): route conversations by project mode and add New chat"
```

---

### Task 6: Backend and manager delete

**Files:**
- Modify: `apps/jscad-web/src/storage/local.js`
- Modify: `apps/jscad-web/src/storage/rowboat.js`
- Modify: `apps/jscad-web/src/storage/disk.js`
- Modify: `apps/jscad-web/src/storage/projects.js`
- Test: `apps/jscad-web/test/storage-interface.test.js`, `apps/jscad-web/test/storage-projects.test.js`

**Interfaces:**
- Produces: every backend `deleteProject(id) → Promise<void>`; `createProjectManager(...)` returns `deleteProject(id)`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/jscad-web/test/storage-interface.test.js`:
```js
  it('deletes a project, its versions and its conversation', async () => {
    const store = createLocalStorage()
    await store.writeFiles('p9', { 'main.js': 'v1' }, { message: 'one', name: 'P9', entry: 'main.js' })
    await store.writeConversation('p9', [{ role: 'user', content: 'x' }])
    await store.deleteProject('p9')
    expect(await store.listProjects()).toEqual([])
    expect(await store.listVersions('p9')).toEqual([])
    expect(await store.readConversation('p9')).toBeNull()
  })
```

Add to the `describe('project manager', ...)` block in `apps/jscad-web/test/storage-projects.test.js`:
```js
  it('deletes the project from its owner backend', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    await manager.deleteProject(id)
    expect(await manager.listAll()).toEqual([])
    expect(manager.peekMode(id)).toBe('local')
  })

  it('refuses to delete the disk project', async () => {
    const local = createLocalStorage()
    const disk = createDiskStorage({ fetch: async () => new Response('{}'), EventSource: class {} })
    const manager = createProjectManager({ local, disk, getRowboat: () => null })
    await expect(manager.deleteProject('disk')).rejects.toThrow(/disk/)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/jscad-web && npx vitest run test/storage-interface.test.js test/storage-projects.test.js`
Expected: FAIL — `deleteProject is not a function`.

- [ ] **Step 3: Implement `deleteProject` in each backend**

`apps/jscad-web/src/storage/local.js`, before the `return`:
```js
  const deleteProject = async (id) => {
    projects.delete(id)
    versions.delete(id)
    conversations.delete(id)
  }
```
and add `deleteProject` to the returned object.

`apps/jscad-web/src/storage/rowboat.js`, before `close`:
```js
  const deleteProject = async (id) => {
    const project = await db.table('projects').get(id)
    if (project && !project.__deleted) await db.remove('projects', id)
    for (const table of ['files', 'versions', 'conversations']) {
      const rows = await rowsFor(table, id)
      if (rows.length > 0) await db.remove(table, rows.map((r) => r.id))
    }
  }
```
Add `deleteProject` to the returned object. Confirm in the first implementer step that `db.remove` exists and tombstones (grep `node_modules/@jbroll/rowboat-client/src` for `remove(`); if it only hard-deletes, still use it — the sync push sends the removal op (see `sync-push` delete handling) — and note the finding in the report.

`apps/jscad-web/src/storage/disk.js`, in the returned object:
```js
    deleteProject: async () => {
      throw new Error('the disk project is the model directory; it cannot be deleted')
    },
```

- [ ] **Step 4: Add manager `deleteProject`**

In `apps/jscad-web/src/storage/projects.js`, after `restoreVersion`:
```js
  const deleteProject = async (id) => {
    if ((await modeOf(id)) === 'disk') throw new Error('the disk project is the model directory; it cannot be deleted')
    const store = await ownerOf(id)
    await store.deleteProject(id)
    modes.delete(id)
  }
```
Add `deleteProject` to the manager's returned object.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/jscad-web && npx vitest run test/storage-interface.test.js test/storage-projects.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/storage/local.js apps/jscad-web/src/storage/rowboat.js apps/jscad-web/src/storage/disk.js apps/jscad-web/src/storage/projects.js apps/jscad-web/test/storage-interface.test.js apps/jscad-web/test/storage-projects.test.js
git commit -m "feat(storage): add deleteProject to backends and the manager"
```

---

### Task 7: Delete control and drawer status in the project panel

**Files:**
- Modify: `apps/jscad-web/src/projects.js`
- Modify: `apps/jscad-web/main.js` (wire `onDelete`, `confirm`, `onRetrySync`, `setSyncStatus`)
- Modify: `apps/jscad-web/static/main.css`
- Test: `apps/jscad-web/test/projects-ui.test.js`

**Interfaces:**
- Consumes: `confirm` (Task 3), `manager.deleteProject` (Task 6).
- Produces: `initProjects(...)` accepts `confirm`, `onDelete`, `onRetrySync`; returns `{ render, select, setSyncStatus }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/jscad-web/test/projects-ui.test.js`:
```js
describe('delete', () => {
  it('asks for confirmation then calls onDelete', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    const { id } = await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    const onDelete = vi.fn()
    initProjects({ container: document.getElementById('panel'), manager, onSwitch: async () => {}, onDelete, confirm: async () => true })
    await vi.waitFor(() => expect(document.querySelector('.project-delete')).not.toBeNull())
    document.querySelector('.project-delete').click()
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith(id))
  })

  it('does not delete when the confirm is declined', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    const onDelete = vi.fn()
    initProjects({ container: document.getElementById('panel'), manager, onSwitch: async () => {}, onDelete, confirm: async () => false })
    await vi.waitFor(() => expect(document.querySelector('.project-delete')).not.toBeNull())
    document.querySelector('.project-delete').click()
    await new Promise((r) => setTimeout(r, 0))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('disables delete on the disk row', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const disk = { listProjects: async () => [{ id: 'disk', name: 'main.js', entry: 'main.js', mode: 'disk' }], listVersions: async () => [] }
    const manager = createProjectManager({ local: createLocalStorage(), disk, getRowboat: () => null })
    initProjects({ container: document.getElementById('panel'), manager, onSwitch: async () => {}, onDelete: vi.fn(), confirm: async () => true })
    await vi.waitFor(() => expect(document.querySelector('.project-delete')).not.toBeNull())
    expect(document.querySelector('.project-delete').disabled).toBe(true)
  })
})

describe('mode labels', () => {
  it('names the modes for what they mean', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    initProjects({ container: document.getElementById('panel'), manager, onSwitch: async () => {} })
    await vi.waitFor(() => expect(document.querySelector('.project-open')).not.toBeNull())
    expect(document.querySelector('.project-open').textContent).toBe('Gear (This device)')
  })
})
```

Also update the existing mode-toggle test at line 153 that asserts `toggle.textContent` is `'disk'` to `'Folder'`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js`
Expected: FAIL — no `.project-delete`; label text mismatch.

- [ ] **Step 3: Implement in `projects.js`**

Add a mode-label map and a status line near the top of `initProjects`:
```js
const MODE_LABEL = { local: 'This device', rowboat: 'Synced', disk: 'Folder' }
const modeLabel = (mode) => MODE_LABEL[mode] ?? mode
```

Change the `initProjects` signature to add `confirm = async () => true, onDelete, onRetrySync`:
```js
export const initProjects = ({ container, manager, onSwitch, onDropOnProject, onRestore, onFlip, onError = () => {}, canUseRowboat = false, readBuffer = () => ({ code: '', path: 'main.js' }), confirm = async () => true, onDelete, onRetrySync }) => {
```

After `const versionsEl = ...` (line 21), add and mount the status line:
```js
  const syncEl = el('div', 'project-sync-status')
  syncEl.style.display = 'none'
  container.append(header, list, syncEl, versionsEl)
```
(remove the old `container.append(header, list, versionsEl)`.)

Add the setter and retry:
```js
  const setSyncStatus = (text) => {
    syncEl.textContent = ''
    if (!text) { syncEl.style.display = 'none'; return }
    syncEl.style.display = ''
    syncEl.append(document.createTextNode(`${text} `))
    if (onRetrySync) {
      const retry = el('button', 'sync-retry', 'Retry')
      retry.type = 'button'
      retry.addEventListener('click', () => { onRetrySync() })
      syncEl.append(retry)
    }
  }
```

Update `refreshMode` label text (lines 65-75): set `modeBtn.textContent = modeLabel(mode)` in both branches (and `modeLabel('local')`/`'disk'` where literals were used). Keep the disabled/title logic.

In `render`, change the label text (line 98) to and add the delete button:
```js
      const label = el('button', 'project-open', `${p.name} (${modeLabel(p.mode)})`)
```
```js
      const del = el('button', 'project-delete', 'Delete')
      del.type = 'button'
      del.disabled = p.mode === 'disk'
      del.title = del.disabled ? 'The model directory stays on disk' : 'Delete this project'
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        const ok = await confirm({ title: 'Delete project?', message: `“${p.name}” and its history will be removed.`, confirmLabel: 'Delete', cancelLabel: 'Cancel' })
        if (!ok) return
        try { await onDelete?.(p.id) } catch (err) { onError(err) }
      })
      row.append(label, rename, del)
```

Change the return to `return { render, select, setSyncStatus }`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `main.js`**

Import `confirm` is already imported (Task 3). Replace the `initProjects({ ... })` call (`main.js:1017-1032`) additions:
```js
const projectPanel = initProjects({
  container: byId('project-drawer-body'),
  manager: projectManager,
  onSwitch: (id) => switchProject(id).catch(setError),
  onDropOnProject: async (id, dataTransfer) => { /* unchanged */ },
  onRestore: (id) => switchProject(id).catch(setError),
  onError: setError,
  onFlip: () => projectPanel.render(),
  readBuffer: () => ({ code: editor.getSource(), path: 'main.js' }),
  canUseRowboat: (await getRowboatStore()) !== null,
  confirm,
  onDelete: async (id) => {
    await projectManager.deleteProject(id)
    if (id === currentProjectId) {
      const next = pickBootProject(await projectManager.listAll())
      if (next) await switchProject(next)
    }
    await projectPanel.render()
  },
  onRetrySync: () => syncHandle?.syncNow(),
})
```
`pickBootProject` is imported in Task 1. `currentProjectId`/`switchProject` are in scope.

- [ ] **Step 6: Style**

Add to `apps/jscad-web/static/main.css`:
```css
.project-sync-status {
  padding: 6px 10px;
  font-size: 0.8rem;
  color: #b00020;
}
.project-delete { margin-left: 4px; }
```

- [ ] **Step 7: Verify and commit**

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js`
Expected: PASS.

```bash
git add apps/jscad-web/src/projects.js apps/jscad-web/main.js apps/jscad-web/static/main.css apps/jscad-web/test/projects-ui.test.js
git commit -m "feat(projects): delete control, friendly mode labels, sync status line"
```

Note: `syncHandle` is introduced in Task 9. Until then, use `onRetrySync: () => initSyncRetry?.()` — actually keep it simple: this step sets `onRetrySync` to a function that references a `let syncHandle = null` declared in Task 9. To keep Task 7 self-contained, add `let syncHandle = null` near `rowboatStorePromise` (line 424) in this task, and Task 9 assigns it.

---

### Task 8: Mode flip removes the old row; listAll dedupes

**Files:**
- Modify: `apps/jscad-web/src/storage/projects.js`
- Test: `apps/jscad-web/test/storage-projects.test.js`

**Interfaces:**
- Consumes: backend `deleteProject` (Task 6).
- Produces: `flipMode` leaves no stale copy; `listAll` returns one row per id.

- [ ] **Step 1: Rewrite the flip test**

Replace the `'flips mode by copying current files, leaving old rows behind'` test (`storage-projects.test.js:43-51`) with:
```js
  it('flips mode by moving the project to the other backend', async () => {
    const { manager, local, rowboat } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    expect(await manager.flipMode(id)).toBe('rowboat')
    expect((await rowboat.readProject(id)).files).toEqual({ 'main.js': 'v1' })
    await expect(local.readProject(id)).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(await manager.listAll()).toHaveLength(1)
    expect(await manager.flipMode(id)).toBe('local')
    expect(manager.peekMode(id)).toBe('local')
    await expect(rowboat.readProject(id)).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('lists a project once even if both backends hold the id', async () => {
    const { manager, local, rowboat } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    // Simulate a project that predates the flip fix: a stale copy in rowboat.
    await rowboat.writeFiles(id, { 'main.js': 'v1' }, { message: 'stale', name: 'P', entry: 'main.js', mode: 'rowboat' })
    const ids = (await manager.listAll()).map((p) => p.id)
    expect(ids.filter((x) => x === id)).toHaveLength(1)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/jscad-web && npx vitest run test/storage-projects.test.js`
Expected: FAIL — the old row survives the flip and listAll returns two rows.

- [ ] **Step 3: Fix `flipMode`**

In `apps/jscad-web/src/storage/projects.js`, replace the body of `flipMode` (lines 122-131):
```js
  const flipMode = async (id) => {
    const from = await ownerOf(id)
    const project = await from.readProject(id)
    if (project.mode === 'disk') throw new Error('the disk project is the model directory; it cannot change mode')
    const toMode = project.mode === 'rowboat' ? 'local' : 'rowboat'
    const to = storeFor(toMode)
    if (to === from) throw new Error('rowboat unavailable')
    await to.writeFiles(id, project.files, { message: `mode to ${toMode}`, name: project.name, entry: project.entry, mode: toMode })
    await from.deleteProject(id)
    return remember(id, toMode)
  }
```

- [ ] **Step 4: Dedupe `listAll`**

In `listAll` (lines 61-72), after building `all` and before sorting, dedupe keeping the first occurrence of each id:
```js
    const byId = new Map()
    for (const p of all) if (!byId.has(p.id)) byId.set(p.id, p)
    all = [...byId.values()]
```
`all` is declared `const`; change it to `let all` (line 62). Keep the existing `modes` fill and sort after the dedupe.

- [ ] **Step 5: Run to verify they pass**

Run: `cd apps/jscad-web && npx vitest run test/storage-projects.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/jscad-web/src/storage/projects.js apps/jscad-web/test/storage-projects.test.js
git commit -m "fix(storage): move a project on mode flip and dedupe the list"
```

---

### Task 9: Sign-out teardown, sync status wiring, labels in `main.js`

**Files:**
- Modify: `apps/jscad-web/src/aiAccount.js`
- Modify: `apps/jscad-web/main.js`
- Test: `apps/jscad-web/test/aiAccount.test.js`

**Interfaces:**
- Consumes: `projectPanel.setSyncStatus` (Task 7).
- Produces: `initAccount(container, { onSignOut }) → void`; `syncHandle` assigned so `onRetrySync` works.

- [ ] **Step 1: Write the failing account test**

Add to `apps/jscad-web/test/aiAccount.test.js` (it is jsdom; follow its existing setup and `fetch` stubbing):
```js
  it('calls onSignOut after a successful sign-out', async () => {
    document.body.innerHTML = '<div id="acct"></div>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: null }), { status: 200 })))
    const onSignOut = vi.fn()
    initAccount(document.getElementById('acct'), { onSignOut })
    document.querySelector('.ai-button') // sign-in button; sign-out is hidden until session known
    await vi.waitFor(() => expect(document.querySelector('.ai-session')).not.toBeNull())
    // The sign-out button is the third button in the header row.
    const signOutBtn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign out')
    signOutBtn.click()
    await vi.waitFor(() => expect(onSignOut).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
```
(Adjust selectors to the file's existing helpers if it has them; the intent is: clicking Sign out calls `onSignOut`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js -t "onSignOut"`
Expected: FAIL — `onSignOut` never called.

- [ ] **Step 3: Add the `onSignOut` option**

In `apps/jscad-web/src/aiAccount.js`, change `initAccount` (line 91):
```js
export const initAccount = (container, { onSignOut = () => {} } = {}) => {
```
and the sign-out handler (lines 141-144):
```js
  signOut.addEventListener('click', async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }).catch(() => {})
    onSignOut()
    refreshSession()
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/jscad-web && npx vitest run test/aiAccount.test.js`
Expected: PASS.

- [ ] **Step 5: Wire teardown, status and retry in `main.js`**

`syncHandle` was declared in Task 7. Replace `initSyncLoop` (lines 466-478) to assign the handle and report status:
```js
const initSyncLoop = async () => {
  const store = await getRowboatStore()
  if (!store) return
  const { createSyncLoop } = await import('./src/storage/sync.js')
  syncHandle = createSyncLoop({
    storage: store,
    getToken: async () => (await fetchSyncToken())?.token ?? null,
    onError: (err) => {
      console.warn('rowboat sync failed:', err)
      projectPanel?.setSyncStatus('Sync failed')
    },
  })
  syncHandle.start()
}
```
`projectPanel` is defined later (line 1017); declare `let projectPanel = null` before `initSyncLoop` and assign it (change `const projectPanel = initProjects(...)` to `projectPanel = initProjects(...)`). Because `initSyncLoop()` is called at line 478 before `projectPanel` exists, guard with `projectPanel?.`.

On a successful sync, clear the status. In the sync loop's success path, `main` has no hook; instead clear the status whenever `syncNow` succeeds by wrapping `onRetrySync` and adding a success callback. Simplest: extend `createSyncLoop` with an `onSync` success callback:
- `apps/jscad-web/src/storage/sync.js`: add `onSync = () => {}` option; call `onSync()` after `await storage.sync()` in `syncNow`.
- `main.js`: pass `onSync: () => projectPanel?.setSyncStatus('')`.

Sign-out: pass `onSignOut` to `initAccount` (line 986):
```js
if (byId('ai-account')) initAccount(byId('ai-account'), {
  onSignOut: async () => {
    syncHandle?.stop()
    syncHandle = null
    try { await rowboatStore?.close() } catch (err) { console.warn('rowboat close failed:', err) }
    rowboatStore = null
    rowboatStorePromise = null
    projectPanel?.setSyncStatus('')
    await projectPanel?.render()
  },
})
```

- [ ] **Step 6: Add the `onSync` test**

Add to `apps/jscad-web/test/storage-sync.test.js`:
```js
  it('calls onSync after a successful sync', async () => {
    const storage = { sync: vi.fn(async () => {}) }
    const onSync = vi.fn()
    const loop = createSyncLoop({ storage, getToken: async () => 'jwt', intervalMs: 10, onSync })
    await loop.syncNow()
    expect(onSync).toHaveBeenCalled()
  })
```

- [ ] **Step 7: Run the full app suite**

Run: `cd apps/jscad-web && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Remove the landed backlog bullets**

Delete from `docs/backlog.md` (Projects and storage, lines 104-126 and 135-140): the boot-opens-none bullet, the editor-edits-dropped bullet, the turn-in-flight bullet, the conversations/New-chat bullet, the no-delete bullet, and the storage-mode/sync-state bullet. Keep the local-backend IndexedDB bullet (97-103) and the drop-on-row bullet (127-134).

- [ ] **Step 9: Commit**

```bash
git add apps/jscad-web/src/aiAccount.js apps/jscad-web/src/storage/sync.js apps/jscad-web/main.js apps/jscad-web/test/aiAccount.test.js apps/jscad-web/test/storage-sync.test.js docs/backlog.md
git commit -m "fix(projects): tear down sync on sign-out, surface sync status, tidy backlog"
```

---

### Task 10: e2e coverage for delete (written, run on CI)

**Files:**
- Modify: `apps/jscad-web/e2e/project-ui.spec.js`

**Interfaces:**
- Consumes: the running app; no unit interface.

Note: the boot-opens-recent behavior is unit-tested (`pickBootProject`); it is not e2e-testable, because the in-memory local backend starts with no projects on a fresh page, so boot always creates `default`.

- [ ] **Step 1: Add the delete test**

Add to the `test.describe('project drawer', ...)` block in `apps/jscad-web/e2e/project-ui.spec.js`:
```js
  test('deletes a project after confirmation', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    const rows = page.locator('.project-row')
    const before = await rows.count()
    expect(before).toBeGreaterThan(0)
    await rows.first().locator('.project-delete').click()
    await page.locator('.confirm-ok').click()
    await expect(rows).toHaveCount(before - 1)
  })
```

- [ ] **Step 2: Note the CI status**

These run under `sci push jscadui/web`, currently failing on the host rowboat-sibling issue (`docs/backlog.md` Remaining issues). Do not run Playwright locally (it stalls). Verify with `cd apps/jscad-web && npx playwright test e2e/project-ui.spec.js` only on the CI host.

- [ ] **Step 3: Commit**

```bash
git add apps/jscad-web/e2e/project-ui.spec.js
git commit -m "test(e2e): delete-a-project flow"
```

---

## Self-Review

**Spec coverage:**
- Item 1 boot → Task 1. ✔
- Item 2 dirty buffer + confirm + label → Tasks 2, 3. ✔
- Item 3 in-flight turn → Task 4. ✔
- Item 4 chat mode routing + New chat → Task 5. ✔
- Item 5 delete → Tasks 6, 7. ✔
- Item 6 flip dedupe + sign-out + status + labels → Tasks 8, 9 (labels in Task 7). ✔
- Testing section → each task plus Task 10. ✔
- Non-goals untouched. ✔

**Placeholder scan:** No TBD/TODO; every code step carries real code. Task 10 writes one concrete e2e test.

**Type consistency:** `confirm` signature identical in `src/ui/dialog.js`, `editor.confirmDiscard`, `projects.js`, and `main.js`. `pickBootProject` defined in Task 1 and used in Tasks 1 and 7. `deleteProject` defined in Task 6 and used in Tasks 7, 8. `setSyncStatus` defined in Task 7 and used in Task 9. `syncHandle` declared in Task 7, assigned in Task 9. `initChat` returns `{ switchTo, newChat }` in Task 5; `main.js` uses only `switchTo` (`chatControls`), and the New-chat button is self-wired.
