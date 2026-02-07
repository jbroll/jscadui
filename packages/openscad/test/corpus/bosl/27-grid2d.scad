// BOSL-style grid2d() - 2D grid of children
module grid2d(size = [10, 10], count = [3, 3]) {
    sx = size[0] / (count[0] - 1);
    sy = size[1] / (count[1] - 1);
    for (i = [0 : count[0] - 1]) {
        for (j = [0 : count[1] - 1]) {
            translate([i * sx - size[0]/2, j * sy - size[1]/2, 0])
                children();
        }
    }
}

grid2d(size = [20, 20], count = [3, 3]) sphere(1);
