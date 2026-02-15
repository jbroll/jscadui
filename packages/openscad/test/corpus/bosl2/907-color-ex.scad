// Test BOSL2 color: highlight_this()
// Extracted from BOSL2 library examples
include <lib/std.scad>

highlight_this()
cuboid(10)
   attach(TOP,BOT)cuboid(5, $fn=32);
