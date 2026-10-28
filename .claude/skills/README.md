# Printability skills (priority order)

JSCAD-native design-for-printing skills. Each emits parametric code and a
small test coupon first — never bare numbers. Printer operation (bed, temps,
flow, slicer tuning) is explicitly out; each skill carries CAD-side remedies
plus one `slicer-hints` appendix line at most.

1. `fit-clearance` — per-side vs total, hole/shaft compensation, coupon ladder. Foundation for all others.
2. `printability-design` — walls, overhangs, bridging, orientation, anisotropy, warp (CAD side).
3. `box-lid` — lip depth/clearance/corner relief, taper, compliant walls.
4. `snap-fit` — cantilever beam, fillet, hook angles, orientation, material.
5. `boss-insert-thread` — heat-set bosses, printed threads, screw towers.
6. `gears-meshing` — module, backlash, centre distance, involute, hubs.
7. `pip-hinge` — print-in-place hinges/joints, clearances, Z-pins, teardrops.
8. `dovetail-slider` — dovetails, tongue-groove, sliding rails.
9. `living-hinge` — thin flex webs, orientation, fatigue, break-in.
