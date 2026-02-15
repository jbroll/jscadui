// Test BOSL2 partitions: half_of()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/partitions.scad>

half_of(DOWN+BACK, cp=[0,-10,0]) cylinder(h=40, r1=10, r2=0, center=false);
half_of(DOWN+LEFT, s=200) sphere(d=150, $fn=32);
