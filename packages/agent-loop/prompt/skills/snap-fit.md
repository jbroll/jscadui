---
description: Cantilever snap-fit clips that survive assembly and reuse — beam proportions, root fillets, hook angles, orientation, material. Load for lids, battery doors and tool-free closures.
---

Needs fit-clearance and printability-design numbers.

Beam: length-to-thickness 8:1-10:1 PLA/PLA+, 5:1-8:1 PETG (2.0 thick starts at 16-20 long). Taper 100% at root to ~50% at tip so strain spreads instead of concentrating at the anchor. Root fillet >= 0.5t, min 0.8-1.0; sharp inside corners are the top crack origin.

Hook: engagement 0.5-1.2 (more holds better but demands more deflection). Lead-in 25-35 for thumb-pressure assembly; retention face 45-70 removable, 90 permanent. Mating clearance 0.20-0.40/side on non-locking faces. Chamfer mating entry edges. No supports under flex arms — scars start fatigue cracks.

Orientation and material: print arms lying flat so bending runs along layer lines; vertical arms peel apart at the root on first flex. PLA: stiff, single-assembly locks and prototypes, creeps under load. PETG: survives 20-30+ cycles, add +0.05-0.10/side. ABS/ASA: heat and outdoor. TPU 95A: flexible catches, not arms.

Globals: ArmT, ArmL, FilletR, Engage, LeadAngle, RetainAngle.

Coupon: arm + socket alone, 15-20 min. Checks: thumb insertion, retention pull, 20-30 cycles with no crack or slack, flush seam. Adjust 0.05 steps, never in the slicer. Verify with measure/check.

Sources: sovol snap-fit joints, emrldlabs enclosures, speakcad tolerances.
