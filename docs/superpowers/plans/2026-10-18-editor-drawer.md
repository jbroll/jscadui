# Editor Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the project drawer into the editor drawer: project dropdown, file tree, versions dropdown, and chunked version history.

**Architecture:** Storage first (coalescing primitives in a new `storage/versioning.js` + per-store support), then wiring (recordEdit coalescing, switch-away snapshots, chat excerpts), then UI (header module, tree module, versions dropdown replacing `projects.js`).

**Tech Stack:** Browser ESM, CodeMirror editor, IndexedDB/rowboat storage, vitest + jsdom, existing `storageSession`/`projectManager` seams.

**Spec:** `docs/superpowers/specs/2026-10-18-editor-drawer-design.md`

## Global Constraints

- ESM, no semicolons, single quotes, 2-space indent, JSDoc on exports.
- No relay/log changes; no server-side tool telemetry.
- Disk (Folder-mode) projects keep no versions; history lives in the directory's own git.
- Agent turns snapshot at most once per turn; restores always mint a new `restore <id>` row, never coalesce.
- Every navigation away from a dirty buffer reuses the existing discard confirm; no autosave.

## Review Focus

- Tree click on a dirty open file asks the discard confirm instead of switching silently (Task 4 test).
- Deleting the entry file or the last file is blocked with a message (Task 4 test).
- Folder-mode projects render the tree but the versions control is disabled with a reason (Task 4 + Task 5 tests).
- Switching away with content identical to the latest version mints no row (Task 1 test).
- `endTurn()` with no excerpt still snapshots message `'chat'` (Task 2 test).

---

### Task 1: Version chunking primitives

**Files:**
- Create: `apps/jscad-web/src/storage/versioning.js`
- Modify: `apps/jscad-web/src/storage/local.js`, `apps/jscad-web/src/storage/rowboat.js`, `apps/jscad-web/src/storage/session.js`, `apps/jscad-web/src/storage/disk.js`
- Test: `apps/jscad-web/test/storage-versioning.test.js` (new), `apps/jscad-web/test/storage-interface.test.js`, `apps/jscad-web/test/storage-rowboat.test.js`, `apps/jscad-web/test/storage-session.test.js`

**Model:** `sonnet` — multi-file coordination across three backends from prose.

**Interfaces:**
- Consumes: nothing new.
- Produces: `versioning.js` exports `EDIT_COALESCE_MS`, `excerptOf(text, max?)`, `chatVersionMessage(excerpt)`, `sameFiles(a, b)`; store option `{coalesceKey, coalesceMs}` on `writeFiles`; `snapshotUnique(id, options?) -> boolean` on session/local/rowboat (disk: no-op `false`).

- [ ] **Step 1: Write failing tests for `versioning.js` pure helpers**

```js
expect(excerptOf('  exhaust\npipes   at the rear  ')).toBe('exhaust pipes at the rear')
expect(excerptOf('x'.repeat(100))).toHaveLength(60)
expect(chatVersionMessage('exhaust pipes')).toBe('chat: exhaust pipes')
expect(chatVersionMessage('')).toBe('chat')
expect(sameFiles({ 'a.js': '1' }, { 'a.js': '1' })).toBe(true)
expect(sameFiles({ 'a.js': '1' }, { 'a.js': '2' })).toBe(false)
```

- [ ] **Step 2: Write failing store tests** — `storage-interface.test.js`: coalesced burst makes one row with latest content (fake timers); new row after window; different key always rows; a `restore …` message inside the window still mints its own row; identical content skips; `snapshotUnique` true then false. Mirror manifest-path cases in `storage-rowboat.test.js`; routing + disk no-op in `storage-session.test.js`.
- [ ] **Step 3: Run new tests to verify they fail**

Run: `npx vitest run test/storage-versioning.test.js test/storage-interface.test.js` in `apps/jscad-web`
Expected: FAIL (module/options do not exist)

