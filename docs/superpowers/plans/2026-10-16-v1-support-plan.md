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

## Phase 2 — vendored V1 shim on fluent (DONE: `packages/worker/src/v1shim.cjs`)

- Vendored the 96-line MIT `v1shim.js` out of `jscad-community/jscad-migrate`
  (@ 76664d2, attribution header retained) as `packages/worker/src/v1shim.cjs`
  (`.cjs`: package is ESM + esbuild-bundled). No fork, no new repo.
- Substrate rebased to `@jbroll/jscad-fluent`
  (`file:../../.deps-cache/jscad-fluent`, established pattern): every
  constructor returns chainable geometry, so V1 method style works natively.
  V1 aliases installed once on fluent prototypes (same technique as
  `wrapFluentMethods`): `mirroredX/Y/Z`, `getBounds` (adapts
  `measureBoundingBox` to V1 `[{x,y,z},{x,y,z}]`), `setColor`, 2D
  `extrude({offset})` (z-only). Upstream `sphere` undefined-`size` crash fixed.
- Locked by `packages/worker/src/v1shim.test.js` (5 tests: surface, README
  example, positional polygon, table_4pieds-style chaining, rotate/translate).
- Open: `square`/`circle`/other V1 names added lazily per failing corpus file.

## Phase 3 — Worker V1 auto-detect + injection

- Detect V1 in the existing transform path (`worker.js:626,632`):
  no `require()` + global `main` and/or `include(` / V1 API markers.
- On detect: prepend shim require, append
  `module.exports = { main, getParameterDefinitions }` capture.
  Param definitions need NO work (`convertLegacyDefs` already handles the V1
  schema; worker combines both styles at `worker.js:707-709`).
- Implement `include(path)` on top of `packages/require` using Phase-1 roots:
  absolute `/mechanics/...` → registered suite library dir; relative → sibling.
  Semantics: merge into global scope (V1 `include`, not CJS `require`).

## Phase 4 — Corpus enablement (unskip progressively)

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
