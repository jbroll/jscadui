---
description: Screw bosses, heat-set insert pockets, self-tap pilots and printed threads that hold torque and survive reassembly. Load for screwed joints, PCB standoffs and threaded features.
---

Needs fit-clearance and printability-design numbers. Check standard hardware against packages/parts/ first.

Heat-set inserts (default M2-M6, repeated assembly): hole = insert OD - 0.2-0.8 per maker spec; depth = insert length + 1 for displaced plastic, 2+ floor below. Boss wall >= 2x insert diameter, 3-4 perimeters minimum, or the boss splits on install. Mouth lead chamfer. Size the boss around the insert OD, not the screw. Tall, narrow, edge or side-loaded bosses get ribs into the parent wall. Screw must clamp the stack, not bottom out: check insert depth plus screw length together.

Self-tapping: pilot hole for occasional assembly in PLA/ABS/nylon; strips on reassembly, never for service doors. Tap-after-print: model undersized, chase with a standard tap, best M5+. Press-fit knurls: slightly undersized hole, arbor press, low-load permanent only.

Printed threads: >= M8 coarse only, 0.3-0.4 profile clearance, vertical axis; expect wear. Hub alternative for gears/knobs: M3 set screw in a 2.6 tap hole, trapped nut, or heat-set insert.

PCB standoffs: slip fit on the board hole (0.2-0.3/side), tower tied to the wall with ribs. Port cutouts: +0.2-0.3/side over the real connector body.

Coupon: print the boss alone; install, cool fully, torque, pull, repeat 5x. Crack, spin or pullout means thicker/deeper boss, not a smaller hole.

Sources: insertguide bosses, sovol inserts, makelab holes/threads, 3dprintcalcs screw chart.
