// Test BOSL2 skin
include <lib/std.scad>

skin([
    path3d(circle(r=10), 0),
    path3d(circle(r=15), 10),
    path3d(circle(r=8), 20)
], slices=10);
