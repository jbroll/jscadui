# Model Comparison Baseline

Verified 2026-04-06 — commit `4484e0e` on `hierarchical-params` (seeding patches for 40 dotSCAD models, CI guard in test-harness, run-jscad 30s timeout).

Similarity threshold: **0.99** (Jaccard index on vertex-deduplicated STL meshes).

## Summary

| Suite      | Total | Excluded | OpenSCAD fail | Skip list | Tested | Passed | Failed | Errors | Pass rate |
|------------|------:|--------:|--------------:|----------:|-------:|-------:|-------:|-------:|-----------|
| 01-basics  |    20 |       0 |             1 |         0 |     19 |     19 |      0 |      0 | **100%**  |
| BOSL v1    |   113 |       0 |            13 |         0 |    100 |    100 |      0 |      0 | **100%**  |
| BOSL2      |   178 |       0 |            25 |         0 |    153 |    153 |      0 |      0 | **100%**  |
| NopSCADlib |   149 |       4 |             1 |         4 |    144 |    144 |      0 |      0 | **100%**  |
| snippet    |   122 |       0 |            10 |         2 |    110 |    110 |      0 |      0 | **100%**  |
| text       |    11 |       0 |             9 |         0 |      2 |      2 |      0 |      0 | **100%**  |
| dotSCAD    |   212 |       0 |            28 |         3 |    181 |    112 |     58 |     11 | 61.9%     |

**Baseline suites** (01-basics, BOSL, BOSL2, NopSCADlib, snippet, text): any failure is a regression.

**dotSCAD**: new suite, no pass-rate baseline yet. Failures are not regressions.

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

### dotSCAD (3 skipped)

Previously 43 models were skipped as non-deterministic. 40 of those were made deterministic via seeding patches in `scripts/deps/patches/dotscad-*.patch`. The remaining 3 have complex unseeded `rands()` patterns not yet patched:

| Model | Reason |
|-------|--------|
| `examples/tiles/random_town_square.scad` | Multiple unseeded rand() calls, complex loop structure |
| `examples/tiles/penrose_basket.scad` | Multiple unseeded rand() calls, complex loop structure |
| `examples/voronoi/ruyi_pineapple.scad` | Multiple unseeded rand() calls |
