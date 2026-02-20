// Module that hulls pairs of children
module hull_children() {
    hull() children();
}

hull_children() {
    sphere(3);
    translate([10, 0, 0]) sphere(3);
}
