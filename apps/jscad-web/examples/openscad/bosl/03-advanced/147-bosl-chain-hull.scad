include <lib/constants.scad>
use <lib/transforms.scad>

chain_hull() {
    translate([0,0,0]) sphere(r=3, $fn=16);
    translate([10,0,0]) sphere(r=3, $fn=16);
    translate([10,10,0]) sphere(r=3, $fn=16);
}
