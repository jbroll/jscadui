// BOSL-style up() transform using children()
module up(z) {
    translate([0, 0, z]) children();
}

up(10) cube(5);
