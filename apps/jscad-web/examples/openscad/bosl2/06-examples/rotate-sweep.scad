// Test BOSL2 rotate_sweep
include <lib/std.scad>

path = [[10,0], [15,0], [15,5], [10,5]];
rotate_sweep(path, angle=270);
