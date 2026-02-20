// Test BOSL2 nema_steppers: nema_mount_mask()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/nema_steppers.scad>

nema_mount_mask(size=14, depth=5, l=5);
nema_mount_mask(size=17, depth=5, l=5);
nema_mount_mask(size=17, depth=5, l=0, $fn=32);
