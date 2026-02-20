// Test BOSL chamfer_mask_x/y/z - oriented chamfer masks
include <lib/constants.scad>
use <lib/masks.scad>

union() {
    chamfer_mask_x(l=20, chamfer=3);
    translate([0, 15, 0]) chamfer_mask_y(l=20, chamfer=3);
    translate([0, 30, 0]) chamfer_mask_z(l=20, chamfer=3);
}
