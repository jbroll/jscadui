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

## Latest GPU run: 2026-09-28, `%` under difference and groups

Branch `backlog-triage` (uncommitted on top of `44fb2814`), simple-ci job
`573bee0a90329510` (`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All
21 suites pass, counts unchanged.

`difference()` skips leading `%` children when picking its subject, and
`if`, `let`, `echo`, `assert`, and one-statement module bodies (a nested
`{ }` block or `children()`) wrap a child that can be a bare `%` placeholder
in `j$.group`. Across the 2502 example `.scad` files, 459 transpile
differently, and every difference is an inserted `j$.group(...)`, which only
changes a `%` placeholder. `preview-modifiers.test.ts` covers the cases.

Rebased onto `main` at `55c35325` (scale and `$fn` fixes), simple-ci job
`366aaa86dbc73a5f`: all 21 suites pass, counts unchanged.

## Previous GPU run: 2026-09-27, $fn below three or fractional

Branch `worktree-scale-circle-gaps` (uncommitted working tree), simple-ci job
`fca32d030aaa8258` (`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All
21 suites pass, counts unchanged from the run below.

A positive `$fn` gives `max(ceil($fn), 3)` segments, as OpenSCAD draws
`circle($fn=2)` as a triangle and `circle($fn=4.2)` with five sides. The
modeling `circle` and `cylinder` threw on fewer than three.

Both runtime changes were first verified on the pre-ghosts `main`. Rebased onto
`main` at `1aa65f82` (`%` and `#` ghosts), simple-ci job `06592dabe19d8c96`:
all 21 suites pass, counts unchanged.

## Previous GPU run: 2026-09-27, scale by zero or negative factors

Branch `worktree-scale-circle-gaps` (uncommitted working tree), simple-ci job
`7245f8926a12408e` (`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All
21 suites pass, counts unchanged from the run below.

`scale()` with a factor that is not positive now goes through a scaling
matrix instead of the modeling `scale`, which throws on it: a negative factor
mirrors, z is ignored for 2D, and a shape flattened to zero area or volume is
removed. On manifold only the zero case changes (it used to read 0 as 1). The
jscad engine is covered by the render sweep.

## Previous GPU run: 2026-09-27, `%` and `#` ghosts

Branch `work/next-20260927b` (Task 4 transpiler change uncommitted on top of
`867b47a8`), simple-ci job `5dddf64737577c73` (`sci push jscadui/test`),
OpenSCAD 2026.08.30.fp. All 21 suites pass, counts unchanged.

`%` and `#` children now emit `j$.background`/`j$.highlight`, and `main()`
ends in `j$.withOverlays`, which returns the ghosts beside the solid flagged
`previewOnly`. `run-jscad.js` drops them before grading, so nopscadlib stays
146/146 at `--preview`. The first run (job `3f565962746875fd`) errored on
openscad-tests `issue1833.scad`: an empty intersection of two `#` cubes left
`exportedGeometry` returning a one-element array that the caller unioned;
it now returns a lone solid unwrapped.

Re-run on `286b33f4` after the review fixes (a `%` subtree read through a
transform or a one-statement module is empty, not absent; ghosts merged per
kind), simple-ci job `4f6eb1bc2dae03a8`: all 21 suites pass, counts
unchanged. Rebased onto `main` with the modeling fork at `ff759668`
(clipper-lib), simple-ci job `cccfb8b177b85030`: all 21 suites pass, counts
unchanged.

## Previous GPU run: 2026-09-27, geom2 booleans on clipper-lib

Branch `work/brisk-otter-5ee7`, modeling fork pinned at `fork-main`
`ff759668`, simple-ci job `d23a6199b1e65866` (`sci push jscadui/test`),
OpenSCAD 2026.08.30.fp. All 21 suites pass, counts unchanged from the run
below.

The fork's geom2 `union`/`subtract`/`intersect` run on `clipper-lib` instead
of extruding to a 3D BSP. This suite grades the manifold engine, which uses the
fork's 2D booleans only for operands built from a jscad geom2, so no score
moved; the jscad engine is covered by the render sweep.

## Previous GPU run: 2026-09-27, hull block scope

Branch `worktree-next` (uncommitted working tree), simple-ci job
`386cc9acca2d691a` (`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All
21 suites pass, counts unchanged from the run below.

`$`-assignments in `hull()` child blocks use dynamic scope
(save/set/restore), as builtin-boolean blocks already do; before, they were
renamed consts that modules called in the block never saw. No graded model
covers it; `boolean-block-scope.test.ts` does.

## Previous GPU run: 2026-09-27, include order + BOSL2 echo grading

Branch `worktree-include-order` (uncommitted working tree), simple-ci job
`cdb147ae4240ce5c` (`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All
21 suites pass.

Included constants are now bundled in source order: a local assignment above
an `include` is evaluated before the included assignments. BOSL2's `std.scad`
sets `_BOSL2_STD` before its includes, so the ~30 "included without std.scad"
warnings the transpiled library echoed are gone, and `bosl2/echo-skip.txt` is
deleted. bosl2 goes 152 → 174 graded: the 22 BOSL2 models that only echo are
now graded on their echo() output and all match.

## Previous GPU run: 2026-09-27, duplicate-definition last-wins + empty minkowski + boolean block scope

Branch `work/library-bugs-20260927`, simple-ci job `6c80490b1d9b6a1a`
(`sci push jscadui/test`), OpenSCAD 2026.08.30.fp. All 21 suites pass
(bosl2 152 graded; the echo-grading change above landed separately).

Three fixes, all invisible to the graded suites (no graded model covers
them) and covered by unit tests instead: duplicate top-level
function/module definitions resolve last-wins, matching OpenSCAD (the
constructive library defines `set` twice; the bundler kept the first, so
`geomsOnly` merged with array-`set` semantics, `$geomInfo` lost every
entry, and `cart14-tensioner.scad` died on `TUBE():h is undefined` — it
now runs clean locally and grades 0.988 against the flatpak reference);
`$`-assignments in builtin-boolean child blocks use dynamic scope
(assemble()'s remove-pass `$removing = true` was a dead const, so
difference() emptied everything); `minkowski` with an empty operand
returns empty instead of a null-wrapping object that crashed downstream
ops (the r_union3 dilate-minkowski class). A fourth attempt, rendering `%`
background geometry at `$preview=true`, was reverted on this branch:
reference OpenSCAD excludes `%` from STL exports even at preview=true
(verified against the flatpak), while nopscadlib must grade at
preview=true for its `if($preview)` gates, so the conditional regressed
9 nopscadlib models (137/146 against a 146/146 clean-tree baseline on
the same host). Ghosting needs tagged geometry the STL path strips.

| Suite | Tested | Passed |
|-------|-------:|-------:|
| 01-basics | 21 | 21 |
| bosl | 113 | 113 |
| bosl2 | 152 | 152 |
| closepoints | 5 | 5 |
| constructive | 2 | 2 |
| dotscad | 175 | 175 |
| gears | 18 | 18 |
| gridfinity | 4 | 4 |
| list-comprehension-demos | 9 | 9 |
| mcad | 13 | 13 |
| nopscadlib | 146 | 146 |
| obiscad | 9 | 9 |
| openscad-examples | 34 | 34 |
| openscad-tests | 238 | 238 |
| relativity | 6 | 6 |
| round-anything | 10 | 10 |
| snippet | 115 | 115 |
| text | 2 | 2 |
| threadlib | 9 | 9 |
| threads-scad | 1 | 1 |
| yapp-box | 40 | 40 |

## Previous GPU run: 2026-09-27, assert/bitwise semantics + example children

Branch `claude/untrack-all-grids` (uncommitted working tree), simple-ci job
`af7399fb` (`sci push jscadui/test`), 8.6 min, OpenSCAD 2026.08.30.fp. All
21 suites pass.

Three transpiler semantics fixes, each exposed by the assert change that
precedes it: statement `assert()` now throws through `j$.assert` (it emitted
non-throwing `console.assert`), with the condition taken from `condition=`
when named and an error on a missing condition; bitwise `& | << >> ~` are
64-bit `j$.band/bor/shl/shr/bnot` helpers (JavaScript's are 32-bit and coerce
strings), with undef for non-numbers and shift counts outside [0, 64). The
bitwise file this unblocked, `bitwise-operators.scad`, now grades and passes,
so openscad-tests goes 233 → 238 tested. The example generator keeps module
children (`hsl(...) sphere(...)` no longer loses the sphere), so bosl2 goes
135 → 152 graded. `closepoints` tests 5:
`closepoints.scad` itself is the excluded library file.

| Suite | Tested | Passed |
|-------|-------:|-------:|
| 01-basics | 21 | 21 |
| bosl | 113 | 113 |
| bosl2 | 152 | 152 |
| closepoints | 5 | 5 |
| constructive | 2 | 2 |
| dotscad | 175 | 175 |
| gears | 18 | 18 |
| gridfinity | 4 | 4 |
| list-comprehension-demos | 9 | 9 |
| mcad | 13 | 13 |
| nopscadlib | 146 | 146 |
| obiscad | 9 | 9 |
| openscad-examples | 34 | 34 |
| openscad-tests | 238 | 238 |
| relativity | 6 | 6 |
| round-anything | 10 | 10 |
| snippet | 115 | 115 |
| text | 2 | 2 |
| threadlib | 9 | 9 |
| threads-scad | 1 | 1 |
| yapp-box | 40 | 40 |

## Previous GPU run: 2026-09-27, text-only fixes + CI rsync fix

Branch `fix/text-only-is-let-skips`, simple-ci job `660559e1` (`sci push
jscadui/test`), 8.9 min, OpenSCAD 2026.08.30.fp. All 21 suites pass.

Nineteen text-only models unskipped since the previous run (single-arg
builtin arity, `let()` duplicates, `lookup`/`min`/`max`/`cross`/`chr`
guards, `each` over scalars, bitwise ops, right-associative `^`, top-level
`children()`, tail-scope bounces, latin-1/NBSP sources), so openscad-tests
goes 214 → 233 tested. This run also fixes `ci/simple-ci.conf`: the rsync
filter dropped `skip.txt`/`compare-skip.txt`/`echo-skip.txt`/`exclude.txt`
for suites without explicit `--include` coverage, so `sci push` jobs graded
hundreds of models the PR channel skips.

| Suite | Tested | Passed |
|-------|-------:|-------:|
| 01-basics | 21 | 21 |
| bosl | 113 | 113 |
| bosl2 | 135 | 135 |
| closepoints | 6 | 6 |
| constructive | 2 | 2 |
| dotscad | 170 | 170 |
| gears | 18 | 18 |
| gridfinity | 4 | 4 |
| list-comprehension-demos | 9 | 9 |
| mcad | 13 | 13 |
| nopscadlib | 145 | 145 |
| obiscad | 9 | 9 |
| openscad-examples | 32 | 32 |
| openscad-tests | 233 | 233 |
| relativity | 6 | 6 |
| round-anything | 10 | 10 |
| snippet | 115 | 115 |
| text | 2 | 2 |
| threadlib | 9 | 9 |
| threads-scad | 1 | 1 |
| yapp-box | 40 | 40 |

## Previous GPU run: 2026-09-26, inverted polyhedra

Commit `9f1c04a` (branch `claude/eager-brahmagupta-wcnzjm`, jbroll/jscadui#117),
simple-ci job `395a9882cc22e4be`, 9.0 min. All 21 suites pass.

`dotscad-reverse-inverted-polyhedra.patch` reverses the faces of the `chair`
(chair_score) and `SD_Mountain` (SD_Card_Taiwan) polyhedra. Their faces were
wound inside-out, which OpenSCAD's Manifold backend keeps, so the references
were wrong. Both models left `dotscad/compare-skip.txt` and pass, so dotSCAD
grades 170 instead of 168 (see `SKIP_BACKLOG.md`).

| Suite | Tested | Passed | Tested before (b9f5272) |
|-------|-------:|-------:|------------------------:|
| 01-basics | 21 | 21 | 21 |
| bosl | 113 | 113 | 112 |
| bosl2 | 135 | 135 | 135 |
| closepoints | 5 | 5 | 5 |
| constructive | 2 | 2 | 2 |
| dotscad | 170 | 170 | 168 |
| gears | 18 | 18 | 18 |
| gridfinity | 4 | 4 | 4 |
| list-comprehension-demos | 9 | 9 | 9 |
| mcad | 13 | 13 | 13 |
| nopscadlib | 145 | 145 | 145 |
| obiscad | 9 | 9 | 9 |
| openscad-examples | 32 | 32 | 32 |
| openscad-tests | 214 | 214 | 214 |
| relativity | 6 | 6 | 6 |
| round-anything | 10 | 10 | 10 |
| snippet | 115 | 115 | 114 |
| text | 2 | 2 | 2 |
| threadlib | 9 | 9 | 9 |
| threads-scad | 1 | 1 | 1 |
| yapp-box | 40 | 40 | 40 |

BOSL (113) and snippet (115) each grade one more model than in the `b9f5272`
run without a change for them in this commit; the PR comment does not name
which.

## Previous GPU run: 2026-09-26, echo grading

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

## GPU run: 2026-09-26, before echo grading

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
