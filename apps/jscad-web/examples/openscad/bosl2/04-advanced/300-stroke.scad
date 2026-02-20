// Test BOSL2 stroke (3D)
include <lib/std.scad>

path = [[0,0,0], [20,0,0], [20,20,0], [0,20,10]];
stroke(path, width=3);
