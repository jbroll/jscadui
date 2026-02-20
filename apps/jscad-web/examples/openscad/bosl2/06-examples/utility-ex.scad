// Test BOSL2 utility: assert_approx()
// Extracted from BOSL2 library examples
include <lib/std.scad>

assert_approx(1/3, 0.333333333333333, str("number=",1,", denom=",3), $fn=32);
