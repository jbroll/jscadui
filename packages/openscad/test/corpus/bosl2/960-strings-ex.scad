// Test BOSL2 strings: parse_num()
// Extracted from BOSL2 library examples
include <lib/std.scad>

parse_num("3/4");    // Returns 0.75
parse_num("3.4e-2", $fn=32); // Returns 0.034
