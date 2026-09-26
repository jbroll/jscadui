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
| `examples/crystal_cluster.scad` | dotSCAD | `dotscad-sticky-seed-examples.patch`: one seeded `rands()` at file top | identical after |
| `examples/turtle/tree.scad` | dotSCAD | same patch | identical after |
| `examples/tiles/random_town_square.scad` | dotSCAD | same patch | identical after |
| `examples/maze/rock_theta_maze.scad` | dotSCAD | same patch, plus runtime fixes: `rands()` count is `trunc(\|count\|)`; ranges allow one ULP of slack, not ~8 | identical after |
| `examples/tiles/penrose_basket.scad` | dotSCAD | same patch, plus `hull() polyhedron(...)` of an open (single-face) mesh now hulls its vertices | identical after |
| `examples/voronoi/ruyi_pineapple.scad` | dotSCAD | same patch | identical after |
| `examples/tiles/random_city.scad` | dotSCAD | same patch | identical after |
| `examples/taiwan/random_city_taiwan.scad` | dotSCAD | same patch | identical after |
| `examples/taiwan/chair_score.scad` | dotSCAD | `dotscad-reverse-inverted-polyhedra.patch`: the `chair` polyhedron's faces wind the wrong way, so OpenSCAD rendered 450 inside-out chairs (reference signed volume 0.24M instead of 7.86M; was Jaccard 0.0537). The patch reverses each face. | deterministic before and after (`rand()` only feeds `color()`) |
| `examples/taiwan/SD_Card_Taiwan.scad` | dotSCAD | same patch (`SD_Mountain`; was Jaccard 0.174) | deterministic |

Single-model runs (2026-09-26, cloud session, OpenSCAD 2026.09.23 nightly,
`test-harness.js --no-stl-cache`): all above **PASS (1.0000)** except
`penrose_basket` **PASS (0.9976)**, as does `hollow_out_torus`.

**Inverted polyhedra.** OpenSCAD takes polyhedron faces as clockwise seen from
outside and does not repair the reverse. A reversed polyhedron that takes part
in no boolean is exported inside-out by both backends. In a boolean, CGAL
comes out correctly oriented, while Manifold (the harness's backend) carries
the inverted shell along and gives wrong volumes where it overlaps other
solids. Our `_polyhedron` always corrects the orientation, which matches CGAL.
Fix the source when a reference is inverted, rather than the comparison.
`chair_score` and `SD_Card_Taiwan` both score **1.000000** with the patch. The full
suite on the GPU host has not run yet; the `rands()` count and range changes
affect every suite, so its result matters beyond these models.

Side effect: `examples/hollow_out/hollow_out_torus.scad` is in the tested set
and uses the same `hollow_out_square()`; its reference was one of two random
variants. It is now deterministic, so its CI result may change (either way).

If any P0 model fails on CI, re-add it to `dotscad/compare-skip.txt` with the measured
Jaccard, but keep the seed patch: the patch alone makes the reference
reproducible.

## P1

| Model | Suite | Reason skipped | Proposed fix | Effort |
|-------|-------|----------------|--------------|--------|
| `examples/differential_line_growth.scad` (`…_bowl.scad` is in `skip.txt` as a timeout on `main`) | dotSCAD | Deterministic since the sticky-seed patch (two renders identical), but Jaccard **0.9803** | Iterative simulation; find the first step where JSCAD and OpenSCAD node positions diverge. | M |

**Sticky seed (used by `dotscad-sticky-seed-examples.patch`).** OpenSCAD ≥ 2021.01 keeps the RNG state after a seeded
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
| `NopSCADlib/tests/belts.scad` | NopSCADlib | Jaccard 0.9820 (was ~0.973). Not the extrusion: see **belts** below | `compare-stl.js`: read a mesh whose touching bodies share edges without losing volume, or find why our union leaves those faces apart |
| `examples/spiral/spring_dog.scad` | dotSCAD | `shape_glued2circles.scad` missing | Upstream deleted it in dotSCAD `45d7490e` (2021-02, "clean deprecated modules/functions") but the example still uses it. Vendor `shape_glued2circles.scad` + `_impl` from `45d7490e^` as a fetch-deps patch. |
| `examples/spiral/climbing_rose.scad`, `examples/stereographic_projection/stereographic_foliage_scroll.scad` | dotSCAD | JSCAD timeout | Profile; `foliage_scroll` also has unseeded `rands()` in `_foliage_scroll_impl.scad` and needs a seed patch regardless |

**linear_extrude (2026-09-26).** The runtime now builds twisted, scaled and
slanted (`v`) extrusions as OpenSCAD does (`openscad-runtime/src/linearExtrude.js`,
ported from `LinearExtrudeNode.cc`, `linear_extrude.cc`, `CurveDiscretizer.cc`):
the same slice count, edge splits and quad diagonals, plus OpenSCAD's argument
rules (`h`, `v`, default height 100, `scale` only as a number or 2-vector,
`center` only when boolean, integral `slices`/`segments`). Positional arguments
follow OpenSCAD's order `height, v, scale, center, twist, slices, segments`.
Single-model runs: `openscad-tests` `linear_extrude-tests` 0.4266 → 1.0000,
`linear_extrude-parameter-tests` 0.3404 → 1.0000, `linear_extrude-scale-zero-tests`
0.8316 → 0.9972; `openscad-examples` `Basics/linear_extrude` 0.8732 → 0.9988.
All four are off the compare-skip lists.

**shaft_couplings** was not a slice-count problem. NopSCADlib writes
`square(radius - r1, 1)`; OpenSCAD centers `square`, `cube` and `cylinder` only
when `center` is a boolean, and the runtime centered on any truthy value. Fixed;
the model scores 1.0000 and is off the list.

**belts.** Split into its parts, the straight runs and the arcs each score
1.0000, and the triangles of our STL have the reference's signed volume to 2e-6
(9695.398 vs 9695.414). Together they score 0.925: our STL has 586 edges shared
by four triangles where the tooth and back bodies meet, where the reference has
only two-triangle edges, and `compare-stl.js`'s whole-mesh `Manifold.ofMesh`
reads it as 8969.5. Rejecting a whole-mesh result whose volume disagrees with
the signed volume is not enough: `splitIntoComponents` keeps the touching
bodies together. Why our union leaves those faces apart is not traced (a
plane computed two ways, one ulp apart, is the likely cause).

## P3 — keep skipped

| Model | Suite | Reason |
|-------|-------|--------|
| `examples/fidget_ball_fern_leaf.scad` | dotSCAD | OOM |
| `NopSCADlib/tests/PCBs.scad` | NopSCADlib | Manifold WASM out-of-bounds (memory) |
| `NopSCADlib/libtest.scad` | NopSCADlib | The duplicate `_saved__fa` declaration is gone (2026-09-26: transpiles and runs), but after ~2.5 min it hits the same Manifold WASM out-of-bounds as `PCBs.scad`. Its `skip.txt` reason is stale. |
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
