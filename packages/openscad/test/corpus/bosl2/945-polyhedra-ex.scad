// Test BOSL2 polyhedra: regular_polyhedron() - Third Archimedean solid
// Extracted from BOSL2 library examples
include <lib/std.scad>
include <lib/polyhedra.scad>

regular_polyhedron(type="archimedean", index=2, $fn=32);
