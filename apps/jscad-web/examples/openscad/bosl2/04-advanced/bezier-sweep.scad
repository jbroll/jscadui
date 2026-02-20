// Test BOSL2 bezier_sweep
include <lib/std.scad>

bez = [[0,0,0], [10,20,0], [30,20,0], [40,0,0]];
bezier_sweep(circle(r=3), bez, splinesteps=20);
