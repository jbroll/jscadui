// Test BOSL2 linear_bearings: linear_bearing_housing()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/linear_bearings.scad>

linear_bearing_housing(d=19, l=29, wall=2, tab=8, screwsize=2.5, $fn=32);
