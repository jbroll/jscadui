---
description: FDM clearance ladder for press, snug, running and loose fits, per-side vs total, hole/shaft print compensation, coupon-first workflow. Load before designing any mating parts.
---

Foundation. Every other printability skill uses these numbers.

State both: per side (radial, one wall) and total (diametral, hole minus pin, 2x per side). "0.2 clearance" alone is ambiguous.

Ladder, FDM 0.4 nozzle, rigid filament, 5-25 mm:

| Fit | Total | Per side | Use |
|---|---|---|---|
| Press | -0.10 | -0.05 | Bearings, pins, magnets; vice-seated |
| Snug | +0.05 | +0.025 | Lids that stay on, locators |
| Running | +0.15 | +0.075 | Pivots, hinges, sliders |
| Loose | +0.35 | +0.175 | Never binds |

Lids: 0.15-0.35/side, default 0.25 with ~6 mm lip. PETG: +0.05-0.10/side over PLA. TPU: double interference, 0.5-0.8 moving.

Compensation is separate from fit: holes print ~0.1-0.3 undersize, shafts ~0.1 oversize. Model hole = nominal + gap + ~0.24, shaft = nominal - ~0.10. Never scale-to-fix in the slicer.

Globals: FitPress/FitSnug/FitRun/FitLoose (diametral), HoleComp, ShaftSwell. Precision on the shaft (measurable, sandable); crush ribs (3-4x 0.2 proud) beat full-round interference; creep means backing permanent loads, not friction alone.

Coupon: 10 mm plate + stub at 0.15/0.20/0.25/0.30 radial; iterate 0.05, max 2 rounds. Verify with measure/check, then print the coupon.

Sources: loftsmith tolerances, creative3dp press-fit, speakcad, makelab, emrldlabs.
