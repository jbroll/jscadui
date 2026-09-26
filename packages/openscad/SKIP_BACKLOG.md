# Skipped Corpus Models — Triage Backlog

Triaged 2026-09-25 against `c3ee198` and carried forward onto `main` (`3699443`).
Covers the dotSCAD, NopSCADlib and snippet entries of `skip.txt` (does not render)
and `compare-skip.txt` (renders, but the STL comparison can't grade it). The
suites added on `main` on 2026-09-25 (MCAD, constructive, relativity, etc.) are
**not** triaged here.

Evidence used: skip-list comments, `MODEL_COMPARISON_BASELINE.md`, source reading,
and OpenSCAD 2026.09.23 `--backend=manifold` renders (two renders per model,
compared by SHA-256, to test determinism). The transpiler and `compare-stl.js`
were **not** run in this triage, so no Jaccard numbers here are new.

## Priority key

| P | Meaning |
|---|---------|
| P0 | Done on this branch; needs `npm test` (CI) to confirm Jaccard ≥ 0.99 |
| P1 | Likely fixable with a small, local change (seed patch or transpiler bug) |
| P2 | Fixable, but needs runtime/harness work or vendoring upstream code |
| P3 | Not a transpiler problem; keep skipped unless the constraint changes |

## P0 — Unskipped on this branch

| Model | Suite | Change | OpenSCAD determinism |
|-------|-------|--------|----------------------|
| `examples/tiles/2_corner_wang_tiles_basic.scad` | dotSCAD | `dotscad-tile-w2-seed.patch`: position seed in `tile_w2c` fallback | differed before, identical after |
| `examples/tiles/2_edge_wang_tiles_basic.scad` | dotSCAD | same patch (`tile_w2e`) | differed before, identical after |
| `examples/tiles/tube_box.scad` | dotSCAD | same patch (`tile_w2e`) | identical after |
| `examples/hollow_out/hollow_out_holder.scad` | dotSCAD | `dotscad-hollow-out-square-seed.patch` | differed before, identical after |
| `examples/voronoi/ripple_vase.scad` | dotSCAD | `dotscad-ripple-vase-seed.patch` (`seed = 42`) | differed before, identical after |

Single-model runs (2026-09-26, cloud session, OpenSCAD 2026.09.23 nightly,
`test-harness.js --no-stl-cache`): all five above **PASS (1.0000)**, as does
`hollow_out_torus`. The full suite on the GPU host has not run yet.

Side effect: `examples/hollow_out/hollow_out_torus.scad` is in the tested set
and uses the same `hollow_out_square()`; its reference was one of two random
variants. It is now deterministic, so its CI result may change (either way).

If any P0 model fails on CI, re-add it to `dotscad/compare-skip.txt` with the measured
Jaccard, but keep the seed patch: the patch alone makes the reference
reproducible.

## P1

| Model | Suite | Reason skipped | Proposed fix | Effort |
|-------|-------|----------------|--------------|--------|
| `examples/taiwan/chair_score.scad` | dotSCAD | Back in `compare-skip.txt`: deterministic (`rand()` only feeds `color()`), but Jaccard **0.0537** | Transpiler/runtime mismatch, not randomness. Compare the per-chair polyhedron and the `rotate`/`translate` chain first. | M |
| `NopSCADlib/libtest.scad` | NopSCADlib (baseline) | Duplicate `_saved__fa` declaration | Transpiler bug. `statements.ts` now dedups special-var saves per block (`savedSpecialVars`), so this may already pass — re-test first. If still failing, the collision is across blocks sharing a scope suffix. | S–M |
| `examples/maze/rock_theta_maze.scad` | dotSCAD | 4 unseeded `rands()` in `rock()` | Add seeds per call (as in `dotscad-examples-seed-rands.patch`) | S |
| `examples/tiles/random_town_square.scad` | dotSCAD | Same `rock()` pattern + `tile_wfc` `rand()` | Seed example `rands()`; seed `tile_wfc.scad` / `_tiles_wfc_impl.scad` `rand()` | M |
| `examples/tiles/penrose_basket.scad` | dotSCAD | 1 unseeded `rands()` in a loop | Seed with loop index | S |
| `examples/differential_line_growth.scad` (`…_bowl.scad` is in `skip.txt` as a timeout on `main`) | dotSCAD | `node()` velocity `rands()` in `_differential_line_growth.scad` | Seed from position. Iterative simulation, so float drift may still sink Jaccard. | S patch / unknown pass |
| `examples/crystal_cluster.scad`, `examples/turtle/tree.scad`, `examples/voronoi/ruyi_pineapple.scad` | dotSCAD | Many `rand()` calls (10–20 each, some recursive) | Per-call seeds are invasive; see "sticky seed" note below | M |
| `examples/tiles/random_city.scad`, `examples/taiwan/random_city_taiwan.scad` | dotSCAD | `tile_w2e` (now seeded) + ~40 `rand()` calls in `city_tile.scad` | Same as above | M |

**Sticky-seed option.** OpenSCAD ≥ 2021.01 keeps the RNG state after a seeded
`rands()`, and `openscad-runtime/src/math.js` `_rands` does the same. A single
`_ = rands(0, 1, 1, 42);` at file top therefore makes the OpenSCAD reference
deterministic. The JSCAD output matches only if the transpiled code calls
`rands()` in the same order OpenSCAD evaluates them. `magic_apartment` already
relies on this: seeded `rands()` at line 22, then unseeded `rand()` calls.
`tetrapod_doll` has only unseeded calls in its own source but rendered
identically twice, so presumably a seeded library call runs first (not traced).
Both are in the tested set, so their CI results show whether call order is
preserved. Try this on `tree` / `crystal_cluster` before writing per-call
patches.

## P2

| Model | Suite | Reason skipped | Proposed fix |
|-------|-------|----------------|--------------|
| `examples/taiwan/SD_Card_Taiwan.scad` | dotSCAD | Mixed winding in reference; `compare-stl.js` auto-orient flips the whole mesh (Jaccard 0.174) | Harness: orient per shell (e.g. flip only inward-facing shells) instead of by total signed volume |
| `NopSCADlib/tests/belts.scad` | NopSCADlib | Jaccard ~0.973 — CDT triangulation differs in multi-contour twisted `linear_extrude` | Runtime: match OpenSCAD's twisted-extrude slicing/triangulation |
| `NopSCADlib/tests/shaft_couplings.scad` | NopSCADlib | Jaccard ~0.960 — step count for large-angle helical extrusions | Runtime: match OpenSCAD's slice count for large `twist` |
| `examples/spiral/spring_dog.scad` | dotSCAD | `shape_glued2circles.scad` missing | Upstream deleted it in dotSCAD `45d7490e` (2021-02, "clean deprecated modules/functions") but the example still uses it. Vendor `shape_glued2circles.scad` + `_impl` from `45d7490e^` as a fetch-deps patch. |
| `examples/spiral/climbing_rose.scad`, `examples/stereographic_projection/stereographic_foliage_scroll.scad` | dotSCAD | JSCAD timeout | Profile; `foliage_scroll` also has unseeded `rands()` in `_foliage_scroll_impl.scad` and needs a seed patch regardless |

## P3 — keep skipped

| Model | Suite | Reason |
|-------|-------|--------|
| `examples/fidget_ball_fern_leaf.scad` | dotSCAD | OOM |
| `NopSCADlib/tests/PCBs.scad` | NopSCADlib | Manifold WASM out-of-bounds (memory) |
| `examples/stereographic_projection/stereographic_chars.scad` | dotSCAD | Webdings font not available |
| `examples/voronoi/ripple_sphere.scad`, `examples/voronoi/voronoi_vase.scad` | dotSCAD | OpenSCAD reference is non-manifold; no valid comparison |
| `04-misc/Wood_Crate.scad` | snippet | OpenSCAD multi-colour export is non-manifold |
| `04-misc/Scene_Test.scad` | snippet | `Import_Library.scad` / `Asset_SCAD` not in the snippet corpus |

## Stale skip lists

These are not read by the comparison run, which scans
`apps/jscad-web/examples/openscad`. They list models that are no longer
skipped or no longer exist, and can be deleted:

- `packages/openscad/test/corpus/bosl2/skip.txt`: names (`torus.scad`,
  `dashed-stroke.scad`, `edge-profile.scad`, …) match no file under
  `apps/.../bosl2`. That corpus is regenerated from BOSL2 inline examples.
- `packages/openscad/test/corpus/snippet-skip.txt`: `Bricks`, `Shaft_01`,
  `Shaft_02_With_Keyway` and `text_basic` are in the tested set and pass
  per the baseline.

## Tooling

To run the transpiler, `compare-stl.js` and the GPU suite from a cloud
session, see `docs/CLOUD_SESSION.md`.
