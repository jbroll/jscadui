---
description: FDM walls, overhangs, bridging, orientation, anisotropy and warp rules, CAD side only. Load for any new part before detailing fits or joints.
---

Walls (0.4 nozzle): structural >= 1.2 (3 perimeters), cosmetic min 0.8, in nozzle multiples. Arms, teeth, pins: 4-5 perimeters so sections print solid. Min pin and hole 2 mm. Printed threads >= M8 coarse only.

Overhangs <= 45 from vertical. Chamfer flat undersides at 45. Sideways round holes: teardrop top or flat across + ~0.1. Tilt critical faces up; split and reassemble over supports. Never put supports in moving gaps.

Bridging: PLA 50-60 mm, PETG ~40, ABS ~30-35, nylon ~30. Longer spans get a rib, a mid-wall, or a split.

Orientation: inter-layer bond is 40-60% of strand strength. Bend and load in the XY plane: arms, pins and cantilevers print lying flat, never standing. Standing pins get 3-4 perimeters and 0.5 x 45 shoulder chamfers. Vertical (Z) holes are truest; horizontal holes print oval.

Warp, CAD side: fillet bottom corners >= 1 mm, keep thin-wall height:base below 8:1, rib under big flat tops. Bottom-edge 0.5-1.0 x 45 chamfer absorbs first-layer squish. Slicer hint only: elephant-foot comp 0.1-0.2, brim kept 0.20-0.25 off moving edges.

Globals: WallMin, OverhangMax 45, BridgeMax per filament. Coupon the risky feature as a 15-minute section; verify with measure/check before the full print.

Sources: layerx3d fdm rules, 1c3d design rules, sovol print-in-place guide.
