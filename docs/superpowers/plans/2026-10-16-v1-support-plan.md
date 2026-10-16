# V1 + Lib-Root Support — High-Level Plan

**Goal:** Run V1 `.jscad` natively and resolve library-rooted includes/requires,
so the fetched corpus (tspspi, gilboonet, hardware, z3dev leftovers) executes
unmodified — and the same mechanism deletes the SCAD include-rewriting patches.

**Principles:** fetched files stay byte-identical upstream; pins stay git SHAs;
`skip.txt` remains the triage record; no V2 harness behavior changes for V2 files.

---

## Phase 1 — Per-lib-root resolution (enables everything else)

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

## Phase 2 — `jbroll/jscad-v1shim` package (needs repo creation)

- Fork the single-file MIT shim out of `jscad-community/jscad-migrate`
  (`v1shim.js`: functional V1 names → V2 modeling) into `jbroll/jscad-v1shim`
  as a minimal npm package (`package.json`, LICENSE with attribution).
  (gh CLI is authed as jbroll; confirm before creating the public repo.)
- Consume pinned: `fetch-deps` manifest entry
  (`url: jbroll/jscad-v1shim.git` + commit pin → `apps/jscad-web/libs/jscad-v1shim/`,
  matching the gitignored-libs precedent) — decision needed only if npm-git-dep
  proves simpler for the worker's bundling.
- Extend the shim for our corpus reality (upstream covers functional names only):
  method-chaining via geometry wrapper/Proxy (`.translate/.rotate/.union` —
  gilboonet + tspspi templates), `CSG`/`CAG` globals surface, `getColorRGB`,
  `polygon()` positional form. Each addition driven by one failing corpus file.

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
