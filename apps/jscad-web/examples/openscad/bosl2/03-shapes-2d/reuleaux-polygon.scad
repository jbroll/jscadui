// Test BOSL2 reuleaux_polygon
include <lib/std.scad>

linear_extrude(5) reuleaux_polygon(n=3, r=15);
