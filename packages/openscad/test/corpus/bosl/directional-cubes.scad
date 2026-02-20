// Test BOSL directional cubes - cubes offset in specific directions
include <lib/constants.scad>
use <lib/shapes.scad>

// leftcube, rightcube, fwdcube, backcube, downcube, upcube
union() {
    leftcube([10, 10, 10]);
    translate([20, 0, 0]) rightcube([10, 10, 10]);
    translate([40, 0, 0]) fwdcube([10, 10, 10]);
    translate([60, 0, 0]) backcube([10, 10, 10]);
    translate([80, 0, 0]) downcube([10, 10, 10]);
    translate([100, 0, 0]) upcube([10, 10, 10]);
}
