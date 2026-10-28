---
name: pip-hinge
description: Design print-in-place hinges, joints and captive mechanisms that break free and move — radial clearances, Z-pins, teardrops, bottom chamfers and no supports in gaps. Use for hinges, chains, ball joints and pre-assembled moving parts.
---

# Print-in-place hinges and joints

Consumes `fit-clearance` and `printability-design`.

## Clearances (radial, per side, 0.4 nozzle / 0.2 layers; calibrate per spool)

| Motion | PLA | PETG |
| --- | --- | --- |
| Tight / firm | 0.15-0.20 | 0.20-0.25 |
| Standard rotation | 0.25 (0.50 diametral) | 0.30-0.35 |
| Loose / free-swing | 0.30-0.40 | 0.35-0.45 |

Total gap = 2x radial. Never global-scale to fix; adjust the CAD gap in 0.05 steps.

## Geometry

- **Z-pins preferred:** vertical rotation axis puts gaps in the XY plane where perimeters stay distinct and circular.
- **Horizontal axes:** teardrop the socket roof (two 45 slopes) so nothing bridges over the pin and sags into the gap.
- **Bottom chamfers 0.5-1.0 x 45** on pin and socket: first-layer squish fuses unrelieved bases. Slicer hint: elephant-foot comp 0.1-0.2, brim gap 0.20-0.25 from moving edges.
- Chambers: 0.16-0.20 layers, Arachne walls, inner/outer order, 40-60mm/s outers, strong PLA bridge cooling.

## Process

Cool fully, then break free gently by hand; stop if it doesn't release (clearance or flow issue, not force issue). Fused at base only = foot squish; fused along full height = gap too tight or over-extruded (never fix weak joints with +flow — fix geometry + perimeters 3-4 so small pins print solid).

## JSCAD pattern

```js
params.JointGap = { type: 'number', default: 0.25 }  // radial, PLA
params.PinChamfer = 0.5;
```

## Coupon first

Stepped block of the same pin/socket at 0.15/0.20/0.25/0.30 radial. Winner becomes the global; every joint in the model inherits it.

## Sources

- sovol3d.com/...print-in-place-3d-printing-how-to-design-hinges-joints-and-moving-parts-that-actually-work (table, Z-pins, teardrops, troubleshooting)
- loftsmith.com/guides/print-in-place-hinge (0.3-0.45 hinge clearance)
