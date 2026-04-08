use <shapes.scad>

tube(20, 10, 2);
translate([30, 0, 0]) hexagon(10, 8);
translate([60, 0, 0]) cone(15, 8);
translate([0, 30, 0]) ellipticalCylinder(8, 5, 15);
