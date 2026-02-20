// Test BOSL2 transforms: xrot(), yrot(), zrot()
include <lib/std.scad>

xrot(30) cube(5);
yrot(45) right(15) cube(5);
zrot(60) right(30) cube(5);
