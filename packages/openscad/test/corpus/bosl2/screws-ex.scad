// Test BOSL2 screws: shoulder_screw() - English shoulder screw
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/screws.scad>

shoulder_screw("english",1/2,length=20, $fn=32);
