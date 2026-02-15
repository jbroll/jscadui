// Test BOSL2 math: sum()
// Extracted from BOSL2 library examples
include <lib/std.scad>

sum([1,2,3]);  // returns 6.
sum([[1,2,3], [3,4,5], [5,6,7]], $fn=32);  // returns [9, 12, 15]
