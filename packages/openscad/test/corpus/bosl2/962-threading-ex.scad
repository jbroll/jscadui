// Test BOSL2 threading: acme_threaded_rod()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/threading.scad>

acme_threaded_rod(d=3/8*INCH, l=20, pitch=1/8*INCH, $fn=32);
acme_threaded_rod(d=10, l=30, pitch=2, starts=3, $fa=1, $fs=1);
