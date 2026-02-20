// BOSL-style teardrop - printable circular hole
module teardrop2d(r = 5, ang = 45) {
    hull() {
        circle(r = r);
        rotate([0, 0, 180 - ang])
            translate([r, 0, 0])
                circle(r = 0.01);
    }
}

linear_extrude(height = 10)
    teardrop2d(r = 8, ang = 45);
