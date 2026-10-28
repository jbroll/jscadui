---
name: dovetail-slider
description: Design dovetail, tongue-groove and sliding-rail joints that assemble by hand and lock in three axes — stepped profiles, CAD clearance formula, fillets and boolean-cut females. Use for modular assemblies, removable panels and multi-part prints.
---

# Dovetails and sliding joints

Consumes `fit-clearance` and `printability-design`.

## Profile

Classic 7-14 dovetail angles need supports and fail on FDM. Use **stepped trapezoidal** profiles: ~0.2 tall x 0.3 wide steps at ~75, which interlock while staying printable. Min feature at 0.2/0.4: pin width 2.4mm, socket depth 4.0mm.

## Clearance

Absolute, not scaled with size:

```
clearance = layer_height x 2.7 + nozzle x 0.15
```

0.16/0.4 gives ~0.49, round to **0.5 total**. Sliding drawers that must glide: fit-clearance close-running instead.

## CAD hygiene

- Fillet every internal corner >= 0.3 (0.15 resin min): sharp corners concentrate stress and force nozzle dwell gaps. Dovetails with un-filleted shoulders fail near 40% of rated load.
- Cut the female by **boolean subtraction from a fresh block**; never mirror the male (mirrors flip normals and leave sub-0.01 gaps that slice as non-manifold).
- Export each half as its own STL.

## Coupon first

Short 20-30mm rail section. Binds halfway = add 0.05 to both sides in CAD and reprint, never sand (removes the friction texture). Ghost ridges inside female = wall count too high for thin walls; drop to 2 walls or widen.

## Sources

- layercraftlog.com/3d-modeling/how-to-create-dovetail-joints-in-cad-for-3d-printing-projects (stepped profile, formula, fillets, boolean rule, 217-joint test data)
- cults3d.com sliding-dovetail demo (corner clearance via negative radii)
