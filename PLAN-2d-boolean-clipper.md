# 2D boolean via 3D BSP — investigation summary and clipper plan

Worktree: `.worktrees/brisk-otter-5ee7`, branch `work/brisk-otter-5ee7`, from `main` @ `b21bdcf8`.
Status: investigation (systematic-debugging Phases 1–2) done. No code changed.

## Problem (docs/backlog.md, "The jscad engine")

25 models extrude a geom2 whose sides do not close. `unionGeom2`/`subtractGeom2`/`intersectGeom2`
extrude operands into `to3DWalls` open prisms, run the 3D BSP, and read sides back via
`fromFakePolygons`. The wall set the BSP returns does not form closed loops before any
snapping happens. Backlog hypothesis: parallel wall planes closer than the BSP's absolute
`EPS` (1e-5) cannot be resolved, and tolerance tweaks only move the failure
(`EPS` 1e-9 takes the 24-way `horiholes` union 76→40 unmatched, not zero).

## Evidence gathered (this worktree)

- `geom2-trace.js horiholes.scad --engine jscad --preview`: 21 open geom2 results. First is a
  24-way union: 824 sides in, 820 out, 16 dangling vertices, partners ~1.6 epsilon apart.
- Pairwise scan of the 24 dumped operands (`--dump /tmp/horiholes-dump.json`): pairs (1,2),
  (2,3), (21,22), (22,23) each union to an open result. Pair 1+2: 68 in, 68 out, 4 dangling,
  partners exactly 3.0 epsilon apart (6.56e-5).
- 3D output inspection (pair 1+2): the BSP keeps both a slanted wall fragment
  (plane `[-0.098,-0.995,0,…]`) and a flat wall (`[0,-1,0,…]`) with a 6.5e-5 gap. Nothing
  vanishes here; the union leaves a sliver gap instead of merging near-coincident walls.
- Epsilon-grid snapping + `closeOpenVertices` adjacent-cell repair cannot join a 3-epsilon
  gap by design: `fromFakePolygons.js` (fork @ `bf7d77f2`) deliberately repairs only
  unbalanced vertices in neighboring cells, since moving farther points perturbs the next
  boolean's input.
- Same model on manifold engine: **0 open geom2 results**. `CrossSection.union` already
  decides these cases correctly. But `packages/manifold/src/booleans/index.js`
  (`union2D`/`subtract2D`/`intersect2D`) routes any input with `hasJscadSource` back through
  the JSCAD BSP path, so both engines are exposed.

## Decision

Sweep-line clipper with exact predicates, implemented as a **pure-JS dependency in the
modeling fork** (`~/src/OpenJSCAD.org`, currently on `fix/offset-degenerate-outline`),
replacing the `to3DWalls` → `*Geom3` → `fromFakePolygons` pipeline in `unionGeom2.js`,
`subtractGeom2.js`, `intersectGeom2.js`. Rejected alternative: routing all 2D booleans
through manifold `CrossSection` (would make the WASM-free jscad engine depend on WASM).

## Plan

1. **Evaluate libs** (done). Constraint: no heavy dependencies. Measured (esbuild, minified):

   | lib | min / gz | deps | 24-way horiholes union |
   |---|---|---|---|
   | `polygon-clipping` 0.15.7 (2023) | 29 KB / 9.6 KB | `robust-predicates`, `splaytree` | 16 rings, 0 holes, area 29.464640356 |
   | `clipper-lib` 6.4.2 (2022) | 98 KB / 25.5 KB | none | 16 rings, 0 holes, area 29.464640362 |
   | `clipper2-ts` 2.0.1-18 | 119 KB / 32 KB | none | wrong: 2 spurious triangle holes covered by operands 11/12 |

   Pair 1+2: all three give one closed ring. Fuzz (2000 trials, 2–7 rotated rects offset
   1e-7..1e-4, angle jitter 1e-5): `polygon-clipping` vs `clipper-lib` at 1e9 scale, 0 throws,
   0 area mismatches > 1e-6, 0 slivers. Leading choice: `polygon-clipping` (smallest, floats
   with exact predicates, no quantization scale to pick).
2. **Spike in this worktree**: union the dumped `/tmp/horiholes-dump.json` operands
   (24-way + minimal pairs) with the chosen lib; verify closed outlines and compare
   against `geom2-trace.js --preview` (expect 21→0 opens) and `wire.scad` (119→89 wall-loss
   case from the backlog).
3. **Integrate in the fork**: new `src/operations/booleans/geom2Clipper.js` (sides ↔ rings
   conversion, one entry per op) + rewrite the three `*Geom2.js` files; keep `to3DWalls.js`
   / `fromFakePolygons.js` until nothing references them. Fork conventions per
   `packages/modeling/CLAUDE.md`: one function per file, AVA test + `.d.ts`, `const` arrow
   functions. Note `geom2` sides are unordered `[from,to]` segments; rings must be
   reconstructed (outlines) before clipping and re-emitted after.
4. **Verify**: fork `npx ava src/operations/booleans/` + jscadui `packages/openscad`
   `npx vitest run`; single-model `run-jscad.js` on `horiholes.scad`, `wire.scad`,
   `blowers.scad`; full comparison only via GPU (`npm test` from a local session).
5. **Land**: commit in the fork, bump the pin in jscadui `scripts/deps/sources.json`
   (+ manifest), delete the corresponding backlog section in the landing commit.

## Open questions

- Ring reconstruction: does `geom2.toOutlines` (or equivalent) reliably order sides for
  all 23 affected models, or does the clipper layer need its own chaining?
- Epsilon strategy at the clipper boundary: exact-predicate clipper on raw floats vs
  scaled-integer quantization — spike must test the 7.5e-6 wall-pair band explicitly.
- `hasJscadSource` routing in `packages/manifold`: stays as-is (still correct, just no
  longer broken), unless the fork fix changes the performance tradeoff.
