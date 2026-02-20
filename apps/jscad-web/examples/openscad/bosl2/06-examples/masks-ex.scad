// Test BOSL2 masks: polygon_edge_mask() - Creating a roundover with a large excess
// Extracted from BOSL2 library examples
include <lib/std.scad>

polygon_edge_mask(mask2d_roundover(r=5, excess=2), length=20, $fn=32);
