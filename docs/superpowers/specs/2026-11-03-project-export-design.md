# Project export (zip)

## Goal

One action downloads everything needed to print a project: its code, the
parameter values, the assembly STL, and one STL per printed part in print
orientation, built with the assembly's parameter values.

## Scope / Non-goals

In scope: an **Export project (zip)** entry in the existing export dropdown
(`apps/jscad-web/src/exporter.js`), for a project opened from any store
(This device, Synced, Folder).

Not in scope: Save of parameter values as the project's starting values
(a separate change; it will write the same `params.json`), importing a zip,
formats other than binary STL inside the zip, per-part export buttons, an
export through the chat's `export` tool.

## Data model

The zip, named `<project name>.zip`:

| Path | Content |
|---|---|
| every project file, at its project path | the file's current text, as the editor holds it saved |
| `params.json` | `{ "<param path>": value }` for the params the user changed in the run's set (see Behavior contract); `{}` when none. Untouched params stay out so calculated defaults keep following their inputs when Save replays the file. (Builder's call.) |
| `stl/<project name>.stl` | the assembly: `main()`'s return, as the STL export of `main.js` writes it today |
| `stl/<part>.stl` | one captured part (below) |
| `stl/<part>-x<N>.stl` | a part `main()` produced N > 1 times identically |
| `stl/<part>-<k>.stl` | the k-th distinct output of one maker, k from 1 |

`<part>` is the maker name without `make`, first letter lowercased:
`makeTruck` → `truck`, `makeSideFrame` → `sideFrame`. When two files export
the same maker name, both get the file's base name as a prefix:
`truck-sideFrame.stl`. (Builder's call; the user did not specify.)

STLs sit under `stl/` so the unzipped folder opens as a Folder project
without the meshes mixing into the code. (Builder's call.)

## Behavior contract

**Parameters.** The assembly and every part are built in one run of the
entry's `main(params)` with one set of values:

- with the entry file selected, the values its parameter panel shows;
- with any other file selected, the code's defaults (once Save exists, the
  saved values).

The run takes the values and changed paths the way a panel run does
(`paramsCtrl.getWorkerParams()`); `params.json` holds the changed ones.

**Saved files only.** The zip and the run both use the saved project files
(`fileSystem.projectFiles()`), so code and STLs always agree. When the editor
has unsaved edits, the export still runs and the notice line says
`unsaved edits are not in the export`. (Builder's call.)

**Capturing parts.** A part is the value a `make[A-Z]*` function exported by
a project file returns when `main()` calls it directly, before `main()`
rotates, moves or colors it. Mechanism, user-approved:

- Before the entry loads, every project file that exports a maker (the
  `exportsMaker` test in `src/projectBuild.js`) has each `make*` export
  replaced with a wrapper that records its resolved return value.
- Only calls made while no other wrapped maker is running are recorded. A
  maker called from inside another maker is part of that part's geometry,
  not a separate print. "Running" is the maker's synchronous span: depth
  rises on entry and falls when the call returns, before its promise
  settles, so `Promise.all([makeA(p), makeB(p)])` in `main` records both. A
  nested call made after an `await` inside a maker is recorded as its own
  part. (Builder's call: makers are synchronous in practice, and tracking
  context across awaits needs machinery this does not justify.)
- An array return is one part (flattened and serialized together).
- A file `main()` never calls produces no STL.

**Repeated parts** (user-approved). Outputs of one maker that serialize to
identical STL bytes are one file, `-x<N>` naming the count. Outputs that
differ get `-1`, `-2`, … in call order. A maker with one output gets the
bare name.

**Build reuse.** The export runs the entry in the frame like any other run.
It leaves the viewer, the parameter panel and the chat's build report
unchanged, and leaves no wrapper behind: a later run sees the part files'
own exports.

**Progress.** The export button shows `Exporting…` and is disabled until
the download starts, as the existing exports do.

## Failure contract

- No project open (an example, a URL script, a dropped single file): no
  download; the error line says `open a project to export it`. The entry
  stays in the dropdown. (Builder's call.)
- No entry file: no download; the viewer's error line shows the existing
  `NO_ENTRY` message.
- The run fails (syntax error, a maker throws, `main` throws): no download;
  the error shows with its file and line, as a build error does.
- `main()` returns no geometry: no download; `export produced no geometry`,
  the existing message.
- A captured part is empty geometry: it is left out of the zip; the rest
  downloads.
- No maker is called (a single-file project): the zip holds the code,
  `params.json` and the assembly STL only.
- Binary project files (images) are included as bytes.

## Binding constraints

- Model code runs only in the sandboxed frame (jscad-run.rkroll.com); the
  app origin never evaluates it.
- `fflate` is already a dependency of `apps/jscad-web` and provides
  `zipSync`; no new dependency.
- Measured sizes: `main.js` 1347 lines, `src/exporter.js` 124,
  `src/projectBuild.js` 159, `src_frame/bundle.frame-worker.js` 184. No
  line cap is enforced; new logic goes in its own module rather than
  `main.js`.
- Every project file runs as CommonJS: the frame's transform
  (`transformcjs`, Babel `transform-modules-commonjs`) turns ESM `export`
  into writable `exports.x`, and importers read `_part.makeX` at call time.
  Wrapping the exports object in place captures CJS and ESM makers alike.
- The worker's require cache must be cleared for project files before and
  after the capture run (`jscadClearFileCache`), so no wrapper survives.
- Docs change in the same commit: `apps/jscad-web/README.md` export section
  and `apps/jscad-web/docs/architecture.md`.

## Testing

- part name from maker name, including the collision prefix
- direct maker call captured, nested maker call not
- identical outputs → one `-xN` file; different outputs → numbered files
- array return → one part
- uncalled part file → no STL
- ESM part file → captured like a CJS one
- async makers under `Promise.all` → both recorded
- params.json holds only changed values; entry selected vs part selected
- unsaved editor edits → zip has saved text, notice shown
- no project open → no download, message shown
- zip lists every project file at its path, binary file as bytes
- failed run, no entry, empty geometry → no download, message shown
- empty captured part → left out
- after export, a normal run of the project sees unwrapped makers
- e2e: a two-part project downloads a zip whose STL list matches its makers
