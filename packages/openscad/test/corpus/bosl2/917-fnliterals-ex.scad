// Test BOSL2 fnliterals: echo() - Reimplement cumprod()
// Extracted from BOSL2 library examples
include <lib/std.scad>

echo(accumulate(f_mul(),[3,4,5],1), $fn=32); // ECHO: [3,12,60,360]
