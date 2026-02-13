// Test BOSL2 diff (tag-based difference)
include <lib/std.scad>

diff()
cuboid(30) attach(TOP, BOT, overlap=5) tag("remove") cyl(h=20, r=8);
