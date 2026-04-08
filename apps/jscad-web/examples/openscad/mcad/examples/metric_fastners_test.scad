include <metric_fastners.scad>

cap_bolt(3, 20);
translate([10, 0, 0]) csk_bolt(3, 20);
translate([20, 0, 0]) flat_nut(3);
translate([30, 0, 0]) bolt(3, 15);
