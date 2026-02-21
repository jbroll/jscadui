// Test BOSL2 path_sweep
include <lib/std.scad>

shape = circle(r=3);
path = arc(r=20, angle=180);
path_sweep(shape, path3d(path));
