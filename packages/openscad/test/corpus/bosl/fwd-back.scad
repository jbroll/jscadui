// BOSL-style fwd() and back() transforms
module fwd(y) {
    translate([0, y, 0]) children();
}

module back(y) {
    translate([0, -y, 0]) children();
}

fwd(8) cube(4);
back(8) cylinder(h=6, r=2);