- [ ] **Step 4: Implement `versioning.js`** — `EDIT_COALESCE_MS = 300000`; `excerptOf` collapses whitespace, trims, slices to 60; `chatVersionMessage` prefixes or falls back; `sameFiles` compares key sets then `===`.

- [ ] **Step 5: Implement coalescing in `local.js` `writeFiles`** — read `coalesceKey`/`coalesceMs` from options; latest row = `versions.get(id)?.[0]`; when `version` is true, a `coalesceKey` is set, the message does NOT start with `'restore '` (restores always mint their own row), keys match, and `ts - latest.created < coalesceMs`: identical files → skip row (project row still updates); else update latest row in place (`files`, `created: ts`, `message`, same `versionId`) and persist. Otherwise existing path, storing `coalesceKey` on the new row.

- [ ] **Step 6: Mirror Step 5 in `rowboat.js`** — compare manifests by `{path, hash}` pairs; update latest `versions` row in place via `db.update`.

- [ ] **Step 7: Implement `snapshotUnique`** — local/rowboat compare current files against latest version (skip when no versions → snapshot true); session routes by backend; disk returns `false`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/storage-versioning.test.js test/storage-interface.test.js test/storage-rowboat.test.js test/storage-session.test.js` in `apps/jscad-web`
Expected: PASS, no existing failures

- [ ] **Step 9: Commit**

```bash
git add apps/jscad-web/src/storage apps/jscad-web/test/storage-*.test.js
git commit -m "feat(web): coalesced version rows and snapshotUnique"
```

### Task 2: Wire chunking and chat excerpts

**Files:**
- Modify: `apps/jscad-web/main.js`, `apps/jscad-web/src/aiDeps.js`, `apps/jscad-web/src/aiChat.js`
- Test: `apps/jscad-web/test/aiDeps.test.js`

**Model:** `sonnet` — three-file coordination through untyped seams.

**Interfaces:**
- Consumes: Task 1 `versioning.js` (`EDIT_COALESCE_MS`, `excerptOf`, `chatVersionMessage`) and `session.snapshotUnique`.
- Produces: `endTurn(excerpt = '')` in `aiDeps.js`; `snapshot` dep shape `(projectId, excerpt)`; `recordEdit` passes `{message: 'edit', coalesceKey: 'edit', coalesceMs: EDIT_COALESCE_MS}`; project switch snapshots the previous project via `snapshotUnique({message: 'edit'})`.

- [ ] **Step 1: Write failing tests in `aiDeps.test.js`**

```js
await t.write({ path: 'main.js', content: 'v1' })
await t.endTurn('exhaust pipes at the rear')
expect((await local.listVersions('p1')).map((v) => v.message)).toEqual(['chat: exhaust pipes at the rear', 'create'])
await t.write({ path: 'main.js', content: 'v2' })
await t.endTurn()
expect((await local.listVersions('p1'))[0].message).toBe('chat')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/aiDeps.test.js` in `apps/jscad-web`
Expected: FAIL (endTurn ignores its argument)

- [ ] **Step 3: Implement `endTurn(excerpt = '')`** in `aiDeps.js` — snapshot each written project with `chatVersionMessage(excerptOf(excerpt))`; no-arg path keeps `'chat'`.

- [ ] **Step 4: Wire `main.js`** — `snapshot` dep becomes `(projectId, excerpt) => storageSession.snapshot(projectId, {message: chatVersionMessage(excerptOf(excerpt ?? ''))})`; `recordEdit` adds coalesce options; `switchProject`'s `onOpen` snapshots the previous project first via `snapshotUnique(prevProjectId, {message: 'edit'})` before opening the next.

- [ ] **Step 5: Wire `aiChat.js`** — turn-scoped `turnExcerpt` set from the turn's user message in `runTurnLocal`, consumed and cleared by `finishTurn` into `endTurn(turnExcerpt)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/aiDeps.test.js test/aiChat.test.js test/storage-session.test.js test/disk-project.test.js` in `apps/jscad-web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/main.js apps/jscad-web/src/aiDeps.js apps/jscad-web/src/aiChat.js apps/jscad-web/test/aiDeps.test.js
git commit -m "feat(web): chunked edit versions and chat excerpts"
```

### Task 3: Editor drawer header, project drawer removed

**Files:**
- Create: `apps/jscad-web/src/editorHeader.js`, `apps/jscad-web/src/syncEntry.js`
- Modify: `apps/jscad-web/static/index.html`, `apps/jscad-web/main.js`
- Delete: `apps/jscad-web/src/projects.js`
- Test: `apps/jscad-web/test/editor-header.test.js` (new)

**Model:** `sonnet` — DOM module design plus app rewiring from prose.

**Interfaces:**
- Consumes: manager `{listAll, createProject, renameProject, deleteProject, flipMode, peekMode, mergeDrop, listVersions, restoreVersion}`; `confirmDiscard`, `onSwitch`, `onRestore`, `onFileCreate` callbacks; `versioning.js` untouched; versions slot left empty for Task 5.
- Produces: `editorHeader.js` exports `initEditorHeader(container, deps)` returning `{render, select, setSyncStatus}`; `syncEntry.js` exports `mountSyncEntry(container, accountDeps)` rendering the shared `Sign in to Sync` control; `#project-drawer` removed, `#ai-drawer` no longer shares its column.

