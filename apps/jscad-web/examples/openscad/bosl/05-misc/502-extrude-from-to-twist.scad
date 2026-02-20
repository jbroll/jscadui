// Test BOSL extrude_from_to with twist and scale
include <lib/constants.scad>
use <lib/paths.scad>

extrude_from_to([0,0,0], [10,20,30], twist=180, scale=2) {
    square([6, 3], center=true);
}
