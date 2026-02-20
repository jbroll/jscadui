// Text with direction parameter
union() {
  translate([0, 10, 0]) text("LTR", size = 8, direction = "ltr");
  text("RTL", size = 8, direction = "rtl");
}
