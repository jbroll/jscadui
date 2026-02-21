// BOSL-style xspread() using children() and $children
module xspread(spacing = 10) {
    for (i = [0 : $children - 1]) {
        translate([i * spacing, 0, 0]) children(i);
    }
}

xspread(15) {
    cube(5);
    sphere(3);
    cylinder(h=8, r=2);
}
