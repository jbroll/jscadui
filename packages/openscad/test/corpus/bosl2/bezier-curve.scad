// Test BOSL2 bezier curve
include <lib/std.scad>

pts = [[0,0], [10,20], [30,20], [40,0]];
path = bezier_curve(pts, splinesteps=20);
stroke(path3d(path), width=2);
