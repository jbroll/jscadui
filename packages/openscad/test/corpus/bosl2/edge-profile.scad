// Test BOSL2 edge_profile
include <lib/std.scad>

cuboid(30) edge_profile(TOP) mask2d_roundover(r=3);
