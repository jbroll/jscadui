# Launcher disk project

Working plan; delete before merge, after folding the design into
`apps/jscad-web/docs/architecture.md` and the README launcher section.

Under `jscad-chat`, the open project is the model directory on disk. Every
file-touching path reads and writes it: the agent's `list`, `read`, `write`,
`edit`, `run`, `measure`, `check`, `export`, the per-turn project context, the
editor's save, and model `require`s of siblings. The deployed web build does not
change.

## 1. Server file API (`apps/jscad-web/scripts/local/fsApi.js`, mounted in `server.js`)

`createFsHandler({ modelDir, appOrigin })` returns `async (req, res) => boolean`
(true when it handled the request), like `createRelayHandler`.

Routes, all under `/api/fs`:

| Request | Answer |
|---|---|
| `GET /api/fs` | `200` JSON `{ files: [{ path, size, mtimeMs }], truncated }`, paths `/`-separated and relative to `modelDir`, sorted |
| `GET /api/fs/<path>` | `200` raw bytes, `content-type` by extension else `application/octet-stream`; `404` when missing |
| `PUT /api/fs/<path>` | body is the raw bytes; creates parent dirs; `204`. Body over 50 MB → `413` |
| `GET /api/fs/events` | `text/event-stream`; one `data: {"paths":[...]}` event per burst of changes (debounced ~100 ms) from a recursive `fs.watch(modelDir)`. Paths are hints: the client re-lists |

Listing: inside a git work tree, `git -C modelDir ls-files -z --cached --others --exclude-standard`
(then drop paths that no longer exist); otherwise a walk that skips dot
entries and `node_modules`. Cap 2000 files, `truncated: true` past it.

Every `/api/fs` request must name `localhost:<port>` or `127.0.0.1:<port>` as
its `Host` (a DNS-rebound page is same-origin to itself) and come from the app
page: `Origin === appOrigin`, or
no `Origin` with `sec-fetch-site: same-origin` (same-origin GET and
EventSource). Anything else, including the frame origin (port+1), gets `403`.
No `access-control-allow-origin` header on these routes.

A path is refused (`403`) when, after `decodeURIComponent`, it is empty,
absolute, contains `..`, has any segment starting with `.` or equal to
`node_modules`, or resolves (through `realpath` of its deepest existing
ancestor) outside `realpath(modelDir)`. Other methods → `405`.

`/models/*` static serving stays as is.

## 2. Disk backend (`apps/jscad-web/src/storage/disk.js`)

`createDiskStorage({ base = '/api/fs', fetch = globalThis.fetch, EventSource = globalThis.EventSource })`,
the same store interface as `local.js`:

- One project, id `'disk'`, `mode: 'disk'`. `writeFiles`'s `options.entry`
  (and `name`) set the entry; default `'main.js'`.
- `readProject('disk')` → `{ id, name, entry, kind, mode: 'disk', files }`:
  lists, then fetches every file. A file whose bytes decode as UTF-8 (fatal
  `TextDecoder`) with no NUL is a string, anything else a `Uint8Array`.
- `writeFiles('disk', files, options)` PUTs only paths whose content differs
  from what it last read or wrote; returns `{ id, entry, kind }`. Never deletes.
- `writeFile(path, bytes)` PUTs one file (export).
- `snapshot` no-op; `listVersions` → `[]`; `readVersion` throws (git keeps history).
- `readConversation` / `writeConversation` in memory.
- `listProjects()` → the one row.
- `watch(onChange)` opens `EventSource(base + '/events')`; on each event it
  re-lists, fetches new or changed (size or mtime) files, and calls
  `onChange({ changed: { path: content }, removed: [path] })`. Returns a stop
  function.

## 3. Wiring (`apps/jscad-web`)

- `build.js` stamps `__LOCAL_FS__` from `JSCAD_LOCAL_FS === '1'`;
  `scripts/local/build.js` sets it. Declare the global where the other
  `__…__` globals are declared (eslint/tsc).
- `src/storage/projects.js` and `src/storage/session.js` route mode `'disk'`
  to the disk store.
- With `__LOCAL_FS__` and a `#/models/<entry>` hash, boot opens the disk
  project (entry from the hash) through `switchProject`, so the file cache,
  `currentEntry`, `currentProjectId` and the editor hold the directory.
  `fileSystem.projectFiles()` then feeds every agent tool unchanged.
- Chat `write`/`edit` already go through `storeFile` → `writeThrough`; with
  the disk route they land on disk.
- Editor save (Ctrl+S) in a disk project writes the open file through the
  store instead of `showSaveFilePicker`.
- `export` in a disk project writes the serialized model to
  `<entry basename>.<format>` in the directory and reports `{ ok, format, size, path }`.
- `watch` updates the cache (`addToCacheWrapper` + `jscadClearFileCache`),
  refreshes the editor's file list, reloads the open file when it changed and
  the buffer has no unsaved edits (else keeps the buffer and warns), and
  rebuilds.

## 4. Tests and docs

- `fsApi.test.js`: origin refusal (foreign, frame, none-without-same-origin),
  traversal, dot segments, `node_modules`, symlink escape, git-ignored files
  absent from the list, PUT creates dirs, 413, events fire on a write.
- `disk.test.js`: with a stubbed `fetch`/`EventSource`: text vs binary,
  only-changed PUTs, watch diffing.
- Opening a `/models/` project fills `projectFiles()`; chat write reaches the
  disk store; export writes the file.
- README launcher section, `docs/architecture.md` (Storage and Local launcher).
