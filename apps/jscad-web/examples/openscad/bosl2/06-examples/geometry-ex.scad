// Test BOSL2 geometry: sphere()
// Extracted from BOSL2 library examples
include <lib/std.scad>

sphere(r=15,$fn=48);
plane = plane_from_normal([2,-3,9],[4,-5,12]);
%show_plane(plane, [35,25], [4,-7]);
