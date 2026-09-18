# Project UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project side panel in `apps/jscad-web` (list, switch, rename, version history with restore, local/rowboat toggle) over the storage-owned project model, plus stacked drawer tabs so every panel stays reachable.

**Architecture:** A `projects.js` manager owns project data over the existing storage interface; a `src/projects.js` UI module renders the drawer following the `editor.init` callback pattern; `main.js` switches projects through the existing `setSource`/`setFiles`/`jscadScript` path with stored files wrapped as `File` objects so editor clicks keep working unchanged.

**Tech Stack:** ES modules, existing storage interface (`listProjects`, `readProject`, `writeFiles`, `listVersions`, `readVersion`, conversations), `@jscadui/fs-provider` (`extractEntries`, `readDir`, `readAsText`), vitest (node + jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-project-ui-design.md`

## Global Constraints

- jscadui style: ES modules, single quotes, no semicolons. Comments: none unless they say why, one or two lines.
- History is append-only: restore and mode flip write new version rows, never mutate old ones.
- Each manifest path names exactly one backend; old version rows stay in their original backend on flip.
- Anonymous users are local-only: the mode toggle disables with a note when there is no session or token.
- The `view`/`measure` loop is untouched. No share UI, no project deletion, no diff view.
- Tests: no live server. Manager tests use the fake local backend plus a second local instance standing in for rowboat. UI tests run in jsdom.
- Leaf imports in `main.js`, never `./src/storage/index.js`: the index re-exports zod-typed schema the root TS 4.9 gate cannot parse (see root `tsconfig.json`).
- Branch: current working branch in `/home/john/src/jscadui`. Commit per task.

---

### Task 1: Project manager over the storage interface

**Files:**
- Create: `apps/jscad-web/src/storage/projects.js`
- Create: `apps/jscad-web/test/storage-projects.test.js`
- Read for reference: `apps/jscad-web/src/storage/local.js:1-20` (`kindFromEntry`), `apps/jscad-web/src/storage/index.js` (interface shape)

**Interfaces:**
- Consumes: storage interface (`listProjects`, `readProject`, `writeFiles`, `listVersions`, `readVersion`).
- Produces: `createProjectManager({ local, getRowboat })` returning:
  - `listAll() => [{ id, name, entry, kind, mode, backend, created, updated }]` merged across backends newest-first (`backend` is `'local' | 'rowboat'`; `getRowboat()` null means local only).
  - `createProject(name, { entry = 'main.js', files = { [entry]: '' }, mode = 'local' }) => { id, entry, kind }`.
  - `renameProject(id, name)`.
  - `readForSwitch(id) => { project, files }` from the owning backend.
  - `mergeDrop(id, entries, { readDir, readAsText }) => { added: [paths] }` walking dropped entries, prefixing the top folder name, writing with message `drop <folder>`.
  - `createFromDrop(entries, { readDir, readAsText }) => { id, name, entry }` naming for the folder (entry: `index.js`, `index.ts`, `<folder>.js`, `<folder>.ts`, else first `.js` alpha), writing local.
  - `listVersions(id)`, `restoreVersion(id, versionId) => { files, entry }` reading the snapshot and writing it back with message `restore <first-8-of-versionId>`.
  - `flipMode(id) => 'local' | 'rowboat'` copying current files to the other backend with message `mode to <mode>`; throws `rowboat unavailable` when flipping to rowboat with no store.
  - `getMode(id) => Promise<'local' | 'rowboat'>`, `peekMode(id) => 'local' | 'rowboat'` (sync map read for the session's `getBackend`, seeded by `listAll`).

- [ ] **Step 1: Write the failing manager test**

Create `apps/jscad-web/test/storage-projects.test.js`:

```js
// Project manager over two fake backends: the second local instance stands
// in for the rowboat store, so no test needs a live server.
import { describe, expect, it } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'

const stores = () => {
  const local = createLocalStorage()
  const rowboat = createLocalStorage()
  return { manager: createProjectManager({ local, getRowboat: () => rowboat }), local, rowboat }
}

describe('project manager', () => {
  it('creates a local project and lists it', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('Gear', { entry: 'main.js', files: { 'main.js': 'v1' } })
    const all = await manager.listAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id, name: 'Gear', mode: 'local', backend: 'local' })
  })

  it('renames without touching files', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('Old', { files: { 'main.js': 'v1' } })
    await manager.renameProject(id, 'New')
    expect((await manager.readForSwitch(id)).project.name).toBe('New')
    expect((await manager.readForSwitch(id)).files).toEqual({ 'main.js': 'v1' })
  })

  it('restores a version as a new row and keeps history', async () => {
    const local = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => null })
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' }, entry: 'main.js' })
    await local.writeFiles(id, { 'main.js': 'v2' }, { message: 'two' })
    const [latest, first] = await manager.listVersions(id)
    const restored = await manager.restoreVersion(id, first.versionId)
    expect(restored.files).toEqual({ 'main.js': 'v1' })
    expect(await manager.listVersions(id)).toHaveLength(3)
  })

  it('flips mode by copying current files, leaving old rows behind', async () => {
    const { manager, local, rowboat } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    expect(await manager.flipMode(id)).toBe('rowboat')
    expect((await rowboat.readProject(id)).files).toEqual({ 'main.js': 'v1' })
    expect((await local.listVersions(id))).toHaveLength(1)
    expect(await manager.flipMode(id)).toBe('local')
    expect(manager.getMode(id)).toBe('local')
  })

  it('merges a dropped folder as a subfolder', async () => {
    const { manager } = stores()
    const { id } = await manager.createProject('P', { files: { 'main.js': 'v1' } })
    const entries = [
      { name: 'parts', isDirectory: true, kids: [{ name: 'gear.js', isDirectory: false, text: 'gear' }] },
    ]
    const readDir = async (dir) => dir.kids
    const readAsText = async (f) => f.text
    const { added } = await manager.mergeDrop(id, entries, { readDir, readAsText })
    expect(added).toEqual(['parts/gear.js'])
    expect((await manager.readForSwitch(id)).files['parts/gear.js']).toBe('gear')
  })

  it('creates a project from a dropped folder, detecting the entry', async () => {
    const { manager } = stores()
    const entries = [
      { name: 'car', isDirectory: true, kids: [{ name: 'index.js', isDirectory: false, text: 'car' }] },
    ]
    const readDir = async (dir) => dir.kids
    const readAsText = async (f) => f.text
    const created = await manager.createFromDrop(entries, { readDir, readAsText })
    expect(created.name).toBe('car')
    expect(created.entry).toBe('car/index.js')
  })
})
```

Run: `cd apps/jscad-web && npx vitest run test/storage-projects.test.js`
Expected: FAIL with "Cannot find module '../src/storage/projects.js'".

- [ ] **Step 2: Implement the manager**

Create `apps/jscad-web/src/storage/projects.js`. Routing is explicit: a
session-side `modes` Map is authoritative, seeded from rows by `listAll`
(flip/create wins over rows within a session), because after a flip both
backends hold a row and existence alone cannot route. `peekMode` exposes the
map synchronously for the session's `getBackend`; `flipMode` passes
`mode: toMode` so fresh creates land correctly in either backend (updates
preserve the row's existing mode, which is already correct on both sides):

```js
import { kindFromEntry } from './local.js'

