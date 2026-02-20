// Test BOSL2 wiring: wire_bundle()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/wiring.scad>

wire_bundle([[50,0,-50], [50,50,-50], [0,50,-50], [0,0,-50], [0,0,0]], rounding=10, wires=13, $fn=32);
