// Test BOSL fillet_mask_x/y/z - oriented fillet masks
include <lib/constants.scad>
use <lib/masks.scad>

union() {
    fillet_mask_x(l=20, r=3);
    translate([0, 15, 0]) fillet_mask_y(l=20, r=3);
    translate([0, 30, 0]) fillet_mask_z(l=20, r=3);
}
