// Test BOSL2 metric_screws: generic_screw()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/metric_screws.scad>

generic_screw(screwsize=3,screwlen=10,headsize=6,headlen=3, anchor="countersunk");
generic_screw(screwsize=3,screwlen=10,headsize=6,headlen=3, anchor="base", $fn=32);
