---
name: living-hinge
description: Design thin flex webs that survive thousands of bends — web thickness, orientation along layers, material choice and break-in. Use for flip caps, cases and packaging that bend instead of jointing.
---

# Living hinges

Consumes `fit-clearance` and `printability-design`. Related: `pip-hinge` for pinned rotation; this skill is for bending plastic itself.

## Web geometry

- Thin central web (typically 0.3-0.8mm for FDM PLA/PETG, tuned per filament) with generous blend radii into both leaves; sharp transitions crack first fold.
- Hinge axis in the XY plane: orient so bending runs along layer lines, never across Z layer bonds.
- Keep the web short along the bend and long across the width for even flex; support both leaves flat on the bed where possible.

## Material

- PETG/PP/co-polyester for hundreds-thousands of cycles; PLA for prototypes and single-digit folds (stiff, fatigues, creeps under held load).
- Nylon (SLS PA12 ideal; FDM must print dry) for production-grade 10k+ cycles.
- Anneal/cooled break-in: flex gently to full range a few times after full cool-down; stop at first whitening and thicken.

## Coupon first

Single-hinge strip, not the product. Cycle target 20-30 folds for PETG latches, more for production claims. Whitening = too thin or wrong orientation; stiffness-crack = wrong material.

## Sources

- printforgehq.com/3d-printed-living-hinge-design (thickness, orientation, break-in)
- 3dprinterstuff.com/workshop/design-living-hinges-3d-printing (geometry, filament, CAD technique)
- vprint3d.com.hk living-hinge checklist (thickness-to-length ratios, SLS Nylon PA12 note)
