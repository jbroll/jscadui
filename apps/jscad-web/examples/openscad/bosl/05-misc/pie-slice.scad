// BOSL-style pie_slice() - wedge of a cylinder
module pie_slice(ang = 90, h = 10, r = 20) {
    intersection() {
        cylinder(h = h, r = r);
        rotate([0, 0, -ang/2])
            cube([r * 2, r * 2, h]);
        rotate([0, 0, ang/2 - 90])
            cube([r * 2, r * 2, h]);
    }
}

pie_slice(ang = 120, h = 8, r = 15);
