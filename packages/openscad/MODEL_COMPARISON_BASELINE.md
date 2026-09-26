# Model Comparison Baseline

Verified 2026-04-08 — commit `6ab37c1` on `hierarchical-params` ($-var let binding: wrap subsequent bindings + body in withScope).
MCAD suite GPU-verified 2026-04-08 — 12/14 examples pass.

Re-measured 2026-09-21 on CI job `4832f00b7aa7c3fd` with OpenSCAD 2026.08.30.fp
(the flatpak the CI user can run; the 2026-04 numbers were taken against an
older build). dotSCAD went to 147/160 and MCAD to 13/14. NopSCADlib's
`box.scad` drops to 0.1499 against this OpenSCAD and does so on `main` as well,
so it is a reference-version difference, not a transpiler regression.
01-basics gained `preview-gate.scad`. snippet gained two files that now parse
and a third that can reach its `Asset_SCAD/` includes. Pointing CI at the
`fork-main` modeling checkout changed no score at all (see
`apps/jscad-web/e2e/RENDER-TESTING.md` on which modeling code a run measures).

Similarity threshold: **0.99** (Jaccard index on vertex-deduplicated STL meshes).

## Latest GPU run: 2026-09-26, echo grading

Commit `b9f5272` (branch `claude/intelligent-brown-fbivac`, jbroll/jscadui#116),
simple-ci job `47aa71e6d3b99c02`, 8.3 min, OpenSCAD 2026.08.30.fp. All 21
suites pass.

From this run the harness also compares each model's `echo()` output with
OpenSCAD's, and a model whose OpenSCAD top level is empty is graded on its
echo output alone instead of being NOT GRADED (see TESTING.md). That is most
of the growth in "Tested": the text-only models of each suite, e.g. most of
`openscad-tests/scad/functions` and `misc`, BOSL's function examples and
relativity's `*.test.scad`. Models that stop on an OpenSCAD `ERROR:` (failed
assert, recursion limit) stay NOT GRADED. Known mismatches are in each
suite's `skip.txt` / `compare-skip.txt`, and `echo-skip.txt` for models
whose geometry is graded but whose echo output is not compared yet (all of
BOSL2, MCAD `shapes_3d`, openscad-tests `search-tests`).

| Suite | Tested | Passed | Tested before (18de519) |
|-------|-------:|-------:|------------------------:|
| 01-basics | 21 | 21 | 20 |
| bosl | 112 | 112 | 95 |
| bosl2 | 135 | 135 | 135 |
| closepoints | 5 | 5 | 5 |
| constructive | 2 | 2 | 1 |
| dotscad | 168 | 168 | 160 |
| gears | 18 | 18 | 18 |
| gridfinity | 4 | 4 | 4 |
| list-comprehension-demos | 9 | 9 | 8 |
| mcad | 13 | 13 | 13 |
| nopscadlib | 145 | 145 | 144 |
| obiscad | 9 | 9 | 9 |
| openscad-examples | 32 | 32 | 30 |
| openscad-tests | 214 | 214 | 144 |
| relativity | 6 | 6 | 1 |
| round-anything | 10 | 10 | 10 |
| snippet | 114 | 114 | 113 |
| text | 2 | 2 | 2 |
| threadlib | 9 | 9 | 9 |
| threads-scad | 1 | 1 | 1 |
| yapp-box | 40 | 40 | 39 |

BOSL graded 113 in the first runs on this branch and 112 once the reference
run pinned `$preview=false`; the model OpenSCAD 2026.08.30.fp no longer
grades is not named in the PR comment (single-model runs with OpenSCAD
2026.09.23 grade all 113).

## Previous GPU run: 2026-09-26

