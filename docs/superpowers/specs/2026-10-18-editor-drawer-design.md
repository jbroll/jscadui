# Editor drawer: project dropdown + file tree — design

Date: 2026-10-18
Status: draft (builder check pending, then human approval)

## Intent and why

The open project is edited in two places at once: the agent writes through
`createProjectTools` (`apps/jscad-web/src/aiDeps.js`) while the user reads
through the editor pane, but the chrome around them hides that reality. The
project drawer lists projects and versions while fighting the AI drawer for
the same right column (`main.js:1046-1054`, one closes the other), and the
editor's own file nav is a flat `#editor-files` button row that disappears
entirely for single-file projects (`src/editor.js:279-305`). After the
2026-10-18 exhaust turn (11.8k prompt tokens in, 27k completion, one imports
`edit` after 9 minutes of reasoning) the model was visible in the viewer but
its files were not discoverable, and the version list grows once per editor
compile (`main.js:809-821` via `recordEdit`), burying the one-`chat`-version-
per-turn the agent already makes (`aiDeps.js:166-170`).

We want one editor drawer that owns project context: which project is open,
what files it holds, which file is displayed, and where the project has been
— so the user can always see what the model actually wrote.

## Goals

- One editor drawer owns project context; the project drawer goes away and
  the AI drawer keeps the full right column to itself.
- Project switching lives in the editor drawer header as a dropdown (plus
  New); switching keeps the existing `createProjectSwitch` semantics
  including the discard confirm.
- File tree in the editor drawer replaces the flat button row; clicking a
  node displays it through the existing `setSource`/buffer path. Visible
  even for single-file projects. Nested directories render as a tree.
- Per-file delete is a trash icon and rename a pencil icon at the tree row;
  other controls (New, versions, sync entry) sit at the top of the editor
  drawer.
- Sign-in to sync appears top-left in both remaining drawers (editor and
  AI) under one shared name.
- Versions become a dropdown; each row shows timestamp plus kind
  (`edit`/`chat`/`restore`); `chat` rows carry a short turn excerpt.
  Restoring writes in place (already lossless: restore mints a new
  `restore <id>` version, `src/storage/projects.js:118-121`).
- Version chunking: coalesce editor-compile bursts per idle window (newest
  `edit` row is replaced while compiles keep coming), snapshot on project
  switch only when content differs from the latest version, agent turns
  stay at most one `chat` version per turn (already true via
  `version: false` per tool call + `endTurn` snapshot).

## Non-goals

- No server-side tool-execution telemetry and no relay/log changes; the
  relay still sees prompts/responses only, by consent design
  (`aiChat.js:243-263`). Browser transcript + storage stay the record.
- No change to build/entry semantics, geometry, providers, or free-model
  recording.
- No versions for Folder-mode projects: disk storage keeps none
  (`src/storage/disk.js:148-151`); history lives in the directory's own
  git.
- Queued chat input while a turn runs stays a separate thread.

## Anti-goals (failure even if it technically works)

- A tree that hides files the agent can touch (`test/`, `notes/`, binary,
  dotfiles) or that vanishes for single-file projects.
- A restore that loses the pre-restore state or a silently discarded dirty
  buffer (the discard prompt must survive the move).
- A version list that still grows per compile/keystroke.
- The AI drawer still sharing its column with anything.

## Constraints (from current code)

- Layout: `apps/jscad-web/static/index.html:83-103` (`#editor-drawer`,
  `#editor-nav`, `#project-drawer`, `#ai-drawer`); `main.js:1050-1054`
  mutual-exclusion, `1066-1109` panel mount, `940-978` chat-tool wiring,
  `1028-1044` chat mount.
- Editor: `src/editor.js:215-226` `setSource` + buffer authoritative/clean
  split, `279-305` `setFiles` flat list + `<2` hiding, `262-273`
  replacement on delete, `200-206` discard confirm; `projectFiles.js:11-22`
  recordable vs URL paths, `58-61` seeded default files, `112-121`
  switch flow.
- Storage: `storage/session.js:15` routing; local (`storage/local.js:64-99`)
  and rowboat (`storage/rowboat.js:93-151`) version rows
  `{versionId, created, message}` + manifest; rowboat blobs dedupe by
  content hash; disk no-ops versions.
- Chat/agent: `aiDeps.js:51-111` save path, `166-170` endTurn snapshot with
  `{message: 'chat'}`; `aiChat.js:274-290` files/build per turn,
  `turnMentions` for touched paths.

## Decided parts (what the human partner chose)

1. Consolidation: project drawer folds into the editor drawer; remaining
   drawers are editor and AI.
2. Header: project dropdown + New + versions dropdown + sync/sign-in at the
   top of the editor drawer; same sign-in name top-left in editor and AI
   drawers.
3. Tree: nested browser driving the displayed file; marks the entry file,
   dirty state, and files the turn touched; never hidden for one file.
4. Icons: trash = delete, pencil = rename, at the file row.
5. Versions: dropdown rows of timestamp + kind; `chat` rows gain a turn
   excerpt (threaded through `endTurn` snapshot message, fallback bare
   `chat` for old rows); restore in place, no preview step.
6. Chunking: idle-window coalescing for editor `edit` rows; conditional
   snapshot on switch-away (unique content only); agent cap stays one per
   turn.

## What's left to the builder (plan may decide)

- Idle-window length and where the timer lives; whether coalescing
  replaces the row in place or rewrites its timestamp.
- Where manifest comparison happens (session vs local/rowboat) and exact
  equality rule (full file-map hash compare).
- How the turn excerpt reaches `snapshot` (plumb user text through
  `endTurn` vs read-back from persisted conversation) and its max length.
- Icon set/source, tree sort order, empty-directory and binary-file
  rendering, narrow-screen (<768px) behavior.
- Which e2e/unit seams cover the move (`editor`, `projects`,
  `storage-session`, `aiDeps` tests); style stays ESM, no semicolons,
  single quotes, 2-space, JSDoc on exports.
