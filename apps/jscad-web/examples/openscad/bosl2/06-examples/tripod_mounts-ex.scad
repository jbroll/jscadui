// Test BOSL2 tripod_mounts: manfrotto_rc2_plate()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/tripod_mounts.scad>

manfrotto_rc2_plate();
manfrotto_rc2_plate("bot", $fn=32);
