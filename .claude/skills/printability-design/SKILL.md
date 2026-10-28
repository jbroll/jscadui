---
name: printability-design
description: Design walls, overhangs, bridges, orientation and base geometry so FDM parts print without supports and resist warp. Use for any new part before detailing fits or joints.
---

# Printability design (CAD side)

Consumes `fit-clearance` globals. Emits CAD remedies only; slicer/bed/temperature stay non-goals (one hint line max).

## Walls and minimums (0.4mm nozzle)

- Structural walls >= 1.2mm (3 perimeters); cosmetic min 0.8. Design in nozzle multiples.
- Thin arms/clips/teeth: 4-5 perimeters so the section prints solid, not infill.
- Min pin 2mm; min hole 2mm; min engraved width 0.5 / embossed text depth 0.5, >= 8pt sans.
- Printed threads >= M8 coarse only; below that use inserts (see `boss-insert-thread`).

## Overhangs: the 45-degree rule

Every layer must land on the previous one or a support. Keep overhangs <= 45 from vertical:

- Chamfer horizontal undersides at 45 instead of flat shelves.
- Sideways round holes: teardrop top (two 45 slopes) or flat across the top + ~0.1 extra. Top of a sideways hole is a bridge and sags.
- Tilt the part so critical faces end up on top; split and reassemble rather than support.
- No supports inside moving clearances ever (scars lock joints); use support blockers if the slicer adds them.

## Bridging

Short unsupported spans print in tension. Reliable limits: PLA 50-60mm, PETG ~40, ABS ~30-35, nylon ~30. Beyond that add a rib, an intermediate wall, or split the part.

## Orientation and anisotropy

Inter-layer bond is 40-60% of strand strength. Bend and load in the XY plane:

- Snap arms, hinge pins, cantilevers print lying flat, never standing.
- Pins that must stand: raise perimeters to 3-4 and add 0.5 x 45 chamfers at shoulders.
- Round vertical holes (Z axis) are truest; horizontal holes go oval.

## Warp (CAD side)

- Fillet all bottom corners >= 1mm radius (sharp inside corners start warp and cracks).
- Keep thin-wall height:base below 8:1; avoid large flat bottom faces or rib underneath.
- Bottom-edge chamfer 0.5-1.0 x 45 as elephant-foot relief so the first-layer squish doesn't eat mating gaps.
- Slicer hint (not owned): elephant-foot comp 0.1-0.2, brim kept 0.20-0.25 away from moving edges.

## Verify

`measure`/`check` the build report: watertight, manifold, wall multiples, overhang scan, bridge spans, first-layer footprint vs mating faces. Print a 15-minute section coupon of the risky feature before the full part.

## Sources

- layerx3d.in/blog/fdm-design-rules-wall-thickness-overhangs-bridging-tolerances
- 1c3d.com/howtos/designing-parts-for-3d-printing-tolerances-overhangs-supports-and-design-rules
- sovol3d.com print-in-place guide (orientation, bridging, chamfers)
