# LEGO examples design

Date: 2026-10-02. Status: approved section by section in chat.

## Goal

Add LEGO bricks to both example trees (`apps/jscad-web/examples/openscad/` and
`apps/jscad-web/examples/jscad/`) with per-variant files so the generated
`ALL.js` grids show the full capability of each library. This phase stops at
examples; it sets up the later parts-catalog admission without doing it.

Approach: manifest-first. Upstream is `https://github.com/jbroll/LEGO.js.git`
(local checkout at `~/src/lego.js`). No vendoring by hand; files arrive through
the documented `scripts/deps/manifest.json` + `fetch-deps` procedure.

## 1. Manifest entry

New `lego` dep in `scripts/deps/manifest.json`:

- url `https://github.com/jbroll/LEGO.js.git`, pinned to current HEAD
  (`5c0080e`), license MIT (upstream `LEGO.scad` header is MIT-style).
- Mappings copy `LEGO.scad` and `LEGO-Angle-Plate.scad` to
  `examples/openscad/lego/` and to `apps/jscad-web/libs/LEGO/`; `lego.js` to
  the location the JSCAD variants require it from.
- The `/libs/` mapping is for the later parts phase (`file` is relative to
  `/libs/`); it costs nothing now. Later pin moves follow the existing
  `sci push jscadui/parts` procedure.

## 2. SCAD side

`examples/openscad/lego/` holds the two fetched library files plus `examples/`
with one thin wrapper per capability: brick, tile, wing, slope, curve (concave
and convex), baseplate (plain and roadway), round, duplo, angle-plate,
technic-hole brick. No composed scene (deliberately excluded: CSG-heavy, slow
grid cell; the per-type files cover all capabilities).

Each wrapper is a few lines: `use <LEGO.scad>` (or the angle-plate file) plus
one `block(...)` call with representative args (2x4 brick, 2x4 slope, etc.).
Resolution order (including file dir, then library root) already supports this.

An `exclude.txt` hides `LEGO.scad` and `LEGO-Angle-Plate.scad` from the grid
and demo browser (gears/threadlib pattern). New files need no registration:
the generator, execution test, and demo manifest pick them up. A wrapper that
fails to render goes in `skip.txt`, not deleted.

## 3. JSCAD side

One file per variant in `examples/jscad/`, each requiring the fetched `lego.js`
and calling `block()` with fixed args: standard brick (2x4), plate (2x4,
height 1/3), tile (2x3), baseplate (8x8), hollow-stud brick,
Technic-hole brick, axle-hole plate. Each file exports
`{ main, getParameterDefinitions }` so it runs under the examples test
harness.

Explicit non-goal: wing/slope/curve/round/DUPLO have no JSCAD variant because
`lego.js` implements only brick/tile/baseplate. They are SCAD-only until a
port lands.

## 4. Grids and verification

No hand-written grid code. `npm run generate-all` from the root (passes
`--no-rename`; never run the generator without it) regenerates `ALL.js` at
every level: the `lego` sub-grid under `openscad/ALL.js`, new cells under
`jscad/ALL.js`. `ALL.js` files are never hand-edited.

Verification: `npm run test:examples` (every example loads, `main` runs,
params validate), a single-file transpile check of one wrapper, and the new
`.scad` files enter GPU comparison grading automatically (Jaccard > 0.99 vs
OpenSCAD+Manifold). Never run the full comparison suite locally.

## 5. Parts follow-up boundary

Out of scope: catalog records, `derived.json`, thumbs, agent docs. This design
unlocks that phase: library files already deployed under `/libs/LEGO/`,
renders already graded green, so admission is record JSON only
(`catalog/lego/brick.json` etc. with `sizes`, `checks` bounding boxes against
the 8/9.6 mm standard, `example`), then the standard check, render, thumbnail
review, `preferred` flow.
