// Text with language parameter
union() {
  translate([0, 20, 0]) text("English", size = 8, language = "en");
  translate([0, 10, 0]) text("Français", size = 8, language = "fr");
  text("Español", size = 8, language = "es");
}
