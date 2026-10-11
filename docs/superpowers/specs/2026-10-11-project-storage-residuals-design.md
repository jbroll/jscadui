# Project & storage residuals — design

Status: approved in design review, 2026-10-11.
Scope: `apps/jscad-web`. Source: `docs/backlog.md` "Projects and storage"
(lines 91–141). Companion dossier (working, git-ignored):
`.superpowers/dossiers/project-storage-residuals.md`.

## Problem

Six interrelated defects in project handling, each traced to one of four
seams: `currentProjectId` resolution, the editor's snapshot-`File` buffer,
chat's live-project persistence, and backend mode/copy/delete semantics.

1. **Boot opens no project.** `currentProjectId` starts at the literal
   `'default'` (`main.js:387`) and only the fresh-create path resolves a real
   id (`main.js:1014-1016`); with pre-existing projects, edits and runs before
   the first click target a nonexistent project.
2. **Editor edits are dropped.** `setFiles` snapshots each file's stored text
   into a `File` (`projectFiles.js:63-66`); switching files and back re-reads
   the stale snapshot, and the next run stores the reverted text. `setSource`
   never updates the `#editor-file` label (`editor.js:175-178`). Project
   switch, version restore, demo load and chat writes replace the buffer with
   no warning.
3. **A turn in flight across a project switch persists under the new
   project.** `persistTranscript` uses the live `currentProjectId`
   (`aiChat.js:98,107-114`), and `switchTo` does not touch the in-flight turn's
   captured state.
4. **Conversations ignore per-project storage modes, and there is no New-chat
   control.** Chat storage is hardwired to `getActiveStore()`
   (`main.js:988-991,463`) — rowboat whenever signed in — not the project's
   mode.
5. **No project delete control.** The manager and every backend lack a delete
   path.
6. **Mode flip and sync state.** `flipMode` copies without removing the old row
   (`storage/projects.js:122-131`) and `listAll` does not dedupe
   (`:61-72`), so a flipped project is listed twice; sign-out leaves the sync
   loop and rowboat store running; sync errors reach only `console.warn`;
   labels read `local`/`rowboat` rather than what they mean.

## Goals

Fix all six, keeping the existing init-function/module-state pattern. Each fix
lands in the module that owns the state. No `main.js` restructuring.

## Non-goals

- IndexedDB persistence for the local backend (backlog 97–103).
- The drop-on-a-row modal bug (backlog 127–134).
- Multiple conversations per project.
- Decomposing `main.js` (Refactoring backlog).

## Shared pieces

**Confirm dialog.** A small `confirm({ title, message, confirmLabel,
cancelLabel }) → Promise<boolean>` helper, built as a DOM overlay reusing the
existing modal styling, serves the discard-before-replace prompt (item 2) and
the delete prompt (item 5). It lives as a module (`src/ui/dialog.js`).
`main.js` imports it and injects it as a `confirm` init option into
`initEditor` and `initProjects`; those modules call the injected function, so
their unit tests stay jsdom-only and can pass a stub.

## Design

### 1. Boot opens the most recently updated project

`main.js` init: after `await projectManager.listAll()`, if the list is
non-empty, call `switchProject(list[0].id)` (`listAll` is sorted updated-desc).
Empty keeps today's behavior: create `'default'`. If `listAll()` throws, keep
today's behavior (no boot switch). `currentProjectId` is then set by the normal
`onOpen` path before any edit, run or chat turn.

The choice is a pure `pickBootProject(projects) → id | null` helper (list[0]'s
id, or null when empty), so it is unit-testable without driving `main.js`.

### 2. Editor dirty buffer and confirm-before-replace

`editor.js` gains a `buffers: Map<path, string>` (current text per opened path)
and a `dirty: Set<path>`.

- A file-button click flushes the live editor text into `buffers[currentFile]`
  and loads `buffers[target]` (reading the `File` only on first open), instead
  of re-reading the stale snapshot.
- A CodeMirror `change` writes `buffers[currentFile]` and marks it dirty.
- `setSource(source, path)` writes `buffers[path]`, sets `currentFile`, and
  updates `#editor-file` so the label always names the shown file. It clears
  that path's dirty flag (the content is now authoritative).
