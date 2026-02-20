// Test BOSL2 skin: skin() - Rotating the pentagon place the zero index at different locations, giving a twist
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/skin.scad>

skin([rot(90,p=pentagon(4)), circle($fn=80,r=2)], z=[0,3], slices=10);
