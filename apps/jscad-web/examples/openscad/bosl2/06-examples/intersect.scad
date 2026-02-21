// Test BOSL2 intersect (tag-based intersection)
include <lib/std.scad>

intersect()
cuboid(30) tag("intersect") sphere(r=20);
