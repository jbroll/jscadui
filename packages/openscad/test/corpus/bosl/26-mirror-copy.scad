// BOSL-style mirror_copy() - creates original + mirrored copy
module mirror_copy(v = [1, 0, 0]) {
    children();
    mirror(v) children();
}

mirror_copy([1, 0, 0])
    translate([5, 0, 0])
        cube(3);
