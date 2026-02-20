// BOSL-style tube() - hollow cylinder
module tube(h = 10, ir = 5, or = 8) {
    difference() {
        cylinder(h = h, r = or);
        translate([0, 0, -0.1])
            cylinder(h = h + 0.2, r = ir);
    }
}

tube(h = 15, ir = 4, or = 6);
