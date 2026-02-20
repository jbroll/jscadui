// Text with different spacing
union() {
  translate([0, 20, 0]) text("Tight", size = 8, spacing = 0.8);
  translate([0, 10, 0]) text("Normal", size = 8, spacing = 1.0);
  text("Wide", size = 8, spacing = 1.2);
}
