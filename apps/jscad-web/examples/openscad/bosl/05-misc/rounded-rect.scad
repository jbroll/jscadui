// Rounded rectangle using hull
module rounded_rect(size = [20, 10], r = 2) {
    hull() {
        translate([r, r, 0]) circle(r = r);
        translate([size[0] - r, r, 0]) circle(r = r);
        translate([size[0] - r, size[1] - r, 0]) circle(r = r);
        translate([r, size[1] - r, 0]) circle(r = r);
    }
}

linear_extrude(height = 5)
    rounded_rect(size = [30, 15], r = 3);