- [ ] **Step 1: Write failing tests in `test/editor-header.test.js`** (jsdom, mirroring `projects-ui.test.js` setup)

```js
// dropdown lists projects and switches on change
// New Project creates via manager and calls onSwitch with the new id
// New File writes { [name]: '' } to the current project and calls onFileCreate
// project rename/delete act on the current project only (delete asks confirm)
// switching with a dirty buffer asks the injected confirmDiscard first
// sync entry slot renders a node with text 'Sign in to Sync'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/editor-header.test.js` in `apps/jscad-web`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement `syncEntry.js`** — move the `Sign in to Sync` button + session line out of `aiAccount.js` (keep `initAccount` working against the shared renderer) so both drawer headers mount the identical control.

- [ ] **Step 4: Implement `editorHeader.js`** — project `<select>` (current project selected, `manager.listAll` rows; switching a dirty project goes through the injected `confirmDiscard` first, then `onSwitch`) New Project (same seed semantics as the old `project-new`: buffer code at buffer path), New File (prompt for name, `writeThrough` empty content, default `main.js` guard for empty names), rename/delete for the current project only (delete keeps the old confirm copy and disk-mode disabling), mode flip + sync status + retry, drop-onto-current-project. Empty `<div>` versions slot with id for Task 5.

- [ ] **Step 5: Rewire `main.js` + `index.html`** — delete `#project-drawer` markup and `projectDrawer`/`toggleDrawer` sharing (ai-drawer stands alone); mount `initEditorHeader` in the editor drawer; delete `src/projects.js` and its import.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/editor-header.test.js test/aiAccount.test.js test/storage-projects.test.js` in `apps/jscad-web`
Expected: PASS; delete `test/projects-ui.test.js` only if it tests the removed module (move still-valid cases into `editor-header.test.js` first)

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src/editorHeader.js apps/jscad-web/src/syncEntry.js apps/jscad-web/src/aiAccount.js apps/jscad-web/src/projects.js apps/jscad-web/static/index.html apps/jscad-web/main.js apps/jscad-web/test/editor-header.test.js
git commit -m "feat(web): editor drawer header replaces project drawer"
```

### Task 4: File tree driving the editor

**Files:**
- Create: `apps/jscad-web/src/fileTree.js`
- Modify: `apps/jscad-web/src/editor.js`, `apps/jscad-web/main.js`
- Test: `apps/jscad-web/test/file-tree.test.js` (new), `apps/jscad-web/test/editor.test.js`

**Model:** `sonnet` — new component plus buffer/discard integration.

