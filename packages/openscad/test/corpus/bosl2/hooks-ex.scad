// Test BOSL2 hooks: ring_hook() - Semi-circular through hole (a D-hole):
// Extracted from BOSL2 library examples
include <lib/std.scad>

ring_hook([50, 10], 12, 25, ir=15, hole="D", rounding=3, hole_rounding=3, fillet=2, $fn=32);
