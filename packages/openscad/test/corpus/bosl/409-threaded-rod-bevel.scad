// Test BOSL threaded_rod with bevel
include <lib/constants.scad>
use <lib/threading.scad>

threaded_rod(d=10, l=20, pitch=2, bevel=true);
