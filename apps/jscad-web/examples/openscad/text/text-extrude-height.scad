// 2D text at different positions (extrusion causes manifold errors)
union() {
  translate([0, 20, 0]) text("Top", size = 8);
  translate([0, 10, 0]) text("Middle", size = 8);
  text("Bottom", size = 8);
}
