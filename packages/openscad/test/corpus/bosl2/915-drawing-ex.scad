// Test BOSL2 drawing: stroke()
// Extracted from BOSL2 library examples
include <lib/std.scad>

stroke(helix(turns=2.5, h=100, r=50), dots=true, dots_color="blue", $fn=32);
