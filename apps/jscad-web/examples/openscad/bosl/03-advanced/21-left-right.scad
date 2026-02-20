// BOSL-style left() and right() transforms
module left(x) {
    translate([-x, 0, 0]) children();
}

module right(x) {
    translate([x, 0, 0]) children();
}

left(10) cube(5);
right(10) sphere(3);
