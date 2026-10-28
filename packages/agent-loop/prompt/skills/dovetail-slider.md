---
description: Dovetail, tongue-groove and sliding-rail joints that assemble by hand and lock in three axes — stepped profiles, CAD clearance formula, fillets, boolean-cut females. Load for modular assemblies and multi-part prints.
---

Needs fit-clearance and printability-design numbers.

Profile: classic 7-14 dovetail angles need supports and fail on FDM. Use stepped trapezoidal profiles (~0.2 tall x 0.3 wide steps at ~75), which interlock while staying printable. Minimum at 0.2/0.4: pin width 2.4 mm, socket depth 4.0 mm.

Clearance is absolute, not scaled: clearance = layer height x 2.7 + nozzle x 0.15. At 0.16/0.4 that is ~0.49, round to 0.5 total. Sliding drawers that must glide use fit-clearance close-running instead.

CAD hygiene: fillet every internal corner >= 0.3 (0.15 resin min) — sharp corners concentrate stress and force nozzle dwell gaps. Cut the female by boolean subtraction from a fresh block, never mirror the male: mirrors flip normals and leave sub-0.01 gaps that slice as non-manifold. Export each half as its own STL.

Coupon: short 20-30 mm rail section. Binds halfway: add 0.05 to both sides in CAD and reprint, never sand (removes the friction texture). Ghost ridges inside the female mean too many walls for thin walls; drop to 2 walls or widen. Verify with measure/check.

Sources: layercraftlog dovetail joints, sliding-dovetail demo.
