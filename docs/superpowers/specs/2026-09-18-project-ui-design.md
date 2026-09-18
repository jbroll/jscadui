# Project UI — design

Date: 2026-09-18. Status: approved all sections in brainstorming.

## Goal

Expose the local-first rowboat storage in `apps/jscad-web` as a project UI:
a side panel with project list, version history, and per-project mode toggle,
plus a fix for the overlapping drawer pull-tabs. Approach: storage-owned
projects (Option A) — the storage interface stays the source of truth and the
UI drives the existing editor/worker seams.

## Background

Every editor compile and `writeModel` save already records a version row plus
file hashes (`apps/jscad-web/src/storage/`), but the app has one invisible
`local`-mode `default` project. The drawers (`#editor-drawer` in flow,
`#ai-drawer` fixed right) overlay each other and every toggle tab sits at
`top: 50%`, so open panels can strand a tab out of reach.

## 1. Panel and tab-overlap fix

A new `#project-drawer` beside the editor, built like `#ai-drawer`: fixed
right panel, 360px, translateX toggle, own `#project-toggle` tab. It hosts a
new `src/projects.js` UI module: project list on top, version history below,
mode toggle in the project header.

Toggle tabs stack vertically instead of sharing `top: 50%`: editor tab middle,
project tab above, AI tab below, each offset by tab height plus gap. Offsets
derive from drawer open state through CSS classes only, no JS layout math, so
a closed drawer never strands its tab under an open panel.

## 2. Projects, switching, drops

`createProjectManager({ local, getRowboatStore })` owns the list over the
storage interface (`listProjects`, `readProject`, `writeFiles`). A project
lives in exactly one backend. `main.js` `currentProjectId` becomes
switchable. Switching runs the existing path: `readProject`,
`editor.setSource(entry)`, `editor.setFiles`, `jscadScript`, chat rebind to
the new id. The viewer, params, and worker flows are untouched.

New projects start from the current editor buffer. Rename edits the project
row only. The existing `default` project adopts current anonymous content
as-is; no migration UI.

Drops branch on target: dropping files onto a project row merges them under
`<project>/<dropped-folder>/` and writes a version row; dropping onto the
body root creates a project named for the folder. Single script drops keep
today's load-directly behavior, then version into `default`.

## 3. Versions and restore

The panel lists `listVersions(current)` newest-first with timestamp, message,
and a per-row Restore button. Restore reads the snapshot, loads it through
the same path as a switch, then writes it back through the session as a new
version row with message `restore <short-id>`. History is append-only: the
restored-from row is never mutated. Multi-file versions restore all files and
refresh the editor file list. Failures surface in the existing error bar,
never as throws.

## 4. Mode toggle

A local/rowboat switch in the project header, disabled with a note when
anonymous (rowboat needs a session) or tokenless. Flipping reads current
files from the owning backend, writes them to the other backend with message
`mode to <rowboat|local>`, and updates the project row's mode. Old version
rows stay in their original backend, listed with a per-row backend tag:
cross-mode history is visible, never migrated. The session `getBackend`
consults the project row, replacing the always-local stub; the `jscadScript`
merge already handles mixed maps. The toggle disables mid-flip; failure keeps
the mode and reports in the error bar.

## 5. Testing

No live server. Manager logic (create/switch/rename, drop-target branching,
flip copies current files only, restore-as-new-version) tests against the
fake local backend plus a second local instance standing in for rowboat.
Panel jsdom tests cover list rendering, stacked tab offsets as computed
positions, restore wiring, and the disabled anonymous toggle. One Playwright
smoke covers open-panel-switch-restore against stub worker calls. Existing
storage, chat, and bridge suites stay green untouched.

## Non-goals

Share UI and share routes, project deletion, version diff view, server-side
model execution, settings/key sync.
