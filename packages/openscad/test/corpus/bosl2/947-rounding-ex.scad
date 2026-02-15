// Test BOSL2 rounding: convex_offset_extrude() - Chamfered elliptical prism.  If you stretch a chamfered cylinder, the chamfer becomes uneven.
// Extracted from BOSL2 library examples
include <lib/std.scad>

convex_offset_extrude(bottom = os_chamfer(height=-2),
                      top=os_chamfer(height=1), height=7)
  xscale(4)circle(r=6,$fn=64);
