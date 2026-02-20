// Test BOSL trapezoidal_threaded_rod - core threading module
include <lib/constants.scad>
use <lib/threading.scad>

trapezoidal_threaded_rod(d=12, l=25, pitch=3, thread_angle=20);
