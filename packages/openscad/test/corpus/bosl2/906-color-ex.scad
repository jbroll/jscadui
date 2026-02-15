// Test BOSL2 color: highlight()
// Extracted from BOSL2 library examples
include <lib/std.scad>

highlight() cuboid(10)
  highlight(false) attach(RIGHT,BOT)cuboid(5, $fn=32);