export { kindFromEntry }

const shortId = (versionId) => versionId.slice(0, 8)

const walkFiles = async (entries, readDir, readAsText, prefix, out) => {
  for (const entry of entries) {
    if (entry.isDirectory) {
      await walkFiles(await readDir(entry), readDir, readAsText, `${prefix}${entry.name}/`, out)
    } else {
      out[`${prefix}${entry.name}`] = await readAsText(entry)
    }
  }
  return out
}

const namespaceDrop = async (entries, readDir, readAsText) => {
  const singleDir = entries.length === 1 && entries[0].isDirectory
  const folder = singleDir ? entries[0].name : 'drop'
  const roots = singleDir ? await readDir(entries[0]) : entries
  const files = await walkFiles(roots, readDir, readAsText, `${folder}/`, {})
  if (Object.keys(files).length === 0) throw new Error('empty drop')
  return { folder, files }
}

const detectEntry = (paths, folder) => {
  const candidates = ['index.js', 'index.ts', `${folder}.js`, `${folder}.ts`]
  for (const candidate of candidates) {
    if (paths.includes(candidate)) return candidate
  }
  return [...paths].sort().find((p) => p.endsWith('.js')) ?? paths[0]
}

export function createProjectManager({ local, getRowboat }) {
  const modes = new Map()
  const rowboat = () => getRowboat?.() ?? null
  const storeFor = (mode) => (mode === 'rowboat' && rowboat() ? rowboat() : local)

  const remember = (id, mode) => {
    modes.set(id, mode)
    return mode
  }

  const modeOf = async (id) => {
    if (modes.has(id)) return modes.get(id)
    if (rowboat()) {
      try {
        const row = await rowboat().readProject(id)
        return remember(id, row.mode)
      } catch { /* fall through to local */ }
    }
    const row = await local.readProject(id)
    return remember(id, row.mode)
  }

  const ownerOf = async (id) => storeFor(await modeOf(id))

  const listAll = async () => {
    const all = (await local.listProjects()).map((p) => ({ ...p, backend: 'local' }))
    if (rowboat()) {
      for (const p of await rowboat().listProjects()) all.push({ ...p, backend: 'rowboat' })
    }
    for (const p of all) {
      if (!modes.has(p.id)) modes.set(p.id, p.mode)
    }
    all.sort((a, b) => b.updated - a.updated)
    return all
  }

  const createProject = async (name, options = {}) => {
    const { entry = 'main.js', files = { [entry]: '' }, mode = 'local' } = options
    const id = crypto.randomUUID()
    const store = storeFor(mode)
    if (mode === 'rowboat' && store === local) throw new Error('rowboat unavailable')
    const written = await store.writeFiles(id, files, { message: 'create', name, entry, mode })
    remember(id, mode)
    return { id, ...written }
  }

  const renameProject = async (id, name) => {
    const store = await ownerOf(id)
    const project = await store.readProject(id)
    await store.writeFiles(id, project.files, { message: 'rename', name, entry: project.entry })
  }

  const readForSwitch = async (id) => {
    const project = await (await ownerOf(id)).readProject(id)
    return { project, files: project.files }
  }

  const mergeDrop = async (id, entries, fns) => {
    const { folder, files: dropped } = await namespaceDrop(entries, fns.readDir, fns.readAsText)
    const store = await ownerOf(id)
    const project = await store.readProject(id)
    const files = { ...project.files, ...dropped }
    await store.writeFiles(id, files, { message: `drop ${folder}`, entry: project.entry })
    return { added: Object.keys(dropped) }
  }

  const createFromDrop = async (entries, fns) => {
    const { folder, files } = await namespaceDrop(entries, fns.readDir, fns.readAsText)
    const paths = Object.keys(files).map((p) => p.replace(`${folder}/`, ''))
    const entry = `${folder}/${detectEntry(paths, folder)}`
    const created = await createProject(folder, { entry, files })
    return { ...created, name: folder, entry }
  }

  const listVersions = async (id) => (await ownerOf(id)).listVersions(id)

  const restoreVersion = async (id, versionId) => {
    const store = await ownerOf(id)
    const { files, entry } = await store.readVersion(id, versionId)
    await store.writeFiles(id, files, { message: `restore ${shortId(versionId)}`, entry })
    return { files, entry }
  }

  const flipMode = async (id) => {
    const from = await ownerOf(id)
    const project = await from.readProject(id)
    const toMode = project.mode === 'rowboat' ? 'local' : 'rowboat'
    const to = storeFor(toMode)
    if (to === from) throw new Error('rowboat unavailable')
    await to.writeFiles(id, project.files, { message: `mode to ${toMode}`, name: project.name, entry: project.entry, mode: toMode })
    return remember(id, toMode)
  }

  const getMode = (id) => modeOf(id)
  const peekMode = (id) => modes.get(id) ?? 'local'

  return { listAll, createProject, renameProject, readForSwitch, mergeDrop, createFromDrop, listVersions, restoreVersion, flipMode, getMode, peekMode }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd apps/jscad-web && npx vitest run test/storage-projects.test.js`
Expected: PASS (6 tests).

- [ ] **Step 4: Lint and commit**

Run: `cd apps/jscad-web && npx eslint src/storage/projects.js test/storage-projects.test.js && echo LINT_OK`
Expected: LINT_OK.

```bash
git add apps/jscad-web/src/storage/projects.js apps/jscad-web/test/storage-projects.test.js
git commit -m "feat(jscad-web): project manager over the storage interface"
```

---

### Task 2: Drawer markup, stacked tabs, project list UI

**Files:**
- Modify: `apps/jscad-web/static/index.html:82-104` (drawer markup)
- Modify: `apps/jscad-web/static/main.css` (`#ai-drawer` block ~858-900, `#editor-toggle` ~300-328)
- Create: `apps/jscad-web/src/projects.js`
- Create: `apps/jscad-web/test/projects-ui.test.js`
- Read for reference: `apps/jscad-web/src/aiChat.js:15-45` (element helpers, init pattern), `apps/jscad-web/src/aiAccount.js:67-104` (panel wiring)

**Interfaces:**
- Consumes: Task 1's manager (`listAll`, `createProject`, `renameProject`).
- Produces: `initProjects({ container, manager, onSwitch, onDropOnProject, readBuffer })` rendering the project list; each row is a drop target (`data-project-id`, dragover/drop listeners) with a rename button (`prompt()`, manager `renameProject`, re-render); new-project button seeds files from `readBuffer() => ({ code, path })`. Emits no storage writes itself except through the manager.

- [ ] **Step 1: Write the failing UI test**

Create `apps/jscad-web/test/projects-ui.test.js` (jsdom):

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { initProjects } from '../src/projects.js'

const setup = async () => {
  document.body.innerHTML = '<div id="panel"></div>'
  const local = createLocalStorage()
  const manager = createProjectManager({ local, getRowboat: () => null })
  await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
  const onSwitch = vi.fn()
  initProjects({ container: document.getElementById('panel'), manager, onSwitch, readBuffer: () => ({ code: 'buf', path: 'main.js' }) })
  return { manager, onSwitch }
}

describe('project panel', () => {
  it('lists projects with a drop-target row per project', async () => {
    await setup()
    await vi.waitFor(() => expect(document.querySelector('[data-project-id]')).not.toBeNull())
    expect(document.querySelector('.project-row').textContent).toMatch(/Gear/)
  })

  it('calls onSwitch with the project id on row click', async () => {
    const { onSwitch } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-open')).not.toBeNull())
    document.querySelector('.project-open').click()
    expect(onSwitch).toHaveBeenCalledWith(expect.any(String))
  })

  it('creates a project from the new button, seeded from the buffer', async () => {
    const { manager } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
    document.querySelector('.project-new').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.project-row')).toHaveLength(2))
    expect(await manager.listAll()).toHaveLength(2)
    const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
    expect((await manager.readForSwitch(created.id)).files).toEqual({ 'main.js': 'buf' })
  })

  it('renames a project from its row button', async () => {
    const { manager } = await setup()
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed'))
    await vi.waitFor(() => expect(document.querySelector('.project-rename')).not.toBeNull())
    document.querySelector('.project-rename').click()
    await vi.waitFor(() => expect(document.querySelector('.project-row').textContent).toMatch(/Renamed/))
    const [project] = await manager.listAll()
    expect(project.name).toBe('Renamed')
    vi.unstubAllGlobals()
  })
})
```

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js`
Expected: FAIL with "Cannot find module '../src/projects.js'".

- [ ] **Step 2: Add drawer markup and stacked-tab CSS**

In `apps/jscad-web/static/index.html` after the `#editor` div (line ~93), add:

```html
      <div id="project-drawer" class="closed">
        <div id="project-toggle" title="Projects"></div>
        <div id="project-drawer-body">
          <div id="project-list"></div>
          <div id="project-versions"></div>
        </div>
      </div>
```

In `apps/jscad-web/static/main.css`, after the `#ai-drawer` block, add the project drawer mirroring it (fixed right, 360px, translateX toggle, `#project-toggle` tab styled like `#ai-toggle`). Then restack all three tabs so none share `top: 50%`:

```css
#editor-toggle { top: 50%; }
#project-toggle { top: calc(50% - 110px); }
#ai-toggle { top: calc(50% + 110px); }
```

replacing the `top: 50%` in the existing `#editor-toggle` (~line 306) and `#ai-toggle` rules. Tab height is 90px; 110px spacing leaves a 20px gap.

- [ ] **Step 3: Implement the panel list**

Create `apps/jscad-web/src/projects.js`:

```js
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * @param {{container:HTMLElement,manager:{listAll:Function,createProject:Function,renameProject:Function},onSwitch:Function,onDropOnProject:Function,readBuffer?:Function}} options
 */
export const initProjects = ({ container, manager, onSwitch, onDropOnProject, readBuffer = () => ({ code: '', path: 'main.js' }) }) => {
  const header = el('div', 'project-header', 'Projects')
  const newBtn = el('button', 'project-new', 'New')
  newBtn.type = 'button'
  header.append(newBtn)
  const list = el('div', 'project-rows')
  container.append(header, list)

  const render = async () => {
    const projects = await manager.listAll().catch(() => [])
    list.innerHTML = ''
    for (const p of projects) {
      const row = el('div', 'project-row')
      row.dataset.projectId = p.id
      const label = el('button', 'project-open', `${p.name} (${p.mode})`)
      label.type = 'button'
      label.addEventListener('click', () => onSwitch(p.id))
      const rename = el('button', 'project-rename', 'Rename')
      rename.type = 'button'
      rename.addEventListener('click', async (ev) => {
        ev.stopPropagation()
        const name = prompt('Project name', p.name)
        if (!name || name === p.name) return
        await manager.renameProject(p.id, name)
        render()
      })
      row.append(label, rename)
      row.addEventListener('dragover', (ev) => ev.preventDefault())
      row.addEventListener('drop', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        onDropOnProject?.(p.id, ev.dataTransfer)
      })
      list.append(row)
    }
  }

  newBtn.addEventListener('click', async () => {
    const { code, path } = readBuffer()
    await manager.createProject('Untitled', { entry: path, files: { [path]: code } })
    render()
  })

  render()
  return { render }
}
```

- [ ] **Step 4: Run UI tests plus lint**

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js && npx eslint src/projects.js test/projects-ui.test.js && echo LINT_OK`
Expected: PASS (4 tests), LINT_OK.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/static/index.html apps/jscad-web/static/main.css apps/jscad-web/src/projects.js apps/jscad-web/test/projects-ui.test.js
git commit -m "feat(jscad-web): project drawer with stacked tabs and list"
```

---

### Task 3: Version history and restore

**Files:**
- Modify: `apps/jscad-web/src/projects.js`
- Modify: `apps/jscad-web/test/projects-ui.test.js`
- Read for reference: `apps/jscad-web/src/storage/projects.js` (Task 1 `listVersions`, `restoreVersion`)

**Interfaces:**
- Consumes: Task 1's `listVersions`, `restoreVersion`, `readForSwitch`; Task 2's `initProjects`.
- Produces: extended `initProjects({ container, manager, onSwitch, onDropOnProject, onRestore, onError, readBuffer })` rendering `#project-versions` for the selected project; Restore writes a new row (`restore <short-id>`) and calls `onRestore(id)` so main.js reloads through the switch path; restore failures go to `onError` (main.js passes `setError`).

- [ ] **Step 1: Extend the UI test with versions**

Rewrite `apps/jscad-web/test/projects-ui.test.js` in full: `setup` returns
`{ manager, local, onSwitch, onRestore, panel }`, passes `readBuffer`, and
wraps `onSwitch` so it also selects. Complete replacement file:

```js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createLocalStorage } from '../src/storage/local.js'
import { createProjectManager } from '../src/storage/projects.js'
import { initProjects } from '../src/projects.js'

const setup = async () => {
  document.body.innerHTML = '<div id="panel"></div>'
  const local = createLocalStorage()
  const manager = createProjectManager({ local, getRowboat: () => null })
  await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
  const onSwitch = vi.fn()
  const onRestore = vi.fn()
  const panel = initProjects({
    container: document.getElementById('panel'),
    manager,
    onSwitch: async (id) => { onSwitch(id); await panel.select(id) },
    onRestore,
    onError: (err) => { throw err },
    readBuffer: () => ({ code: 'buf', path: 'main.js' }),
  })
  return { manager, local, onSwitch, onRestore, panel }
}

describe('project panel', () => {
  it('lists projects with a drop-target row per project', async () => {
    await setup()
    await vi.waitFor(() => expect(document.querySelector('[data-project-id]')).not.toBeNull())
    expect(document.querySelector('.project-row').textContent).toMatch(/Gear/)
  })

  it('calls onSwitch with the project id on row click', async () => {
    const { onSwitch } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-open')).not.toBeNull())
    document.querySelector('.project-open').click()
    expect(onSwitch).toHaveBeenCalledWith(expect.any(String))
  })

  it('creates a project from the new button, seeded from the buffer', async () => {
    const { manager } = await setup()
    await vi.waitFor(() => expect(document.querySelector('.project-new')).not.toBeNull())
    document.querySelector('.project-new').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.project-row')).toHaveLength(2))
    expect(await manager.listAll()).toHaveLength(2)
    const created = (await manager.listAll()).find((p) => p.name === 'Untitled')
    expect((await manager.readForSwitch(created.id)).files).toEqual({ 'main.js': 'buf' })
  })

  it('renames a project from its row button', async () => {
    const { manager } = await setup()
    vi.stubGlobal('prompt', vi.fn(() => 'Renamed'))
    await vi.waitFor(() => expect(document.querySelector('.project-rename')).not.toBeNull())
    document.querySelector('.project-rename').click()
    await vi.waitFor(() => expect(document.querySelector('.project-row').textContent).toMatch(/Renamed/))
    const [project] = await manager.listAll()
    expect(project.name).toBe('Renamed')
    vi.unstubAllGlobals()
  })
})

describe('version history', () => {
  it('lists versions newest-first with a restore button per row', async () => {
    const { manager, panel } = await setup()
    const [project] = await manager.listAll()
    await panel.select(project.id)
    await vi.waitFor(() => expect(document.querySelectorAll('.version-row').length).toBeGreaterThan(0))
    expect(document.querySelector('.version-row').textContent).toMatch(/create/)
  })

  it('restore writes a new row and calls onRestore', async () => {
    const { manager, local, panel, onRestore } = await setup()
    const [project] = await manager.listAll()
    await local.writeFiles(project.id, { 'main.js': 'v2' }, { message: 'two' })
    await panel.select(project.id)
    await vi.waitFor(() => expect(document.querySelectorAll('.version-row')).toHaveLength(2))
    document.querySelector('.version-restore').click()
    await vi.waitFor(() => expect(onRestore).toHaveBeenCalledWith(project.id))
    expect(await manager.listVersions(project.id)).toHaveLength(3)
  })
})
```

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js`
Expected: FAIL — `panel.select is not a function` (and no `.version-row` elements).

- [ ] **Step 2: Implement versions in the panel**

Extend `apps/jscad-web/src/projects.js`: `initProjects` takes `onRestore`, tracks `selectedId` (first project by default after first render), renders `#project-versions` from `manager.listVersions(selectedId)` newest-first as `.version-row` elements (timestamp + message + `.version-restore` button). Restore click: `await manager.restoreVersion(selectedId, versionId)`, re-render versions, call `onRestore(selectedId)`. Expose `select(id)` (sets selection, re-renders versions, returns the promise) and keep returning `{ render, select }`. Row click still calls `onSwitch(id)`; main.js (Task 5) calls `panel.select(id)` after switching.

Full replacement of `src/projects.js` is expected here; keep the Task 2 helpers (`el`, header, rows, drop listeners) unchanged and add:

```js
export const initProjects = ({ container, manager, onSwitch, onDropOnProject, onRestore, onError = () => {}, readBuffer = () => ({ code: '', path: 'main.js' }) }) => {
  ...header/list as in Task 2...
  const versionsEl = el('div', 'project-versions')
  container.append(header, list, versionsEl)
  let selectedId = null

  const renderVersions = async () => {
    versionsEl.innerHTML = ''
    if (!selectedId) return
    const versions = await manager.listVersions(selectedId).catch(() => [])
    for (const v of versions) {
      const row = el('div', 'version-row', `${new Date(v.created).toLocaleString()} — ${v.message}`)
      const btn = el('button', 'version-restore', 'Restore')
      btn.type = 'button'
      btn.addEventListener('click', async () => {
        try {
          await manager.restoreVersion(selectedId, v.versionId)
          renderVersions()
          onRestore?.(selectedId)
        } catch (err) {
          onError(err)
        }
      })
      row.append(btn)
      versionsEl.append(row)
    }
  }

  const select = async (id) => {
    selectedId = id
    await renderVersions()
  }

  const render = async () => {
    ...Task 2 row loop, plus after building rows:
    if (!selectedId) {
      const first = list.querySelector('.project-row')
      if (first) await select(first.dataset.projectId)
    } else {
      await renderVersions()
    }
  }
  ...
  return { render, select }
}
```

- [ ] **Step 3: Run tests and lint**

Run: `cd apps/jscad-web && npx vitest run test/projects-ui.test.js test/storage-projects.test.js && npx eslint src/projects.js test/projects-ui.test.js && echo LINT_OK`
Expected: PASS (4 + 2 + 6 manager tests), LINT_OK.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/src/projects.js apps/jscad-web/test/projects-ui.test.js
git commit -m "feat(jscad-web): version history with append-only restore"
```

---

### Task 4: Mode toggle, session rowboat attach, chat project getter

**Files:**
- Modify: `apps/jscad-web/src/storage/session.js`
- Modify: `apps/jscad-web/test/storage-session.test.js`
- Modify: `apps/jscad-web/src/projects.js`
- Modify: `apps/jscad-web/test/projects-ui.test.js`
- Modify: `apps/jscad-web/src/aiChat.js:25-30` (`initChat` options + `persistTranscript` guard)
- Read for reference: `apps/jscad-web/src/storage/session.js` (current `createSession`), `apps/jscad-web/src/aiChat.js:40-60` (transcript + persist)

**Interfaces:**
- Consumes: Task 1's `flipMode`, `peekMode`... `peekMode` was specified in Task 1's plan text but the code block's return omits it. Add it here instead: extend the manager return with `peekMode` now (one-line addition, covered by the new flip test below).
- Produces:
  - `createSession({ local, getRowboat, getBackend })` where `getRowboat: () => store | null` replaces the fixed `rowboat` field, and `getBackend(projectId, path)` replaces `getBackend(path)`. Old callers passing `rowboat` or single-arg `getBackend` keep working: a passed `rowboat` is wrapped as `() => rowboat`, extra args are ignored by old callbacks.
  - Panel mode toggle per selected project, disabled when `canUseRowboat` is false.
  - `initChat` `projectId` accepts a string or a `() => string` getter, resolved at each read/write.

- [ ] **Step 1: Extend the session**

In `apps/jscad-web/src/storage/session.js`, replace the factory head:

```js
export function createSession({ local, rowboat, getRowboat, getBackend }) {
  const resolveRowboat = getRowboat ?? (() => rowboat ?? null)
  const backendFor = (projectId, path) =>
    getBackend?.(projectId, path) === 'rowboat' && resolveRowboat() ? resolveRowboat() : local
```

and thread `projectId` through `readThrough`/`writeThrough` into `backendFor`. Existing tests (`getBackend: () => 'local'`, `rowboat` object or null) pass unchanged — assert that by running them before adding new cases.

- [ ] **Step 2: Add session attach + toggle tests**

Append to `apps/jscad-web/test/storage-session.test.js`:

```js
describe('rowboat attach and per-project modes', () => {
  it('routes to rowboat once attached and the mode says so', async () => {
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    let attached = null
    const modes = new Map([['p1', 'local']])
    const session = createSession({
      local,
      getRowboat: () => attached,
      getBackend: (projectId) => modes.get(projectId) ?? 'local',
    })
    await session.writeThrough('p1', 'main.js', 'v1', { entry: 'main.js' })
    expect((await local.readProject('p1')).files['main.js']).toBe('v1')
    attached = rowboat
    modes.set('p1', 'rowboat')
    await session.writeThrough('p1', 'main.js', 'v2', { entry: 'main.js' })
    expect((await rowboat.readProject('p1')).files['main.js']).toBe('v2')
  })
})
```

Append to `apps/jscad-web/test/projects-ui.test.js` a mode-toggle describe block. It needs a rowboat store and an `onFlip`/`canUseRowboat` hook — which do not exist yet, so write the test against the final panel API:

```js
describe('mode toggle', () => {
  it('flips the selected project and disables when rowboat is unavailable', async () => {
    document.body.innerHTML = '<div id="panel"></div>'
    const local = createLocalStorage()
    const rowboat = createLocalStorage()
    const manager = createProjectManager({ local, getRowboat: () => rowboat })
    const { id } = await manager.createProject('Gear', { files: { 'main.js': 'v1' } })
    const onFlip = vi.fn()
    initProjects({
      container: document.getElementById('panel'),
      manager,
      onSwitch: async () => {},
      canUseRowboat: true,
      onFlip,
    })
    await vi.waitFor(() => expect(document.querySelector('.mode-toggle')).not.toBeNull())
    document.querySelector('.mode-toggle').click()
    await vi.waitFor(() => expect(onFlip).toHaveBeenCalledWith(id, 'rowboat'))
    expect(manager.peekMode(id)).toBe('rowboat')
  })
})
```

This requires manager `peekMode` (add: `const peekMode = (id) => modes.get(id) ?? 'local'`, include in return) and panel `canUseRowboat`/`onFlip` props. The toggle auto-selects the first project (selection defaults from Task 3 render).

Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js test/projects-ui.test.js`
Expected: FAIL — `manager.peekMode is not a function`, no `.mode-toggle` element.

- [ ] **Step 3: Implement toggle, peekMode, chat getter**

  - `apps/jscad-web/src/storage/projects.js`: add `peekMode` plus return entry.
  - `apps/jscad-web/src/projects.js`: header gains `.mode-toggle` button showing the selected project's mode; click disables the button, calls `manager.flipMode(selectedId)`, then `onFlip?.(selectedId, mode)` and re-renders, re-enabling in a `finally`. Flip failure goes to `onError` and leaves the mode unchanged. When `canUseRowboat` is false the button disables with `title="Sign in to use rowboat mode"`.
  - `apps/jscad-web/src/aiChat.js`: resolve `projectId` at use time — `const pid = () => (typeof projectId === 'function' ? projectId() : projectId)` — and use `pid()` in `persistTranscript` and the resume block. Existing string callers (including the current test) behave identically.

- [ ] **Step 4: Run tests and lint**

Run: `cd apps/jscad-web && npx vitest run test/storage-session.test.js test/projects-ui.test.js test/storage-projects.test.js test/aiChat.test.js && npx eslint src/storage/session.js src/storage/projects.js src/projects.js src/aiChat.js test/storage-session.test.js test/projects-ui.test.js && echo LINT_OK`
Expected: PASS, LINT_OK.

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/storage/session.js apps/jscad-web/src/storage/projects.js apps/jscad-web/src/projects.js apps/jscad-web/src/aiChat.js apps/jscad-web/test/storage-session.test.js apps/jscad-web/test/projects-ui.test.js
git commit -m "feat(jscad-web): mode toggle, session rowboat attach, chat project getter"
```

---

### Task 5: main.js switching, drop branching, smoke, docs

**Files:**
- Modify: `apps/jscad-web/main.js` (imports, `currentProjectId`, session wiring, `switchProject`, drop handler, chat storage, merge)
- Create: `apps/jscad-web/e2e/project-ui.spec.js`
- Modify: `apps/jscad-web/README.md` (Storage section: project UI paragraph)
- Read for reference: `apps/jscad-web/main.js` (`storageSession`, `recordEdit`, `getRowboatStore`, `jscadScript` merge, `initChat`, `setupDragDrop`), `apps/jscad-web/src/fileSystem.js:145-160` (`handleFileDrop`)

**Interfaces:**
- Consumes: Tasks 1–4 (manager, panel, toggle, chat getter).
- Produces: switchable `currentProjectId`; `switchProject(id)`; drop branch (project row vs body); chat bound to the live project; Playwright smoke; README paragraph.

- [ ] **Step 1: Rewire main.js to the manager**

  - Imports (leaf only): add `createProjectManager` from `./src/storage/projects.js` and `initProjects` from `./src/projects.js`; add `extractEntries` from `@jscadui/fs-provider`.
  - Replace `const currentProjectId = 'default'` with `let currentProjectId = 'default'`.
  - Build `const projectManager = createProjectManager({ local: localStore, getRowboat: () => rowboatStore })` where `rowboatStore` is the resolved value cached beside `rowboatStorePromise` (set it inside `getRowboatStore` before returning).
  - Replace the session construction with `createSession({ local: localStore, getRowboat: () => rowboatStore, getBackend: (projectId) => projectManager.peekMode(projectId) })`.
  - Add `switchProject(id)` after the session block:

```js
const toEditorFiles = (files) =>
  Object.entries(files).map(([path, content]) =>
    Object.assign(new File([content], path.split('/').pop()), { fullPath: `/${path}` }),
  )

const switchProject = async (id) => {
  const { project, files } = await projectManager.readForSwitch(id)
  currentProjectId = id
  workerApi.jscadClearTempCache()
  for (const [path, content] of Object.entries(files)) {
    await fileSystem.addToCacheWrapper(path, content)
  }
  editor.setFiles(toEditorFiles(files))
  editor.setSource(files[project.entry] ?? '', project.entry)
  jscadScript({ script: files[project.entry] ?? '', url: project.entry, base: currentBase })
}
```

`File` objects keep editor clicks working: `readAsText` reads Blobs via FileReader, and `fullPath` feeds the file buttons. `currentBase` is the module-level base already tracked in `jscadScript`.

  - Chat: change `projectId: currentProjectId` to `projectId: () => currentProjectId` in the `initChat` call.
  - Panel boot (after `editor.init`, before menu init): mount into `#project-list`, wire `onSwitch: (id) => switchProject(id).catch(setError)`, `onDropOnProject` (below), `onRestore: (id) => switchProject(id).catch(setError)`, `onError: setError`, `onFlip` (re-render panel; flip needs no recompile, files are identical bytes), `readBuffer: () => ({ code: editor.getSource(), path: 'main.js' })`, `canUseRowboat: (await getRowboatStore()) !== null`. Toggle for `#project-toggle` mirrors the AI drawer toggle (`classList.toggle('closed')`). Seed modes at boot with `await projectManager.listAll()` before first render.
  - Drop branch: replace the `setupDragDrop` callback with:

```js
fileSystem.setupDragDrop(dropModal, async (dataTransfer, target) => { ... })
```

`setupDragDrop` calls `onDrop(ev.dataTransfer)` without the target. Change `src/fileSystem.js` `setupDragDrop` to pass the event target: `await onDrop(ev.dataTransfer, ev.target)`. Then in main.js:

```js
fileSystem.setupDragDrop(dropModal, async (dataTransfer, target) => {
  const row = target?.closest?.('[data-project-id]')
  if (row) {
    const entries = await extractEntries(dataTransfer)
    await projectManager.mergeDrop(row.dataset.projectId, entries, { readDir, readAsText }).catch(setError)
    if (row.dataset.projectId === currentProjectId) await switchProject(currentProjectId).catch(setError)
    return
  }
  await fileSystem.handleFileDrop(dataTransfer, fsDeps)
  const entries = await extractEntries(dataTransfer)
  if (entries.length === 1 && entries[0].isDirectory) {
    const created = await projectManager.createFromDrop(entries, { readDir, readAsText }).catch(setError)
    if (created) await switchProject(created.id).catch(setError)
  }
  // Single-script drops need no extra call: the next compile records the
  // version through the existing recordEdit path.
})
```

Static `extractEntries`/`readDir`/`readAsText` imports at the top of main.js (`@jscadui/fs-provider` has no zod types, so the TS 4.9 gate stays green — verify with `npx tsc --noEmit` in `apps/jscad-web`).

  - Boot seed (before panel boot): the smoke test needs a project with a version at first load, and a fresh browser has neither. Seed once:

```js
if ((await projectManager.listAll()).length === 0) {
  await projectManager.createProject('default', { entry: 'main.js', files: { 'main.js': defaultCode } })
}
```

`defaultCode` is already imported in main.js. This also adopts anonymous content per the spec (the buffer is the default model on a fresh profile).

- [ ] **Step 2: Write the Playwright smoke**

Create `apps/jscad-web/e2e/project-ui.spec.js`, following `e2e/app.spec.js` (helpers `dismissWelcome`, `waitForRender`):

```js
import { test, expect } from '@playwright/test'
import { dismissWelcome, waitForRender } from './helpers.js'

test.describe('project drawer', () => {
  test('opens, lists the default project, and restores a version', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    await waitForRender(page)
    await page.locator('#project-toggle').click()
    await expect(page.locator('#project-drawer:not(.closed)')).toBeVisible()
    await expect(page.locator('.project-row').first()).toContainText(/default|Untitled|Gear/i)
    const rows = await page.locator('.version-row').count()
    expect(rows).toBeGreaterThan(0)
  })

  test('drawer tabs do not overlap', async ({ page }) => {
    await page.goto('/')
    await dismissWelcome(page)
    const tabs = await Promise.all(
      ['#editor-toggle', '#project-toggle', '#ai-toggle'].map(async (sel) => {
        const box = await page.locator(sel).boundingBox()
        return { sel, top: box.y, bottom: box.y + box.height }
      }),
    )
    const sorted = [...tabs].sort((a, b) => a.top - b.top)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].top).toBeGreaterThanOrEqual(sorted[i - 1].bottom)
    }
  })
})
```

The version-row assertion relies on the boot compile having versioned `default` (Task 5 of the storage plan records every compile). If the drawer starts closed, `#project-toggle` must still be visible — it is, tabs sit outside the translated panel.

Run: `cd apps/jscad-web && npx playwright test e2e/project-ui.spec.js`
Expected: PASS. (Playwright needs built assets + service worker; run `npm run build` first if the spec fails to load, matching how `e2e/app.spec.js` runs in CI.)

- [ ] **Step 3: Docs, full suite, gates**

  - Append to the Storage section in `apps/jscad-web/README.md`:

```md
The Projects drawer lists projects across both backends, with per-project
version history (restore appends a new row) and a local/rowboat mode toggle
(rowboat needs sign-in). Dropping files onto a project row merges them as a
subfolder; dropping onto the page creates a project. Drawer tabs stack
vertically so the editor, project, and AI panels stay reachable together.
```

  - Run: `cd apps/jscad-web && npx vitest run 2>&1 | tail -4` — Expected: all pass.
  - Run: `cd apps/jscad-web && npx tsc --noEmit && npx eslint main.js src/projects.js src/fileSystem.js && echo GATES_OK` — Expected: GATES_OK (static fs-provider imports keep the TS 4.9 gate green).
  - Root: `cd /home/john/src/jscadui && npx tsc --noEmit && echo ROOT_OK` — Expected: ROOT_OK.

- [ ] **Step 4: Commit**

```bash
git add apps/jscad-web/main.js apps/jscad-web/src/fileSystem.js apps/jscad-web/e2e/project-ui.spec.js apps/jscad-web/README.md
git commit -m "feat(jscad-web): project switching, drop branching, smoke"
```

---

## Order and checkpoints

Tasks 1–4 are sequential (manager → panel → versions → toggle). Task 5 needs all of them.

- After Task 2, the drawer opens with a live project list and all three tabs stay clickable. That is the moment to confirm the tab stacking in a real browser before building versions on top.
- After Task 5, anonymous editing versions into switchable local projects, sign-in enables rowboat mode and sync, and the smoke covers drawer-switch-restore. That is the moment for a browser pass plus prod deploy.
