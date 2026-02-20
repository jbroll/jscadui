// Mirrored object
union() {
  translate([5, 0, 0]) cube([10, 5, 3]);
  mirror([1, 0, 0]) translate([5, 0, 0]) cube([10, 5, 3]);
}
