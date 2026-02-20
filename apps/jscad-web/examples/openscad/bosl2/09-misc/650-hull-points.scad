// Test BOSL2 hull_points
include <lib/std.scad>

pts = [for (i=[0:20]) [rands(-20,20,1)[0], rands(-20,20,1)[0], rands(-20,20,1)[0]]];
hull_points(pts);
