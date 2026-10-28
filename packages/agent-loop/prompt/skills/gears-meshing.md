---
description: Spur gears that mesh and last — shared module, true involute teeth, backlash, centre distance, flat printing, shaft fixing. Load for gearboxes, extruders, clocks and meshing pairs.
---

Needs fit-clearance and printability-design numbers.

Sizing: one module (tooth size) for both gears — 1 small toys, 1.5 default, 2 loaded, 3 high-torque. Below 0.8 teeth are a few extrusion widths wide and print poorly on 0.4. 20-degree pressure angle both; true involute teeth, never arc approximations (involutes forgive centre error). Under 17 teeth on the pinion undercuts roots; need smaller, use bigger module. Centre = m*(z1+z2)/2 exactly.

Backlash 0.10-0.20 in tooth thickness, default 0.15; add when binding, remove when clacking. A sloppy axle adds more play than the teeth.

Printing: flat on the face, every layer a full tooth outline; standing teeth snap off. Teeth solid: 4+ perimeters. Elephant-foot chamfer or comp on the bottom edge. Herringbone runs smoother and self-aligns, prints flat without support.

Material: PLA crisp/light loads; PETG default working gears; nylon for hours of running, printed dry. Grease or dry PTFE; nylon-on-PLA outlasts same-plastic.

Shaft: D-bore matching the motor flat (0.1-0.2 clearance), hub with M3 set screw in a 2.6 tap, or press fit on knurled shafts.

Globals: Module, Teeth1/2, Backlash, FaceW. Coupon the pair (~13 min at default); hand-turn full revolutions. Verify with measure/check.

Sources: loftsmith gears, 1c3d gear mechanisms, sovol gears.
