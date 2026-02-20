// Module that wraps difference with first child as base
module diff() {
    difference() {
        children(0);
        for (i = [1 : $children - 1]) {
            children(i);
        }
    }
}

diff() {
    cube(10, center = true);
    cylinder(h = 15, r = 3, center = true);
    rotate([90, 0, 0]) cylinder(h = 15, r = 3, center = true);
}
