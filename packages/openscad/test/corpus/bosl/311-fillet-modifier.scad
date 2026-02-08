// Test BOSL fillet() - edge modifier that applies fillet to children
include <lib/constants.scad>
use <lib/masks.scad>

fillet(fillet=2, size=[20,20,20]) {
    cube([20,20,20], center=true);
}
