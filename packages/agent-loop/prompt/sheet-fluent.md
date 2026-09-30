## API reference

Common calls, with option defaults. Angles are radians; `TAU` is `2 * Math.PI`.
`docs` gives full details for anything not listed.
A line starting with `.` is a method: `shape.translate([0, 0, 5])`.

```
// 3D shapes
jf.cube({ center = [0,0,0], size = 2 })
jf.cuboid({ center = [0,0,0], size = [2,2,2] })
jf.roundedCuboid({ center = [0,0,0], size = [2,2,2], roundRadius = 0.2, segments = 32 })
jf.cylinder({ height = 1, segments = 32, center = [0,0,0], angle = [0,TAU], radius = 1, outer, inner, wall }) // radians
jf.cylinderElliptic({ center = [0,0,0], height = 2, startRadius = [1,1], startAngle = 0, endRadius = [1,1], endAngle = TAU, segments = 32 }) // radians
jf.roundedCylinder({ center = [0,0,0], height = 2, radius = 1, roundRadius = 0.2, segments = 32 })
jf.sphere({ center = [0,0,0], radius = 1, segments = 32, axes })
jf.ellipsoid({ center = [0,0,0], radius = [1,1,1], segments = 32, axes })
jf.geodesicSphere({ radius = 1, frequency = 6 })
jf.torus({ innerRadius = 1, outerRadius = 4, innerSegments = 32, outerSegments = 32, innerRotation = 0, outerRotation = TAU, startAngle = 0 }) // radians
jf.polyhedron({ points, faces })

// 2D shapes
jf.square({ center = [0,0], size = 2 })
jf.rectangle({ center = [0,0], size = [2,2] })
jf.roundedRectangle({ center = [0,0], size = [2,2], roundRadius = 0.2, segments = 32 })
jf.circle({ center = [0,0], radius = 1, startAngle = 0, endAngle = TAU, segments = 32 }) // radians
jf.ellipse({ center = [0,0], radius = [1,1], startAngle = 0, endAngle = TAU, segments = 32 }) // radians
jf.polygon(points: Point2[])
jf.star({ center = [0,0], vertices = 5, density = 2, outerRadius = 1, innerRadius = 0, startAngle = 0 }) // radians
jf.triangle({ type = 'SSS', values = [1,1,1] })
jf.arc({ center = [0,0], radius = 1, startAngle = 0, endAngle = TAU, segments = 32, makeTangent = false }) // radians
jf.line(points: Point2[])

// Booleans
jf.union(...geometries)
jf.subtract(...geometries)
jf.intersect(...geometries)
.union(...others)
.subtract(...others)
.intersect(...others)

// Transforms
.translate(offset: Vec3)
.translateX(offset: number)
.translateY(offset: number)
.translateZ(offset: number)
.rotate(angle: Vec3) // radians
.rotateX(angle: number) // radians
.rotateY(angle: number) // radians
.rotateZ(angle: number) // radians
.scale(factor: Vec3)
.scaleX(factor: number)
.scaleY(factor: number)
.scaleZ(factor: number)
.mirror({ origin = [0,0,0], normal = [0,0,1] })
.mirrorX()
.mirrorY()
.mirrorZ()
.center({ axes = [true,true,true], relativeTo = [0,0,0] })
.centerX()
.centerY()
.centerZ()
.align({ modes = ['center', 'center', 'min'], relativeTo = [0,0,0], grouped = false })
jf.align({ modes = ['center', 'center', 'min'], relativeTo = [0,0,0], grouped = false }, ...geometries)

// Extrusions, of 2D shapes
.extrudeLinear({ height = 1, twistAngle = 0, twistSteps = 1, repair = true }) // radians
.extrudeRotate({ angle = TAU, startAngle = 0, overflow = 'cap', segments = 12 }) // radians
.extrudeRectangular({ size = 1, height = 1, delta = 1, corners = 'edge', segments = 16, twistAngle = 0, twistSteps = 1, repair = true }) // radians
.extrudeHelical({ angle = TAU, startAngle = 0, pitch = 10, height, endOffset = 0, segmentsPerRotation = 32 }) // radians

// Expansions
.expand({ delta = 1, corners = 'edge', segments = 16 })
.offset({ delta = 1, corners = 'edge', segments = 16 })

// Hulls, of one shape or of an array
jf.geom3Array(...items)
jf.geom2Array(...items)
.hull()
.hullChain()

// Color and measurement
.colorize(color: RGB | RGBA)
.measureDimensions()
.measureBoundingBox()
.measureCenter()
.measureVolume()
.measureArea()

// Other
.snap()
.clone()
```
