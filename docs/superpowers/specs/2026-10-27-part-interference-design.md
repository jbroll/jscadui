# Part interference design

## Problem

Prod chat `972a48f1-8caa-4412-aa22-cb7e03f76087` (2026-10-28, an 8mm film
holder) built 19 parts, many of them buried in each other, and every `write`
and `edit` answered `warnings: []`. Nothing in the build report looks between
parts. The only tool that does, `measure({ overlaps: true })`, compares
bounding boxes: the base plate's box holds every other part, so it listed 59
pairs and the agent ignored them. Its own `execute` later found 273.7 mm³
shared by the base and the supply reel.

## Rules

1. Each top-level item of the array `main()` returns is a separate part.
   Two parts that share volume are a build error. A combined solid is one
   part made with `union`.
2. There is no tolerance for intended overlap. A press fit modeled as overlap
   is an error: size the pocket to the part.
3. A part may be tagged as a reference part: shown and checked, never
   exported. Purchased hardware (a NEMA 17 motor, a 608 bearing) is a
   reference part. A reference part collides like any other, so a motor that
   does not fit its mount fails the build.
4. A reference part may name the parts it is allowed to overlap, with a
   reason. Only a pair with a reference part in it can be allowed; two
   printed parts can never be. Every allowed pair is listed, with its shared
   volume, in every build report, so each exemption is reviewed on each build.
5. `previewOnly` ghosts (OpenSCAD `%`) stay outside all of this: not parts,
   not checked, not exported.

## The tag

An own property `reference` on the object at the top level of `main()`'s
return, set as the last step before returning it:

```js
const motor = nema17().translate([53, 12, -40])
motor.reference = 'NEMA 17 stepper, purchased'
const film = filmPath()
film.reference = { reason: 'film path through the gate', allow: ['gate'] }
return [base, gate, motor, film]
```

- A string is the reason. An object takes `reason` (required, non-empty) and
  `allow`, a list of part selectors as `measure` takes them: an index
  (`"1"`), a range (`"1-3"`), or an anchor part name.
- A malformed tag (no reason, `allow` not a list, a selector that names no
  part, a reference that allows itself) fails the build with `PartTagError`.
- Set on a nested object or before a later transform, the tag is lost in the
  app frame (the tree evaluator builds fresh solids). The docs topic says to
  set it last on the returned object.

## Behavior

### model-tools `check`

For an array, `check` adds:

- `interference: { pairs: [{ a, b, volume, size }], total }` when any pair
  that is not allowed shares more than `INTERFERENCE_EPSILON` (0.001 mm³).
  `a` and `b` are index strings, `volume` is mm³, `size` the shared region's
  bounding-box dimensions. Pairs are sorted by volume, largest first, and the
  list stops at 20; `total` counts them all.
- `references: [{ part, reason, allow?, overlaps: [{ part, volume }] }]` when
  any part is a reference part. `overlaps` lists the allowed pairs it shares
  volume with.
- `tagErrors: [string]` for malformed tags.
- `interferenceUnchecked: n` when more candidate pairs exist than
  `MAX_INTERSECTIONS` (300); those pairs are not intersected.

Candidates are pairs of geom3 items whose bounding boxes overlap on all three
axes. Each candidate is intersected with `booleans.intersect` and measured
with `measureVolume`, as the eval probe's `overlapsOf` does. `check` takes
`{ interference: false }` to skip all of this; the scratch-run summary
(`summarizeRun`) passes it, so `execute` pays nothing.

### Build report

`assembleReport` reads the `check` result:

- `tagErrors` → `ok: false`, `error: { name: 'PartTagError', message }`.
- `interference` → `ok: false`, `error: { name: 'InterferenceError', message }`
  and the `interference` field. The message names the largest pair, its
  volume and size, the count of the rest, and the fix: "parts 0 and 1 share
  273.7 mm³ (a 29.4 x 44.6 x 14.5 mm region); 4 more pairs overlap. Separate
  parts must not share volume: move or resize one, or union them into one
  part. Purchased hardware is a reference part and is checked too (docs
  reference)."
- `references` rides on every report that has reference parts, ok or not.
- `interferenceUnchecked` adds a warning.

Both failures keep `geometry` and `params` in the report. The geometry gate
(`noGeometry` in `apps/jscad-web/src/projectBuild.js`, `onBuild` in
`packages/agent-loop/eval/backend.js`) opens on a report that has
`geometry`, not on `ok`, so `measure`, `check`, `view` and `export` still work
on a model that interferes.

### Worker

`packages/worker/worker.js` copies a root node's `reference` onto each solid
that node evaluates to, beside where `previewOnly` is read, in
`evaluateNodes`, `evaluateStreamed` and `evaluateScratch`. It sets the
property on the solid directly (Manifold solids are class instances). The
eval backend runs no tree evaluator and needs no copy.

### Export

Every export drops reference parts and `previewOnly` ghosts: the frame's
`serialize` in `apps/jscad-web/src_frame/bundle.frame-worker.js`, the worker's
`jscadExportData`, and the eval backend's `exportModel`. The eval backend also
drops `previewOnly` from its build geometry, matching the frame.

### Agent-facing text

- `check` tool description: names `interference` and `references`.
- `measure` `overlaps` description: bounding boxes only; `check` gives shared
  volume.
- `docs reference` (also `interference`, `overlap`): the tag, its forms, set
  it last, what is exported.
- `prompt.md`, one sentence: parts in `main()`'s array are separate parts and
  must not share volume; purchased hardware is a reference part (`docs
  reference`). Unmeasured against the eval; the change is in the tools.

## Verification

- model-tools unit tests: overlap, touching faces, reference collides,
  allow, two printed parts cannot be allowed, malformed tags, the cap.
- agent-loop: `buildReport` tests for both errors with geometry kept; eval
  backend tests for the gate, ghost filtering and export filtering.
- worker: a `reference` set on a tree node reaches the evaluated solid.
- Frame: in the app frame `@jscad/modeling` resolves to the tree bundle.
  An e2e frame test runs `jscadCheck` on two overlapping cubes and gets an
  `interference` pair, proving `intersect` and `measureVolume` work there.
- Replay the film-holder project from the prod log through the eval backend
  and confirm it fails with `InterferenceError`.

## Out of scope (backlog)

- `union` drops color, so a multi-colored single object loses its colors.
- Drawing reference parts translucent.
