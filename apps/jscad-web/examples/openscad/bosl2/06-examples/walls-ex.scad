// Test BOSL2 walls: sparse_wall() - Thinner Strut
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/walls.scad>

sparse_wall(h=40, l=100, thick=3, strut=2, $fn=32);
