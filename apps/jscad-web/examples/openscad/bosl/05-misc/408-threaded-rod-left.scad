// Test BOSL threaded_rod - left-handed thread
include <lib/constants.scad>
use <lib/threading.scad>

threaded_rod(d=10, l=20, pitch=2, left_handed=true);
