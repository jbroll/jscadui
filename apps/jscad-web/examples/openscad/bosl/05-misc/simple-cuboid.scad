// Simplified cuboid with chamfer (BOSL-inspired)
module simple_cuboid(size = [10, 10, 10], chamfer = 0) {
    if (chamfer > 0) {
        hull() {
            translate([chamfer, chamfer, 0])
                cube([size[0] - 2*chamfer, size[1] - 2*chamfer, size[2]]);
            translate([0, chamfer, chamfer])
                cube([size[0], size[1] - 2*chamfer, size[2] - 2*chamfer]);
            translate([chamfer, 0, chamfer])
                cube([size[0] - 2*chamfer, size[1], size[2] - 2*chamfer]);
        }
    } else {
        cube(size);
    }
}

simple_cuboid([20, 15, 10], chamfer = 2);
