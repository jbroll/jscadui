include <regular_shapes.scad>

hexagon_prism(20, 10);
translate([35, 0, 0]) pentagon_prism(15, 12);
translate([65, 0, 0]) octagon_prism(10, 8);
translate([0, 35, 0]) torus(12, 4);
