// Hardware library
module Bolt(length = 20, diameter = 5) {
  cylinder(h = length, r = diameter/2);
}

module Nut(size = 10) {
  difference() {
    cube(size, center = true);
    cylinder(h = size + 1, r = size/4, center = true);
  }
}

module Washer(outer = 12, inner = 6, thickness = 2) {
  difference() {
    cylinder(h = thickness, r = outer/2);
    cylinder(h = thickness + 1, r = inner/2);
  }
}
