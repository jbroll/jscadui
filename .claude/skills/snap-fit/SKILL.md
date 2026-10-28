---
name: snap-fit
description: Design cantilever snap-fit clips that survive assembly and repeated use — beam proportions, root fillets, hook angles, orientation and material choice. Use for lids, battery doors, enclosure latches and tool-free closures.
---

# Snap-fit (cantilever)

Consumes `fit-clearance` and `printability-design`.

## Beam proportions

- Length-to-thickness: 8:1-10:1 PLA / PLA+, 5:1-8:1 PETG. Example: 2.0mm thick arm starts at 16-20mm long.
- Taper 100% thickness at root to ~50% at tip so strain spreads along the beam instead of concentrating at the anchor.
- Root fillet radius >= 0.5t, min 0.8-1.0mm. Sharp inside corners are the #1 crack origin.

## Hook geometry

- Engagement (undercut) 0.5-1.2mm. More holds better but demands more deflection.
- Lead-in angle 25-35 (slides together with thumb pressure); retention face 45-70 removable, 90 permanent.
- Mating clearance 0.20-0.40/side between non-locking faces; 0.2 interference on the clip itself engages firmly.
- Chamfer mating entry edges; skip supports under flex arms (scars start fatigue cracks).

## Orientation and material

- Print arms lying flat so bending runs along layer lines. Vertical arms peel apart at the root on first flex.
- PLA/PLA+: stiff, best for single-assembly locks and prototypes; creeps under constant load.
- PETG: ductile, survives 20-30+ open cycles; add +0.05-0.10/side over PLA numbers.
- ABS/ASA: heat and outdoor; TPU 95A for flexible catch plugs, not arms.

## JSCAD pattern

```js
params.ArmT = 2.0; params.ArmL = 18; params.FilletR = 1.0;
params.Engage = 0.8; params.LeadAngle = 30; params.RetainAngle = 60;
```

## Coupon first

Isolate arm + socket, print in 15-20 min. Checks: thumb-pressure insertion, retention pull, 20-30 engage cycles without cracking or going slack, flush seam. Adjust in 0.05mm steps; never fix in the slicer.

## Sources

- sovol3d.com/blogs/news/3d-printed-snap-fit-joints-how-to-design-clips-that-work (L/t, fillets, angles, troubleshooting matrix)
- emrldlabs.com/blog/printing-functional-enclosures... (orientation, taper, 1-1.5mm engagement, PETG for reuse)
- speakcad.com/guides/tolerances-and-clearances (0.2 interference + 45 lead-in)
