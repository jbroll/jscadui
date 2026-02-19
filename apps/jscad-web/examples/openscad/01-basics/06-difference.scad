// Difference: cube with hole
difference() {
    cube(20, center=true);
    cylinder(h=25, r=5, center=true, $fn=32);
}
