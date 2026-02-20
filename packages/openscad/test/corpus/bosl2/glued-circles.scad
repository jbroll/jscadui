// Test BOSL2 glued_circles
include <lib/std.scad>

linear_extrude(5) glued_circles(r=10, spread=25, tangent=30);
