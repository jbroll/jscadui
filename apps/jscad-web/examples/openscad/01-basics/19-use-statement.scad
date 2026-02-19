// Test use statement with external file
use <lib/hardware.scad>

// Use imported modules
translate([0, 0, 0]) Bolt(length = 30, diameter = 6);
translate([15, 0, 0]) Nut(size = 12);
translate([30, 0, 0]) Washer(outer = 15, inner = 8, thickness = 3);
