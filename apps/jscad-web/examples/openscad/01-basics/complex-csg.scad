// Complex CSG operations
difference() {
  union() {
    cube([20, 20, 20], center=true);
    translate([0, 0, 10]) sphere(r=8);
  }
  cylinder(h=30, r=5, center=true);
  rotate([90, 0, 0]) cylinder(h=30, r=5, center=true);
  rotate([0, 90, 0]) cylinder(h=30, r=5, center=true);
}
