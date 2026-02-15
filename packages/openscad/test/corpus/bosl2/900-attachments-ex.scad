// Test BOSL2 attachments: cuboid() - Cuboid positioned on the right of its parent.  Note that it is in its native orientation.  
// Extracted from BOSL2 library examples
include <lib/std.scad>

cuboid([20,35,25])
  align(RIGHT)
    color("lightgreen")cuboid([5,1,9], $fn=32);
