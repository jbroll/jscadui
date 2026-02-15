// Test BOSL2 strings: format_float()
// Extracted from BOSL2 library examples
include <lib/std.scad>

format_float(PI,12);  // Returns: "3.14159265359"
format_float([PI,-16.75],12, $fn=32);  // Returns: "[3.14159265359, -16.75]"
