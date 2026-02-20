// Test BOSL extrude_from_to - extrude between two 3D points
include <lib/constants.scad>
use <lib/paths.scad>

extrude_from_to([0,0,0], [20,30,40]) {
    circle(r=5);
}
