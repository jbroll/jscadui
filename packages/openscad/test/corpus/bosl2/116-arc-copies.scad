// Test BOSL2 distributors: arc_copies
include <lib/std.scad>

arc_copies(n=6, r=20, angle=180)
    cube(5, center=true);
