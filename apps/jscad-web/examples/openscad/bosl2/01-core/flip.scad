// Test BOSL2 transforms: xflip(), yflip(), zflip()
include <lib/std.scad>

xflip() right(10) cube(5);
yflip() back(10) cube(5);
zflip() up(10) cube(5);
