// Test BOSL2 cubetruss: cubetruss_foot()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/cubetruss.scad>

cubetruss_foot(w=1);
cubetruss_foot(w=3, $fn=32);
