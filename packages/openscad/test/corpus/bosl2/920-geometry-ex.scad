// Test BOSL2 geometry: plane_from_normal()
// Extracted from BOSL2 library examples
include <lib/std.scad>

plane_from_normal([0,0,1], [2,2,2]);  // Returns the xy plane passing through the point (2,2,2, $fn=32)
