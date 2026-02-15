// Test BOSL2 vectors: v_mul()
// Extracted from BOSL2 library examples
include <lib/std.scad>

v_mul([3,4,5], [8,7,6], $fn=32);  // Returns [24, 28, 30]
