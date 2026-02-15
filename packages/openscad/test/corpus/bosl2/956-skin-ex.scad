// Test BOSL2 skin: skin()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/skin.scad>

skin([octagon(4), circle($fn=70,r=2)], z=[0,3], slices=10);
