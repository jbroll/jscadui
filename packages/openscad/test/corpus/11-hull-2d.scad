// Hull of two circles
linear_extrude(height=5) hull() {
  circle(r=5);
  translate([20, 0]) circle(r=3);
}
