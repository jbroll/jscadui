// Test BOSL2 threading: acme_threaded_nut()
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/threading.scad>

acme_threaded_nut(nutwidth=16, id=3/8*INCH, h=8, tpi=8, $slop=0.05);
acme_threaded_nut(nutwidth=16, id=3/8*INCH, h=10, tpi=12, starts=3, $slop=0.1, $fa=1, $fs=1, ibevel=false);
acme_threaded_nut(nutwidth=16, id=3/8*INCH, h=10, tpi=12, starts=3, $slop=0.1, $fa=1, $fs=1, blunt_start=false, $fn=32);
