// Modified: BOSL/transforms.scad → lib/transforms.scad for normalized library paths
use <lib/transforms.scad>

// Test basic transform functions
union() {
  // Axis-specific moves
  up(10) cube(3);
  down(5) cube(3);
  left(5) cube(3);
  right(10) cube(3);
  fwd(5) cube(3);
  back(10) cube(3);
}
