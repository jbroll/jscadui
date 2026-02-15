// Test BOSL2 math: log2()
// Extracted from BOSL2 library examples
include <lib/std.scad>

log2(0.125);  // Returns: -3
log2(16);     // Returns: 4
log2(256, $fn=32);    // Returns: 8
