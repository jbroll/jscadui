// Test BOSL2 gears: spur_gear() - Spur Gear
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/gears.scad>

spur_gear(circ_pitch=5, teeth=20, thickness=8, shaft_diam=5, $fn=32);
