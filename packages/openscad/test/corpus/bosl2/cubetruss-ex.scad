// Test BOSL2 cubetruss: cubetruss_joiner()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/cubetruss.scad>

cubetruss_joiner(w=1, vert=false);
cubetruss_joiner(w=1, vert=true);
cubetruss_joiner(w=2, vert=true, anchor=BOT, $fn=32);
