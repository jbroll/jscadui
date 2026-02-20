// Nested transforms using children()
module up(z) {
    translate([0, 0, z]) children();
}

module right(x) {
    translate([x, 0, 0]) children();
}

module zrot(a) {
    rotate([0, 0, a]) children();
}

// Nested usage
up(10)
    right(5)
        zrot(45)
            cube(4);
