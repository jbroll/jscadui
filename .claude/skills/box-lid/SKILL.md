---
name: box-lid
description: Design box lids that close first try — lip depth, per-side clearance, taper, corner relief and warp control. Use for boxes, cases, covers and enclosures with a mating lid.
---

# Box lids

Consumes `fit-clearance` and `printability-design`.

## Clearance

Sliding fit around the full perimeter, stated per side: 0.15-0.35mm, default **0.25/side** with ~6mm deep lip. Below 0.15 binds at corners; above 0.35 rattles. Long lips forgive less: a 20mm lip needs a bigger gap than a 5mm one, since warp accumulates along the length.

## Lip geometry

- Lip depth 5-6mm default; shallow lips rock, deep lips bind.
- Taper the entry: 1-2 draft plus a 0.3-0.5mm x 45 mouth chamfer on both parts so the lid self-centers instead of stubbing.
- Corner relief: lids bind at corners first. Add 0.3-0.5 extra corner radius on the inner part or small corner notches; never sharp inside corners.
- Compliant option for warp-prone large lids: thin the skirt wall (0.8-1.0mm) so it flexes over the box instead of demanding a perfect gap.

## Warp and foot

- Bottom-corner fillets >= 1mm; bottom-edge 0.5-1.0 x 45 chamfer against elephant foot (the classic lid-rocks-on-first-layer failure).
- Keep wall height:base sane; rib under large flat tops instead of thickening them.
- Slicer hint (not owned): elephant-foot comp 0.1-0.2.

## JSCAD pattern

```js
params.LidGap = { type: 'number', default: 0.25 }   // per side
params.LipDepth = { type: 'number', default: 6 }
params.LeadChamfer = { type: 'number', default: 0.4 }
```

One slider per value; never scale-to-fix.

## Coupon first

Print a 20-30mm corner section of the lip pair, not the whole box. Seats with a firm push and no rattle = ship it.

## Sources

- loftsmith.com/guides/3d-printing-tolerances (0.25/side, 6mm lip, corners bind first)
- youtube.com/watch?v=XKrDUnZCmQQ (Slant 3D tolerance design), youtube.com/watch?v=IZKh6lo9SP4 (compliant lids)
- emrldlabs.com/blog/printing-functional-enclosures-tolerances-snap-fits-thread-inserts (0.25-0.3/side default)
