// Text with different sizes - separate, non-extruded
union() {
  translate([-20, 20, 0]) text("6", size = 6);
  translate([-10, 10, 0]) text("8", size = 8);
  translate([0, 0, 0]) text("10", size = 10);
  translate([0, -15, 0]) text("12", size = 12);
}
