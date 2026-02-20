// BOSL-style zring() - distribute children around Z axis
module zring(n = 6, r = 10) {
    for (i = [0 : n - 1]) {
        rotate([0, 0, i * 360 / n])
            translate([r, 0, 0])
                children();
    }
}

zring(n = 8, r = 15) cube(3);
