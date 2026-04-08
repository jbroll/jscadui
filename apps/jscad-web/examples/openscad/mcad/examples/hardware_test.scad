include <hardware.scad>

// Demonstrate hardware modules: rods, screws, bearing, nuts, washers
rod(20);
translate([rodsize * 2.5, 0, 0]) rod(20, threaded=true);
translate([rodsize * 5, 0, 0]) screw(10, true);
translate([rodsize * 7.5, 0, 0]) bearing();
translate([rodsize * 10, 0, 0]) rodnut();
translate([rodsize * 12.5, 0, 0]) nut();
