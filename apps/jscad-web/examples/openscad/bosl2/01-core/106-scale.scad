// Test BOSL2 transforms: xscale(), yscale(), zscale()
include <lib/std.scad>

xscale(2) cube(5);
yscale(1.5) right(15) cube(5);
zscale(3) right(30) cube(5);
