// Test BOSL2 miscellaneous: path_extrude2d()
// Extracted from BOSL2 library examples
include <lib/std.scad>

path_extrude2d(arc(d=100,angle=[180,270]),caps=true)
    trapezoid(w1=10, w2=5, h=10, anchor=BACK, $fn=32);
