use <lib/transforms.scad>

// Test rotation functions
union() {
  xrot(45) cube(5);
  translate([15, 0, 0]) yrot(45) cube(5);
  translate([30, 0, 0]) zrot(45) cube(5);
}
