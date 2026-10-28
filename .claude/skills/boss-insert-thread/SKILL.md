---
name: boss-insert-thread
description: Design screw bosses, heat-set insert pockets, self-tap pilots and printed threads that hold torque and survive reassembly. Use for any screwed joint, PCB standoff, or threaded feature.
---

# Bosses, inserts, threads

Consumes `fit-clearance` and `printability-design`. Links to `packages/parts/` for standard hardware sizes.

## Heat-set inserts (default for M2-M6, repeated assembly)

- Hole diameter = insert OD - 0.2-0.8 (plastic melts around knurls); follow the insert maker's spec.
- Hole depth = insert length + 1mm for displaced plastic; leave 2mm+ floor below to the far wall.
- Boss wall >= 2x insert diameter, 3-4 perimeters minimum, so the boss doesn't split on install.
- Mouth lead chamfer; size the boss around the insert OD, not the screw.
- Tall/narrow/edge/loaded bosses get ribs into the parent wall; a tall isolated post bends and tilts on install.
- Screw must clamp the stack, not bottom out: check insert depth + screw length together.

## Self-tapping and tapped

- Self-tap pilot for occasional assembly in PLA/ABS/nylon; strips on reassembly — not for service doors.
- Tap-after-print: model undersized, chase with a standard tap; best for M5+.
- Press-fit knurled inserts: hole slightly undersized, arbor press, low-load/permanent only.

## Printed threads

- >= M8 coarse (e.g. M8x1.25+) only, profile clearance 0.3-0.4; print axis vertical; expect wear — chase or reprint when sloppy.
- Hub alternative for gears/knobs: M3 tap into a 2.6mm hole, trapped nut, or heat-set insert instead of printed threads.

## PCB standoffs and ports

- Standoffs: slip fit on the board hole (0.2-0.3/side FDM), screw tower tied to the enclosure wall with ribs.
- Port cutouts: +0.2-0.3/side over the connector body; confirm against the real part, not the datasheet outline alone.

## Coupon first

Print the boss alone: install the insert, cool fully, torque the screw, pull-test, repeat 5x. Crack/spin/pullout = thicker wall or deeper boss, not a smaller hole.

## Sources

- insertguide.com/guides/...bosses-for-heat-set-inserts (boss-as-structure, ribs, edge distance, material behavior)
- sovol3d.com/...heat-set-inserts... (3-4 perimeters, install temps PLA 200-250C, hotter PETG)
- help.makelab.com/...holes-threads-and-inserts... (hole tables, M6 min printed, +2x OD walls)
- 3dprintcalcs.net screw-hole chart (M2-M10 tap/clearance/insert sizes)
