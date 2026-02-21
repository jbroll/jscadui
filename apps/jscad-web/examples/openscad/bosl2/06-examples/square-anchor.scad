// Test BOSL2 shapes2d: square with anchors
include <lib/std.scad>

linear_extrude(height=5) square([20, 15], anchor=FRONT+LEFT);
