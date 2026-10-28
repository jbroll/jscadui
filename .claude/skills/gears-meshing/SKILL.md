---
name: gears-meshing
description: Design spur gears that mesh and last — shared module, true involute teeth, backlash, centre distance, flat printing and shaft fixing. Use for gearboxes, extruders, clocks, winches and any meshing pair.
---

# Gears that mesh

Consumes `fit-clearance` and `printability-design`.

## Sizing

- One **module** (tooth size) for both gears. 1mm small toys, **1.5 default** mechanisms, 2 loaded, 3 high-torque. Below 0.8 teeth are a few extrusion widths wide and print poorly on 0.4.
- 20-degree pressure angle both gears; true involute teeth from the base circle, never arc approximations (involutes forgive slight centre error).
- >= 17 teeth on the 20-degree pinion or roots undercut; need smaller, use bigger module or profile shift.
- pitch = m*z; outside = m*(z+2); depth = 2.25m. Centre distance = m*(z1+z2)/2 exactly.

## Backlash for FDM

0.10-0.20 built into tooth thickness, default 0.15. Binds at one spot: add backlash. Clacks on reverse: remove some. Check axle holes too — a sloppy axle adds more play than the teeth.

## Printing

- Flat on the face: every layer holds a full tooth outline. Standing teeth snap off along layer lines.
- Teeth solid: 4+ perimeters. Elephant-foot chamfer or comp on the bottom edge or every tooth swells.
- Herringbone (V teeth) runs smoother, self-aligns, no axial push; prints flat without support.
- Material: PLA crisp/light loads; PETG default working gears; nylon for hours of running (print dry). Dab of grease or dry PTFE; mixed pairs (nylon on PLA) outlast same-plastic.

## Shaft fixing

Round bore on round shaft slips. Use: D-bore matching the motor flat (0.1-0.2 clearance); hub with M3 set screw in a 2.6 tap hole (nut or insert for repeated removal); press fit on knurled shaft for small light gears.

## JSCAD pattern

```js
params.Module = 1.5; params.Teeth1 = 24; params.Teeth2 = 36;
params.Backlash = 0.15; params.FaceW = 8;
// centre = Module * (Teeth1 + Teeth2) / 2  (= 45)
```

## Coupon first

Print the pair (~13 min, ~6g at default size): hand-turn through full revolutions, load-test, wear-check. Fix module/backlash/centre in CAD.

## Sources

- loftsmith.com/guides/3d-printed-gears (module table, 17-tooth rule, 0.15 backlash, materials)
- 1c3d.com/howtos/designing-3d-printed-gears-mechanisms-module-pressure-angle-backlash
- sovol3d.com/blogs/news/3d-printing-gears-that-actually-work-backlash-orientation-and-material-tips
