// Test BOSL nil and noop - empty/passthrough modules
include <lib/constants.scad>
use <lib/shapes.scad>

union() {
    // nil() produces nothing
    nil();
    // noop() passes children through unchanged
    noop() cube(10);
}
