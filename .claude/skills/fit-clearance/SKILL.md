---
name: fit-clearance
description: Pick FDM clearances for press, snug, sliding and loose fits, with per-side vs total stated and hole/shaft print compensation. Use for any two parts that must mate, before box-lid, snap-fit, gears, hinges or dovetails.
---

# Fit clearance

Foundation skill. Every other printability skill consumes its numbers.

## State the gap both ways

- **Per side (radial):** gap between one wall and its mating wall.
- **Total (diametral):** hole diameter minus pin diameter = 2x per side.

Always write both. "0.2mm clearance" is ambiguous (snug total vs sliding per side).

## Starting ladder (FDM, 0.4mm nozzle, rigid filament, 5-25mm)

| Fit | Total gap | Per side | Feels like | Use for |
| --- | --- | --- | --- | --- |
| Press / interference | -0.10mm | -0.05mm | Vice or firm thumbs, stays put | Bearings, pins, magnets |
| Snug | +0.05mm | +0.025mm | Slides with friction, holds position | Lids that stay on, locators |
| Close running | +0.15mm | +0.075mm | Moves freely, no play | Pivots, printed hinges, sliders |
| Loose / free | +0.35mm | +0.175mm | Visible play, never binds | Outdoor, dusty, must-work-first-try |

Lids: 0.15-0.35mm per side, default 0.25 with ~6mm lip. PETG tacky: +0.05-0.10/side over PLA. TPU: double interference; 0.5-0.8 moving.

## Print compensation (separate from fit)

Holes print 0.1-0.3 undersize (~0.24 for 5mm PLA hole); shafts print ~0.1 oversize.

```
hole in CAD  = nominal + fit_gap + hole_comp (+0.24-ish)
shaft in CAD = nominal - shaft_swell (-0.10-ish)
```

Never scale-to-fix in the slicer: scaling grows both sides and the gap barely moves. Fix the CAD param.

## JSCAD pattern

Named globals, one per fit, inherited by every mating part:

```js
params.FitPress = { type: 'number', default: -0.10 }  // diametral
params.HoleComp = { type: 'number', default: 0.24 }
params.ShaftSwell = { type: 'number', default: 0.10 }
```

Put precision on the shaft (measurable, sandable); keep the hole loose-ish. Crush ribs (3-4x 0.2mm proud) beat full-round interference for repeated inserts: they self-center and don't split layer lines. Plastics creep: back permanent loads with shoulder/CA/insert, not friction alone.

## Coupon first

10x10mm plate with the hole + 10mm shaft stub, at 0.15/0.20/0.25/0.30 radial. Firm-push smallest entry = press; first free turn = sliding. Iterate 0.05mm, max 2 rounds. Write the winner on the spool / `notes/model-spec.md`.

## Verify

`measure`/`check`: watertight, manifold, hole vs shaft dimensions vs the globals. Then print the coupon, not the assembly.

## Sources

- loftsmith.com/guides/3d-printing-tolerances (ladder, lids 0.25/side, teardrop holes)
- tools.creative3dp.com/blog/press-fit-tolerances-3d-printing (fit vs compensation split, crush ribs, creep)
- speakcad.com/guides/tolerances-and-clearances, help.makelab.com (hole/thread/insert tables), emrldlabs.com/blog/printing-functional-enclosures-tolerances-snap-fits-thread-inserts
