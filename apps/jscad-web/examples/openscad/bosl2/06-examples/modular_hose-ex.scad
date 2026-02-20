// Test BOSL2 modular_hose: cylinder() - A mount point for modular hose
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/modular_hose.scad>

cylinder(h=10, r=20)
    attach(TOP) modular_hose(1/2, "ball", waist_len=15, $fn=32);
