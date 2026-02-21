// Test BOSL2 vnf_vertex_array
include <lib/std.scad>

pts = [
    for (z=[0:5:20]) [for (a=[0:30:330]) [10*cos(a), 10*sin(a), z]]
];
vnf_vertex_array(pts, caps=true, col_wrap=true);
