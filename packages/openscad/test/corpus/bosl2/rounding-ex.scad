// Test BOSL2 rounding: convex_offset_extrude() - Elliptical prism with circular roundovers.
// Extracted from BOSL2 library examples
include <lib/std.scad>

convex_offset_extrude(bottom=os_circle(r=-2),
                      top=os_circle(r=1), height=7,steps=10)
  xscale(4)circle(r=6,$fn=64);
