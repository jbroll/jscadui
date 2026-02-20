// Test BOSL2 distributors: line_copies
include <lib/std.scad>

line_copies(p1=[0,0], p2=[40,0], n=5)
    sphere(r=3);
