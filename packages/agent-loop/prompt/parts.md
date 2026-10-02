## Parts

- ball_bearing: `const { ball_bearing } = require('_catalog/BOSL2/ball_bearings.scad')` — ball_bearing("608ZZ", {$fn: 72})
- battery: `const { battery, S25R18650 } = require('_catalog/NopSCADlib/vitamins/battery.scad')` — battery(S25R18650)
- bearing_block: `const { scs_bearing_block, SCS8UU } = require('_catalog/NopSCADlib/vitamins/bearing_block.scad')` — scs_bearing_block(SCS8UU)
- blower: `const { blower, RB5015 } = require('_catalog/NopSCADlib/vitamins/blower.scad')` — blower(RB5015)
- circlip: `const { internal_circlip, circlip_12i } = require('_catalog/NopSCADlib/vitamins/circlip.scad')` — internal_circlip(circlip_12i)
- extrusion: `const { extrusion, E2020 } = require('_catalog/NopSCADlib/vitamins/extrusion.scad')` — extrusion(E2020, 100)
- fan: `const { fan, fan40x11 } = require('_catalog/NopSCADlib/vitamins/fan.scad')` — fan(fan40x11)
- green_terminal: `const { green_terminal, gt_5p08 } = require('_catalog/NopSCADlib/vitamins/green_terminal.scad')` — green_terminal(gt_5p08, 2)
- heat_set_insert: `const { insert, F1BM3 } = require('_catalog/NopSCADlib/vitamins/insert.scad')` — insert(F1BM3)
- lead_nut: `const { leadnut, LSN8x8 } = require('_catalog/NopSCADlib/vitamins/leadnut.scad')` — leadnut(LSN8x8)
- lead_screw: `const { leadscrew } = require('NopSCADlib/vitamins/rod.scad')` — leadscrew(8, 100, 8, 4)
- led: `const { led, LED3mm } = require('_catalog/NopSCADlib/vitamins/led.scad')` — led(LED3mm)
- linear_bearing: `const { linear_bearing, LM8UU } = require('_catalog/NopSCADlib/vitamins/linear_bearing.scad')` — linear_bearing(LM8UU)
- linear_rail: `const { rail, MGN12 } = require('_catalog/NopSCADlib/vitamins/rail.scad')` — rail(MGN12, 100)
- magnet: `const { magnet, MAG8x4x4p2 } = require('_catalog/NopSCADlib/vitamins/magnet.scad')` — magnet(MAG8x4x4p2)
- microswitch: `const { microswitch, medium_microswitch } = require('_catalog/NopSCADlib/vitamins/microswitch.scad')` — microswitch(medium_microswitch)
- nut: `const { nut } = require('_catalog/BOSL2/screws.scad')` — nut("M3", {thickness: "thin"})
- pillow_block: `const { kp_pillow_block, KP08_15 } = require('_catalog/NopSCADlib/vitamins/pillow_block.scad')` — kp_pillow_block(KP08_15)
- potentiometer: `const { potentiometer, KY_040_encoder } = require('_catalog/NopSCADlib/vitamins/potentiometer.scad')` — potentiometer(metric_pot)
- pulley: `const { pulley, GT2x20ob_pulley } = require('_catalog/NopSCADlib/vitamins/pulley.scad')` — pulley(GT2x20ob_pulley)
- rail_carriage: `const { carriage, MGN12H_carriage } = require('_catalog/NopSCADlib/vitamins/rail.scad')` — carriage(MGN12H_carriage)
- screw: `const { screw } = require('_catalog/BOSL2/screws.scad')` — screw("M3,10", {head: "socket", drive: "hex"})
- shaft_coupling: `const { shaft_coupling, SC_5x8_rigid } = require('_catalog/NopSCADlib/vitamins/shaft_coupling.scad')` — shaft_coupling(SC_5x8_rigid)
- shaft_support: `const { sk_bracket, SK8 } = require('_catalog/NopSCADlib/vitamins/sk_bracket.scad')` — sk_bracket(SK8)
- spring: `const { comp_spring, peg_spring } = require('_catalog/NopSCADlib/vitamins/spring.scad')` — comp_spring(peg_spring)
- square_button: `const { square_button, button_6mm } = require('_catalog/NopSCADlib/vitamins/button.scad')` — square_button(button_6mm)
- standoff: `const { pillar, M3x20_hex_pillar } = require('_catalog/NopSCADlib/vitamins/pillar.scad')` — pillar(M3x20_hex_pillar)
- stepper: `const { nema_stepper_motor } = require('_catalog/BOSL2/nema_steppers.scad')` — nema_stepper_motor(17, {h: 40, shaft_len: 24})
- t_nut: `const { sliding_t_nut, M3_sliding_t_nut } = require('_catalog/NopSCADlib/vitamins/nut.scad')` — sliding_t_nut(M4_sliding_t_nut)
- tubing: `const { tubing, PTFE2_4 } = require('_catalog/NopSCADlib/vitamins/tubing.scad')` — tubing(PTFE2_4)
- washer: `const { washer, M3_washer } = require('_catalog/NopSCADlib/vitamins/washer.scad')` — washer(M3_washer)
- ziptie: `const { ziptie, small_ziptie } = require('_catalog/NopSCADlib/vitamins/ziptie.scad')` — ziptie(small_ziptie)

Rules:
- Use a catalog part for standard hardware instead of modeling it.
- Prefer a permissive license when two parts are equivalent.
- Never copy library files into the project.
