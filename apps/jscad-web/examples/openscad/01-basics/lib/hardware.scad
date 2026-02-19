// Simple hardware library for testing use statements

module Bolt(length = 20, diameter = 5) {
    cylinder(h = length, d = diameter, $fn = 16);
}

module Nut(size = 10) {
    cylinder(h = size/2, d = size, $fn = 6);
}

module Washer(outer = 12, inner = 6, thickness = 2) {
    difference() {
        cylinder(h = thickness, d = outer, $fn = 32);
        cylinder(h = thickness + 1, d = inner, $fn = 32);
    }
}
