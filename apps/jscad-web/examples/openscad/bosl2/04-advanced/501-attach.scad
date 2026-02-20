// Test BOSL2 attach
include <lib/std.scad>

cuboid(20) attach(TOP, BOT) cylinder(h=10, r=5);
