// Test BOSL2 screws: shoulder_screw() - ISO shoulder screw
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/screws.scad>

shoulder_screw("iso",10,length=20, $fn=32);
