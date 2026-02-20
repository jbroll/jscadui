// Test BOSL2 vnf: echo()
// Extracted from BOSL2 library examples
include <lib/std.scad>

echo(vnf_bounds(cube([2,3,4],center=true)), $fn=32);   // Displays [[-1, -1.5, -2], [1, 1.5, 2]]
