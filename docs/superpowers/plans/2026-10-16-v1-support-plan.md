# V1 + Lib-Root Support — High-Level Plan

**Goal:** Run V1 `.jscad` natively and resolve library-rooted includes/requires,
so the fetched corpus (tspspi, gilboonet, hardware, z3dev leftovers) executes
unmodified — and the same mechanism deletes the SCAD include-rewriting patches.

**Principles:** fetched files stay byte-identical upstream; pins stay git SHAs;
`skip.txt` remains the triage record; no V2 harness behavior changes for V2 files.

---

## Phase 1 — Per-lib-root resolution (1a DONE)

- **1a. SCAD `fileResolver` prefix map** — DONE 2026-10-16:
  `packages/openscad/bin/libraryPrefixes.js` (pure, longest-prefix-first,
  `BOSL2/`+`BOSL/`+`MCAD/`+`list-comprehension-demos/`) + hook in
  `createFileResolver` (relative-first preserved, prefix before lib-paths).
  Proof: deleted `bosl2-lib-fix-includes.patch`, re-fetched pristine upstream
  (`include <BOSL2/std.scad>` back), single-model comparisons pass
  (BOSL2logo, fractal_tree, bottlecaps), unit 851 green. Remaining patches
  (`bosl-lib-`, `mcad-`, `list-comprehension-demos-`) fall to the same pattern.
  NOTE: generated `NNN-*.scad` corpus files still emit `<lib/...>` from
  extract-bosl2-examples.js — resolves relatively, intentionally untouched.

Why first: SCAD patches, V1 `include()`, and JS lib requires all reduce to
"resolve a rooted path against registered library roots". Land the primitive once.

- **1a. SCAD `fileResolver` prefix map** (`packages/openscad/bin/run-jscad.js:415`):
  remap known prefixes (`BOSL2/` → `corpus/bosl2/lib/`, `BOSL/` → `corpus/bosl/lib/`,
  `MCAD/` → vendored MCAD root) before the relative-then-library-path join.
  Keep `<...>` vs `"..."` semantics intact. Prove it by deleting
  `bosl2-lib-fix-includes.patch` with the bosl2 suite still green; then
  `bosl-lib-`, `mcad-`, `list-comprehension-demos-` patches one by one.
- **1b. Wire `setLibraryPrefixes` in the frame worker**, mirroring the proven
  `packages/agent-loop/eval/backend.js:128` wiring (`<name>/` → served libs dir).
  Check the browser-side SCAD resolver path too (only the Node path is traced).
- **1c. Collapse dual mappings** where a single copy + alias suffices
  (e.g. `lego`: `examples/` + `libs/`). Optional cleanup once 1a/1b hold.

## Phase 2 — V1 runtime: USE THE APP'S EXISTING CSG PATH (PIVOT 2026-10-16)

Supersedes the fluent-shim approach (vendored files deleted same day):
the app already runs V1 via `@jscad/csg/api.js`
(`src_bundle/bundle.V1_api.js`) + `src/addV1Shim.js` header/footer, applied to
every `.jscad` file (`fileSystem.js:137`). Verified: `table_4pieds` loads and
runs under the shim in Node. Consequences:
- V1 corpus files keep `.jscad` (the `.example.js` suffix would bypass the
  app's V1 detection). `asExample` stays for V2-shaped files only
  (z3dev, gilboonet botai/butai).
- `examples.test.js` mirrors the app: discovers `.jscad`, applies `addV1Shim`,
  maps `@jscad/csg` → `@jscad/csg/api.js`. Param defs need no work.
- Deleted: `packages/worker/src/v1shim.cjs` + test + worker fluent dep
  (two V1 stacks would be a maintenance hazard).

## Phase 3 — `include()` via source inlining (DONE: `packages/worker/src/inlineIncludes.js`)

V1 `include(path)` merges the target into global scope — implemented as
textual inlining (recursive, each file once, cycle-safe), shared by app +
test harness. Key fix found by corpus: directives inside block comments
(header usage examples) must be ignored, or an injected `*/` closes the
outer comment early. Resolves relatives + absolute roots (nearest ancestor
`library/` dir — the tspspi layout). Locked by 7 unit tests.
App wiring (fileSystem addV1Shim-time inlining against project files +
lib roots) is the remaining step for real runs; harness already uses it.

V1 `include(path)` merges the target into global scope — closest faithful
implementation is textual inlining (recursive, cycle-guarded), not a runtime
function. Shared helper so app + test harness use one implementation.
Remaining old Phase-3 notes (auto-detect/injection) are obsolete: the app
already detects `.jscad` + applies `addV1Shim` (`fileSystem.js:137`).

- [x] Stale fluent-vendoring notes removed (see Phase 2 pivot).

## Phase 4 — Corpus enablement (IN PROGRESS 2026-10-16: 42 V1 files green)

- gilboonet: 25/35 pass (both engines), unskipped. Skipped: 3 include-libs
  (covered transitively), 1 CSG points-format gap, 3 const-redeclare, 2 bare
  globals, 1 runtime failure.
- tspspi: 17 models + 2 lib demos pass, unskipped. Skipped: 26 include-libs,
  4 bare-`window`, 2 `alert()` on defaults, 1 Node-crasher (TestTubeHolder),
  1 over-budget (bedxy, 42s).
- `examples.test.js`: 216 → 390 passing.
- Remaining: hardware (needs cross-file globals = app-side include), z3dev
  leftovers (V1-def schema + manifold extrude gap), app-side include wiring
  (fileSystem), demo-browser curation (out of scope).

- tspspi (52 files, clean include-graph `models/`+`library/`): first full win.
- gilboonet polyhedra + furniture (global-`main` files exercise the exports capture).
- hardware V1 examples + z3dev V1-def leftovers.
- Each file: passes `examples.test.js` on both engines (or gains a documented
  engine-specific reason) → remove from `skip.txt` → grids pick it up automatically.
- `src/examples.js` demo-browser curation: explicit follow-up, leave curated list alone.

## Phase 5 — Manifold extrusion gap (independent bug)

- 4 z3dev models pass on `@jscad/modeling`, fail on manifold in
  `extrudeFromSlices`/`extrudeFromPath` (`beer-can-holder`, `bs-8-dan-cheif-ring`,
  `iphone-6s`, `minion-goggles`). Separate issue against `packages/manifold`;
  unskip when fixed. Not on the V1 critical path.

## Order & checkpoints

1 → 2 → 3 → 4, with 5 independent anytime.
Checkpoint after each phase: full `examples.test.js` green, fetched trees still
byte-identical (spot-check `git status` in `.deps-cache`), one patch deleted per
1a step. Commit per phase on `feat/jscad-native-corpus`.
