// Test BOSL2 attachments: cuboid() - Child would require anchor of RIGHT+FRONT+BOT if placed with {{position()}}. 
// Extracted from BOSL2 library examples
include <lib/std.scad>

cuboid([50,40,15])
  align(TOP,RIGHT+FRONT)
    color("lightblue")prismoid([10,5],[7,4],height=4, $fn=32);
