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

## Summary

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
| `libtest.scad` | Includes all test modules — duplicate `_saved__fa` declaration |
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
