// Test BOSL2 partitions: left_half()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/partitions.scad>

left_half() sphere(r=20);
left_half(x=-8) sphere(r=20, $fn=32);
