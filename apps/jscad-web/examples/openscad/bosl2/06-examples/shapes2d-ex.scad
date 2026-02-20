// Test BOSL2 shapes2d: linear_extrude()
// Extracted from BOSL2 library examples
include <lib/std.scad>

linear_extrude(height=0.3, scale=0) supershape(step=1, m1=6, n1=0.4, n2=0, n3=6);
linear_extrude(height=5, scale=0) supershape(step=1, b=3, m1=6, n1=3.8, n2=16, n3=10, $fn=32);
