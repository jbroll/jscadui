// Test BOSL2 rect with chamfer
include <lib/std.scad>

linear_extrude(10) rect([30,20], chamfer=5);
