// Test BOSL modulated_circle - 2D circle modulated by sine waves
include <lib/constants.scad>
use <lib/paths.scad>

linear_extrude(height=5) modulated_circle(r=30, sines=[[3, 8], [1, 24]]);
