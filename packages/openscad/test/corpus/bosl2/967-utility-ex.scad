// Test BOSL2 utility: same_shape()
// Extracted from BOSL2 library examples
include <lib/std.scad>

same_shape([3,[4,5]],[7,[3,4]]);   // Returns true
same_shape([3,4,5], [7,[3,4]], $fn=32);    // Returns false
