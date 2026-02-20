// BOSL-style slot() - stadium/capsule shape
module slot(h = 10, l = 20, r = 5) {
    hull() {
        cylinder(h = h, r = r);
        translate([l, 0, 0]) cylinder(h = h, r = r);
    }
}

slot(h = 8, l = 25, r = 4);
