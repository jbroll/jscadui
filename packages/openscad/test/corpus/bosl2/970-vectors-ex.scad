// Test BOSL2 vectors: v_div()
// Extracted from BOSL2 library examples
include <lib/std.scad>

v_div([24,28,30], [8,7,6], $fn=32);  // Returns [3, 4, 5]
