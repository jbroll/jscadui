// Test BOSL2 offset_stroke
include <lib/std.scad>

path = [[0,0], [30,0], [30,20], [0,20]];
offset_stroke(path, width=5, rounded=true, closed=true);
