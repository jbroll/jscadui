## Parts

- ball_bearing: `const { ball_bearing } = require('_catalog/BOSL2/ball_bearings.scad')` — ball_bearing("608ZZ", {$fn: 72})
- nut: `const { nut } = require('_catalog/BOSL2/screws.scad')` — nut("M3", {thickness: "thin"})
- screw: `const { screw } = require('_catalog/BOSL2/screws.scad')` — screw("M3,10", {head: "socket", drive: "hex"})
- stepper: `const { nema_stepper_motor } = require('_catalog/BOSL2/nema_steppers.scad')` — nema_stepper_motor(17, {h: 40, shaft_len: 24})
- washer: `const { washer, M3_washer } = require('_catalog/NopSCADlib/vitamins/washer.scad')` — washer(M3_washer)

Rules:
- Use a catalog part for standard hardware instead of modeling it.
- Prefer a permissive license when two parts are equivalent.
- Never copy library files into the project.
