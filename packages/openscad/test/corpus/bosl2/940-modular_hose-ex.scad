// Test BOSL2 modular_hose: modular_hose()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/modular_hose.scad>

modular_hose(1/4,"segment");
 right(25)modular_hose(1/2,"segment");
 right(60)modular_hose(3/4,"segment", $fn=32);
