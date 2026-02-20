// Test BOSL2 comparisons: max_index()
// Extracted from BOSL2 library examples
include <lib/std.scad>

max_index([5,3,9,6,2,7,8,9,1]); // Returns: 2
max_index([5,3,9,6,2,7,8,9,1],all=true, $fn=32); // Returns: [2,7]
