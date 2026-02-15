// Test BOSL2 screw_drive: torx_mask()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/screw_drive.scad>

torx_mask(size=30, l=10, $fa=1, $fs=1, $fn=32);