**Interfaces:**
- Consumes: Task 3 header (tree container lives in the editor drawer); file maps from `fileSystem.projectFiles()`; entry path and touched paths pushed from `main.js`.
- Produces: `fileTree.js` exports `renderFileTree(container, {files, entry, dirtyPaths, touchedPaths, onOpen, onDelete, onRename})`; `editor.js` exports `setFileMeta({entry, touched})`; tree never hidden (single file renders one node).

- [ ] **Step 1: Write failing tests in `test/file-tree.test.js`** (jsdom)

```js
// nested paths render as nested groups; entry node carries .is-entry
// dirty paths carry .is-dirty; touched paths carry .is-touched
// single-file map renders one node
// trash click calls onDelete(path) after confirm; pencil calls onRename(path, newName)
// node click calls onOpen(path)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/file-tree.test.js` in `apps/jscad-web`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement `fileTree.js`** — pure render from the file map (skip nothing: `test/`, `notes/`, binary, dotfiles all show); directory grouping by `/`, directories first then files, alphabetical throughout (no empty-directory nodes: file maps only contain files); binary nodes show a size badge and open exactly like text (same as today's flat list); narrow screens reuse the existing `#editor-nav` open/close toggle, no new responsive work; row buttons trash/pencil with `confirm` on delete; entry file and last file delete blocked with a message row (no confirm).

- [ ] **Step 4: Integrate `editor.js`** — `setFiles` renders the tree instead of the flat list (remove the `<2` hiding); node open reuses the dirty-buffer read path (`buffer.isDirtyPath` → buffered content, else `readSource`) gated by `confirmDiscard`; add `setFileMeta({entry, touched})` export storing render state.

- [ ] **Step 5: Integrate `main.js`** — after `setFiles`, call `setFileMeta({entry: currentEntry, touched})` with the turn-touched set (collected in `showFile`, cleared on `startTurn`); wire tree delete/rename to the existing remove path (`removeProjectFile` + `removeFile` + `build` + `showFiles`) and rename as collision-check (target exists → blocked message, same rule as `write`) then `writeThrough(new)` + `removeThrough(old)` + build + refresh.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/file-tree.test.js test/editor.test.js test/editorBuffer.test.js test/file-system.test.js` in `apps/jscad-web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/jscad-web/src/fileTree.js apps/jscad-web/src/editor.js apps/jscad-web/main.js apps/jscad-web/test/file-tree.test.js
git commit -m "feat(web): file tree drives the editor"
```

### Task 5: Versions dropdown

**Files:**
- Modify: `apps/jscad-web/src/editorHeader.js`, `apps/jscad-web/main.js`
- Test: `apps/jscad-web/test/editor-header.test.js`

**Model:** `haiku` — mechanical: fill the reserved slot using the Task 3 harness and existing manager calls.

**Interfaces:**
- Consumes: Task 3 header versions slot; `manager.listVersions/restoreVersion`; Task 2 message format.
- Produces: versions `<select>` in the header.

- [ ] **Step 1: Write failing tests in `test/editor-header.test.js`**

```js
// rows read '<locale timestamp> — edit|chat…|restore…' with the chat excerpt shown
// selecting a row restores in place via manager.restoreVersion then onRestore
// no versions → select disabled with reason 'No versions yet'
// disk mode → select disabled with reason 'Folder projects keep history in git'
// restore with dirty buffer asks the discard confirm first
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/editor-header.test.js` in `apps/jscad-web`
Expected: FAIL (no versions control)

- [ ] **Step 3: Implement the versions `<select>`** in `editorHeader.js` — refresh on project switch and after turns/compiles (reuse the header `render`); restore path goes through the injected `confirmDiscard` then `manager.restoreVersion` + `onRestore`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/editor-header.test.js test/storage-session.test.js` in `apps/jscad-web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/jscad-web/src/editorHeader.js apps/jscad-web/main.js apps/jscad-web/test/editor-header.test.js
git commit -m "feat(web): versions dropdown in editor header"
```