- Whole-project replaces — project switch (`projectFiles.js`), version restore
  (via `switchProject`), demo load (`main.js:112`), remote `#url=` load
  (`main.js:896`) and chat write (`main.js` `showFile`) — call a new
  `editor.confirmDiscard()` first. When any buffer is dirty it awaits the
  confirm dialog: **Keep edits** aborts the replace (the caller stays put);
  **Discard** proceeds. A clean buffer proceeds silently. For a chat write,
  "Keep" leaves the editor showing the user's text while the agent's write is
  still stored in the project.

`confirmDiscard` is injected into the editor at init (an init option), so the
editor stays DOM-testable without the dialog.

### 3. A turn is bound to the project it started in

`aiChat.js` `runTurnLocal` captures `const turnProject = pid()` at entry, and
every `persistTranscript(turnProject)` for that turn — success, error and stop
— writes under the captured id, not the live one. The turn's view callbacks
check `turnProject === pid()` before touching the DOM, so a switch mid-turn
does not clobber the newly opened project's transcript or editor render. File
writes remain guarded by `ProjectSwitchedError` (`aiDeps.js:44-58`).

### 4. Chat storage follows the project's mode; New chat

`main.js` chat storage routes conversations through the same per-project
backend the editor session uses. Concretely, the session's
`getBackend(pid)` (`projectManager.peekMode(pid)` mapped to the local, rowboat
or disk store) becomes the single routing seam: `main.js` builds chat's
`readConversation`/`writeConversation` from the same mapping, and when a mode's
backend is unavailable (rowboat while signed out) it falls back to the local
store. A `local`-mode project's conversation no longer lands in rowboat when
signed in, and the disk project's conversation routes to the disk store.

`aiChat.js` adds a **New chat** button in `chat-header`. It clears the
transcript and view, then `writeConversation(pid(), [])` on the routed backend;
the next turn starts fresh under this project. Save-on-switch and
restore-on-return are unchanged (item 3 fixes the in-flight case).

### 5. Delete

Backends gain `deleteProject(id)`:

- `local.js` removes the project entry, its versions and its conversation.
- `rowboat.js` deletes the project and its related rows through the client, so
  the deletion is tombstoned and syncs.
- `disk.js` refuses (returns false / throws) — the folder is the user's.

`createProjectManager` exposes `deleteProject(id)`: route to `ownerOf(id)`,
call the backend, drop the mode entry. `src/projects.js` adds a per-row delete
control, disabled for disk mode, that opens the confirm dialog. `main.js`'s
`onDelete`: delete, re-render the panel, and when the deleted id was the open
project, `switchProject` to the next most recent (or the empty state if none).

### 6. Mode flip, sign-out, sync status, labels

- `flipMode`: copy to the target backend, then delete the old row from the
  source backend (its project, versions and conversation), then
  `remember(id, toMode)`. A copy failure leaves the old row untouched.
  `listAll` also dedupes by id, preferring the owner's mode, to heal any
  project already double-listed.
- Sign-out: `initAccount` gains an `onSignOut` callback; `main.js` wires it to
  stop the sync loop, close the rowboat store and null
  `rowboatStore`/`rowboatStorePromise`. (Sign-in is a full-page redirect, so the
  in-page teardown is the sign-out path.)
- Sync status: a `#project-sync-status` line inside the project drawer. The
  sync loop's `onError` sets it with a retry that calls `syncNow()`; a
  successful sync clears it. `console.warn` remains for detail.
- Labels: the mode button and row text read `This device` (local), `Synced`
  (rowboat) and `Folder` (disk) instead of `local`/`rowboat`/`disk`.

## Testing

Vitest (jsdom for UI):

- `projects-ui`: delete button + confirm + disk-disabled; New chat; relabelled
  modes; deduped list after a flip.
- `project-files`: `pickBootProject` returns the most recent and null; a dirty
  edit survives a file switch and return; the confirm gate aborts a switch on
  "Keep" and proceeds on "Discard".
- `aiChat`: a turn captures its project and persists the reply under it when a
  switch happens mid-turn; New chat resets the stored conversation.
- `storage-projects`: `deleteProject`; `flipMode` removes the old row;
  `listAll` dedupes. The existing flip test that asserts copy-and-leave is
  rewritten.
- `storage-sync`: sign-out stops the loop.
- Backend delete tests for each backend's `deleteProject`.

e2e (`e2e/project-ui.spec.js`): boot opens the most recent project; the delete
flow. These need `ci/web`, which currently fails on the host rowboat-path issue
(`docs/backlog.md` Remaining issues); they are written but not run here.

## Rollout

Land on a feature branch, fast-forward into `main`. Backlog items for all six
residuals are deleted in the commit that lands each fix.
