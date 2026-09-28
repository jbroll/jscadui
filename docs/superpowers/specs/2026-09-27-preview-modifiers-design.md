# `%` and `#` modifiers in the viewport

OpenSCAD's `%` (background) removes a subtree from the CSG and draws it as a
transparent grey ghost. `#` (highlight) keeps the subtree in the CSG and also
draws a transparent pink copy, so `difference() { cube(10); #cylinder(...); }`
shows the cutter that was subtracted. Neither appears in STL export.

Today the transpiler emits `undefined` for `%` (`statements.ts:544-551`,
`:175-178`), and `#` is ignored, so `rubber_duck_debugging.scad`,
`issue1005.scad` and similar models render empty or incomplete. A 2026-09-27
attempt that emitted `%` children behind a `$preview` conditional drew them
solid and regressed 9 nopscadlib models in the `--preview` STL comparison,
because reference OpenSCAD excludes `%` from exports even at `$preview=true`.

This design carries ghost geometry alongside the real result through the
runtime and keeps it out of every export path by a flag, not by `$preview`.

## Scope

In: `%` and `#` on module instantiations, `if/else`, and `for`, drawn in the
jscad-web viewport on both engines.

Out, added to `docs/backlog.md`:
- `!` (root): needs `main()` to short-circuit to one subtree, a different
  mechanism.
- Ghosts in ALL.js grid cells: cells go through `normalizeAndPlace` and the
  streaming claims; this spec filters ghosts out of cells.

`*` is unchanged (emits `undefined`).

## Overlay records and propagation (`packages/openscad-runtime`)

An overlay is `{ kind: 'background' | 'highlight', mesh, matrix }`.

- `mesh` is a plain jscad snapshot (`geom3` or `geom2` data, never a manifold
  handle) taken when `%`/`#` runs. `consume.js` disposes each operation's
  inputs, and under `#` the child is also a CSG input that gets disposed.
- `matrix` is a 4x4 starting at identity. Affine operations multiply onto it;
  the mesh is not transformed until `main()` returns.

Overlays live in a module-level `WeakMap` keyed by the result geometry, so the
geometry objects and both engines are untouched.

- `j$.highlight(child)`: snapshots `child`, appends a `highlight` overlay to
  `child`'s list, returns `child`.
- `j$.background(child)`: snapshots `child` and returns a `BACKGROUND`
  placeholder object carrying only overlays. `_isAbsent` in `primitives.js`
  treats a placeholder like `NO_CHILD`, so no CSG operation consumes it.
- An absent child (`undefined`, `NO_CHILD`) under `%`/`#` records nothing.

Per operation:

| Operation | Overlay handling |
|---|---|
| `translate`, `rotate`, `scale`, `mirror`, `multmatrix`, `resize` | multiply the operation's matrix onto each input overlay's `matrix` |
| `safeUnion`, `safeUnion2D`, `union`, `subtract`, `intersect`, `hull`, `minkowski`, `childrenAt`, `childrenAtRange` | concatenate all inputs' overlays onto the result; if the result is empty, return a placeholder holding them |
| `color`, `offset`, `linearExtrude`, `rotateExtrude` | pass input overlays through unchanged |
| anything else | drops overlays |

For `resize`, the matrix is the scale it computes from the real geometry's
bounds. A `%` child inside an extrusion stays flat at its 2D position.

A test enumerates the geometry-taking `j$` entries and fails when one is not
listed in the table above, so a new operation forces a decision.

## Transpiler output and `main()` (`packages/openscad`)

- `%` wraps the child: `j$.background(<child>)`. This applies before the
  `for`/`let`/`echo` dispatch, as the `undefined` check does today, and on the
  `if/else` path.
- `#` wraps the child: `j$.highlight(<child>)`, on the same paths.
- `main()` (`transpile.ts:579-602`) becomes
  `return j$.withOverlays(j$.safeUnion([...]))`.

`j$.withOverlays(result)`:
- no overlays: returns `result` unchanged, so models without `%`/`#` produce
  the same geometry as today;
- overlays: returns `[solid, ...ghosts]` (`solid` omitted when the result is a
  placeholder). Each ghost is a jscad `geom3`/`geom2` built from `mesh` with
  `matrix` applied, colored by kind, with `previewOnly: true`:
  - background: `[0.5, 0.5, 0.5, 0.3]`
  - highlight: `[1, 0.32, 0.32, 0.5]`

  The child's own `color()` is ignored, as in OpenSCAD.

`withOverlays` never reads `$preview`: reading it latches `previewUsed`, which
would make every export of a `%` model re-run.

## Consumers

Each consumer separates ghosts by `previewOnly`.

- Worker (`packages/worker/worker.js:319-329`): after `flatten`, items with
  `previewOnly` go to a local `ghosts` list and `workerState.solids` keeps the
  rest. The entity build (`:365`) receives `[...solids, ...ghosts]`.
  `streamParts` (`:338`) counts only real solids.
- Viewport: no change. `JscadToCommon` copies `color`; three.js and regl mark
  alpha-below-1 entities transparent, and regl draws them last without depth
  writes. Ghosts count toward zoom-to-fit bounds.
- Export: the frame's `jscadExportData` (`src_frame/bundle.frame-worker.js`)
  serializes `workerState.solids`, which holds no ghosts.
- Comparison: `run-jscad.js` `evalScadSolidSync` drops `previewOnly` items
  before its union, so `--preview` grading is unchanged.
- Grid cells: a cell's result is filtered the same way before placement.

## Testing

Unit tests, written before each piece:

- `openscad-runtime`:
  - `highlight` returns its child and records an overlay; `background` returns
    a placeholder the CSG ignores.
  - each transform composes onto overlay matrices; a nested
    `translate(rotate(...))` places the ghost where OpenSCAD does.
  - each multi-input operation carries overlays, including when its result is
    empty.
  - an overlay survives `consume.js` disposing the highlighted child on
    manifold.
  - the operation-coverage test described above.
- Transpiler: emission for `%x`, `#x`, `%if`, `%for`, `#` inside `difference`;
  `*` unchanged; a model without modifiers transpiles as before apart from the
  `withOverlays` wrapper.
- Worker: `main` returning `[solid, ghost]` yields two entities and one entry
  in `workerState.solids`.
- `run-jscad.js`: ghosts dropped before the union.

Verification before any commit of the transpiler change:

- Full GPU OpenSCAD comparison baseline. Expected diffs only in models using
  `%`/`#`; nopscadlib stays 146/146 with `--preview`.
- Render sweep via simple-ci (`ci/render`): `rubber_duck_debugging.scad`,
  `issue1005.scad` and the other `%`/`#` empties leave the failure list;
  update `render-baseline.json` from that job.
- Look at a couple of models in the browser to judge the ghost colors.

## Documentation

In the implementing commits: replace the `%` item in `docs/backlog.md` with
the two out-of-scope items above; describe the overlay channel in
`apps/jscad-web/docs/architecture.md` and the openscad package docs.