Commit `18de519` (branch `claude/great-clarke-t6v3uc`, jbroll/jscadui#115),
simple-ci job `6e7d5c6b6d2d3c95`, 8.5 min. All 21 suites pass. Models that
render but that the comparison can't grade are in each suite's
`compare-skip.txt` and are not counted as tested, so "Tested" here is lower
than in the 2026-09-21 table below for suites that have one. The PR comment
gives only these two columns; the other columns are in the full log on the
GPU host.

| Suite | Tested | Passed |
|-------|-------:|-------:|
| 01-basics | 20 | 20 |
| bosl | 95 | 95 |
| bosl2 | 135 | 135 |
| closepoints | 5 | 5 |
| constructive | 1 | 1 |
| dotscad | 160 | 160 |
| gears | 18 | 18 |
| gridfinity | 4 | 4 |
| list-comprehension-demos | 8 | 8 |
| mcad | 13 | 13 |
| nopscadlib | 144 | 144 |
| obiscad | 9 | 9 |
| openscad-examples | 30 | 30 |
| openscad-tests | 144 | 144 |
| relativity | 1 | 1 |
| round-anything | 10 | 10 |
| snippet | 113 | 113 |
| text | 2 | 2 |
| threadlib | 9 | 9 |
| threads-scad | 1 | 1 |
| yapp-box | 39 | 39 |

This run added eight dotSCAD models to the tested set (sticky RNG seed plus
the `rands()` count, range-length and `hull() polyhedron` fixes; see
`SKIP_BACKLOG.md`): crystal_cluster, turtle/tree, tiles/random_town_square,
maze/rock_theta_maze, tiles/penrose_basket, voronoi/ruyi_pineapple,
tiles/random_city and taiwan/random_city_taiwan.

## Summary (2026-09-21)

| Suite      | Total | Excluded | OpenSCAD fail | Skip list | Tested | Passed | Failed | Errors | Pass rate |
|------------|------:|--------:|--------------:|----------:|-------:|-------:|-------:|-------:|-----------|
| 01-basics  |    21 |       0 |             1 |         0 |     20 |     20 |      0 |      0 | **100%**  |
| BOSL v1    |   113 |       0 |            13 |         0 |    100 |    100 |      0 |      0 | **100%**  |
| BOSL2      |   178 |       0 |            25 |         0 |    153 |    153 |      0 |      0 | **100%**  |
| NopSCADlib |   149 |       4 |             1 |         4 |    144 |    143 |      1 |      0 | **99.3%** |
| snippet    |   122 |       0 |             8 |         2 |    112 |    112 |      0 |      0 | **100%**  |
| text       |    11 |       0 |             9 |         0 |      2 |      2 |      0 |      0 | **100%**  |
| dotSCAD    |   212 |       0 |            28 |        24 |    160 |    147 |     13 |      0 | **91.9%** |
| MCAD       |    15 |       0 |             0 |         1 |     14 |     13 |      1 |      0 | **92.9%** |

**Baseline suites** (01-basics, BOSL, BOSL2, NopSCADlib, snippet, text): any failure is a regression.

**dotSCAD**, **MCAD**: new suites, no pass-rate baseline. Failures are not regressions.

## Column definitions

- **Total** — .scad files discovered in suite directory (after exclude patterns).
- **Excluded** — files matching `exclude.txt` patterns (library source, debug files).
- **OpenSCAD fail** — models that fail in OpenSCAD itself (syntax errors, missing deps, etc.). Skipped automatically.
- **Skip list** — models in `skip.txt` with known non-transpiler issues (OOM, non-manifold STL, etc.).
- **Tested** — models compared: Total − Excluded − OpenSCAD fail − Skip list.
- **Passed/Failed/Errors** — comparison result (Failed = below threshold, Error = crash).

## Skip list details

### NopSCADlib (4 skipped)

| Model | Reason |
|-------|--------|
| `libtest.scad` | Includes all test modules — Manifold WASM out-of-bounds (memory), as `PCBs.scad`. The duplicate `_saved__fa` declaration it used to hit is fixed. |
| `PCBs.scad` | WASM out-of-bounds — model too large for Manifold WASM memory |
| `belts.scad` | Jaccard ~0.973 — CDT triangulation difference in twisted extrusions |
| `shaft_couplings.scad` | Jaccard ~0.960 — step count difference for large-angle helical extrusions |

### snippet (2 skipped)

| Model | Reason |
|-------|--------|
| `Scene_Test.scad` | Missing `Import_Library.scad` / `Asset_SCAD` dependencies |
| `Wood_Crate.scad` | OpenSCAD exports non-manifold multi-color STL; cannot compare volumes |

## Exclude patterns

Excludes remove library source directories and non-test files from discovery.

- **BOSL / BOSL2**: `lib/` (library source)
- **NopSCADlib**: `NopSCADlib/vitamins/`, `NopSCADlib/printed/`, `NopSCADlib/utils/`, core files, debug `.scad` files
- **dotSCAD**: `__comm__/`, `_impl/`, and 15 internal module directories
- **MCAD**: `/*.scad` (root library files), `bitmap/` (bitmap utilities — not standard shape tests)

### MCAD (1 skipped)

| Model | Reason |
|-------|--------|
| `teardrop_test.scad` | Uses `projection()` built-in — not yet implemented in transpiler |

### MCAD (2 known failures — geometry mismatches)

| Model | Jaccard | Notes |
|-------|---------|-------|
| `hardware_test.scad` | ~0.91 | Geometry difference in rod/screw assembly |
| `involute_gear.scad` | ~0.83 | Involute gear tooth profile difference |

### dotSCAD (24 skipped)

See `apps/jscad-web/examples/openscad/dotscad/skip.txt` for the full annotated list.
Categories: unseeded `rands()` (non-deterministic geometry), missing dependency, OOM, timeout, non-manifold reference STL, mixed-winding polyhedron, unavailable font.

Previously 43 models were skipped as non-deterministic. 40 of those were made deterministic via seeding patches in `scripts/deps/patches/dotscad-*.patch`. The remaining non-deterministic and other problematic models are in skip.txt.

### dotSCAD (14 known failures — geometry mismatches)

| Model | Jaccard | Notes |
|-------|---------|-------|
| `voronoi_sphere.scad` | ~0.27 | Complex polyhedron topology difference (sweep + polyline_join) |
| `text_box.scad` | ~0.87 | Text rendering + box_extrude geometry difference |
| `trefoil_klein_bottle.scad` | ~0.81 | path_extrude geometry difference |
| `bunny_frame.scad` | ~0.94 | Near-miss — CDT triangulation difference |
| `emoticon_moai.scad` | ~0.95 | Near-miss — CDT triangulation difference |
| `TaiwaneseBlackBear.scad` | ~0.96 | Near-miss — CDT triangulation difference |
| `hollow_out_torus.scad` | ~0.96 | Near-miss — CDT triangulation difference |
| `dragon_head.scad` | ~0.98 | Near-miss — CDT triangulation difference |
| `fourier_vase.scad` | ~0.98 | Near-miss — CDT triangulation difference |
| `chrome_dino.scad` | ~0.98 | Near-miss — CDT triangulation difference |
| `delaunay_fibonacci.scad` | 0.9296 | Near-miss — CDT triangulation difference |
| `floor_stand_text.scad` | ~0.98 | Near-miss — text geometry difference |
| `voronoi_holder.scad` | ~0.99 | Near-miss — CDT triangulation difference |
| `penrose_crystallization.scad` | ~0.99 | Near-miss — CDT triangulation difference |
