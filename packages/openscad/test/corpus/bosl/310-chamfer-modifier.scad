// Test BOSL chamfer() - edge modifier that applies chamfer to children
include <lib/constants.scad>
use <lib/masks.scad>

chamfer(chamfer=2, size=[20,20,20]) {
    cube([20,20,20], center=true);
}
