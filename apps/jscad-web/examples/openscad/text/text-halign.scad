// Text with different horizontal alignments
union() {
  translate([0, 20, 0]) text("Left", size = 8, halign = "left");
  translate([0, 10, 0]) text("Center", size = 8, halign = "center");
  text("Right", size = 8, halign = "right");
}
