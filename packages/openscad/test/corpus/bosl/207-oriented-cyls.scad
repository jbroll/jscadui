// Test BOSL oriented cylinders - xcyl, ycyl, zcyl
include <lib/constants.scad>
use <lib/shapes.scad>

union() {
    xcyl(l=40, r=5);
    translate([0, 30, 0]) ycyl(l=40, r=5);
    translate([0, 60, 0]) zcyl(l=40, r=5);
}
