// Text with different vertical alignments
union() {
  translate([0, 20, 0]) text("Top", size = 8, valign = "top");
  translate([0, 10, 0]) text("Center", size = 8, valign = "center");
  text("Baseline", size = 8, valign = "baseline");
  translate([0, -10, 0]) text("Bottom", size = 8, valign = "bottom");
}
