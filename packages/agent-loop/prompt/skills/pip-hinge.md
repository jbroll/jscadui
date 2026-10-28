---
description: Print-in-place hinges, joints and captive mechanisms that break free and move — clearances, Z-pins, teardrops, bottom chamfers, no supports in gaps. Load for hinges, chains and pre-assembled moving parts.
---

Needs fit-clearance and printability-design numbers.

Clearances, radial per side (0.4 nozzle / 0.2 layers, calibrate per spool): PLA tight 0.15-0.20, standard 0.25, loose 0.30-0.40; PETG +0.05-0.10 over PLA. Total gap = 2x radial. Never global-scale to fix; adjust the CAD gap in 0.05 steps.

Geometry: vertical rotation axis preferred — gaps land in the XY plane where perimeters stay distinct and circular. Horizontal axes get a teardrop socket roof (two 45 slopes) so nothing bridges over the pin and sags into the gap. Bottom chamfers 0.5-1.0 x 45 on pin and socket: first-layer squish fuses unrelieved bases. Slicer hints only: elephant-foot comp 0.1-0.2, brim gap 0.20-0.25 off moving edges, Arachne walls, 0.16-0.20 layers, 40-60 mm/s outers.

Process: cool fully, break free gently by hand; stop if it won't release. Fused at base only means foot squish; fused along full height means gap too tight or over-extruded. Never fix weak joints with extra flow — fix geometry and perimeters (3-4 so small pins print solid).

Globals: JointGap radial (0.25 PLA default), PinChamfer (0.5).

Coupon: stepped block of the same pin/socket at 0.15/0.20/0.25/0.30 radial; the winner becomes the global every joint inherits. Verify with measure/check.

Sources: sovol print-in-place guide, loftsmith print-in-place hinge.
