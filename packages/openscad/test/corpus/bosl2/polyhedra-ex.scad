// Test BOSL2 polyhedra: regular_polyhedron() - Rounded octahedron
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/polyhedra.scad>

regular_polyhedron("octahedron", side=1, rounding=.2, $fn=32);
