// Test BOSL2 dashed_stroke
include <lib/std.scad>

path = [[0,0], [40,0], [40,30]];
dashed_stroke(path, dashpat=[5,3], width=2);
