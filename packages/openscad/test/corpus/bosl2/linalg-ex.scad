// Test BOSL2 linalg: transpose() - Transpose on a list of numbers returns the list unchanged
// Extracted from BOSL2 library examples
include <lib/std.scad>

transpose([3,4,5], $fn=32);  // Returns: [3,4,5]
