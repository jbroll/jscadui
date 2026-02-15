// Test BOSL2 miscellaneous: cylindrical_extrude() - Basic example with defaults.  This will run faster with large facet counts if you set `size=100`
// Extracted from BOSL2 library examples
include <lib/std.scad>

cylindrical_extrude(or=50, ir=45)
    text(text="Hello World!", size=10, halign="center", valign="center", $fn=32);
