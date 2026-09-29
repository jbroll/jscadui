## API reference

Common calls, with option defaults. Angles are radians; `TAU` is `2 * Math.PI`.
`docs` gives full details for anything not listed.

```
// 3D shapes
primitives.cube({ center = [0,0,0], size = 2 })
primitives.cuboid({ center = [0,0,0], size = [2,2,2] })
primitives.roundedCuboid({ center = [0,0,0], size = [2,2,2], roundRadius = 0.2, segments = 32 })
primitives.cylinder({ center = [0,0,0], height = 2, radius = 1, segments = 32 })
primitives.cylinderElliptic({ center = [0,0,0], height = 2, startRadius = [1,1], startAngle = 0, endRadius = [1,1], endAngle = TAU, segments = 32 }) // radians
primitives.roundedCylinder({ center = [0,0,0], height = 2, radius = 1, roundRadius = 0.2, segments = 32 })
primitives.sphere({ center = [0,0,0], radius = 1, segments = 32, axes })
primitives.ellipsoid({ center = [0,0,0], radius = [1,1,1], segments = 32, axes })
primitives.geodesicSphere({ radius = 1, frequency = 6 })
primitives.torus({ innerRadius = 1, outerRadius = 4, innerSegments = 32, outerSegments = 32, innerRotation = 0, outerRotation = TAU, startAngle = 0 }) // radians
primitives.polyhedron({ points, faces, colors = undefined, orientation = 'outward' })

// 2D shapes
primitives.square({ center = [0,0], size = 2 })
primitives.rectangle({ center = [0,0], size = [2,2] })
primitives.roundedRectangle({ center = [0,0], size = [2,2], roundRadius = 0.2, segments = 32 })
primitives.circle({ center = [0,0], radius = 1, startAngle = 0, endAngle = TAU, segments = 32 }) // radians
primitives.ellipse({ center = [0,0], radius = [1,1], startAngle = 0, endAngle = TAU, segments = 32 }) // radians
primitives.polygon({ points, paths, orientation = 'counterclockwise' })
primitives.star({ center = [0,0], vertices = 5, density = 2, outerRadius = 1, innerRadius = 0, startAngle = 0 }) // radians
primitives.triangle({ type = 'SSS', values = [1,1,1] })
primitives.arc({ center = [0,0], radius = 1, startAngle = 0, endAngle = TAU, segments = 32, makeTangent = false }) // radians
primitives.line(points: Array)

// Booleans
booleans.union(...geometries)
booleans.subtract(...geometries)
booleans.intersect(...geometries)

// Transforms
transforms.translate(offset: Array, ...objects)
transforms.translateX(offset: Number, ...objects)
transforms.translateY(offset: Number, ...objects)
transforms.translateZ(offset: Number, ...objects)
transforms.rotate(angles: Array, ...objects) // radians
transforms.rotateX(angle: Number, ...objects) // radians
transforms.rotateY(angle: Number, ...objects) // radians
transforms.rotateZ(angle: Number, ...objects) // radians
transforms.scale(factors: Array, ...objects)
transforms.scaleX(factor: Number, ...objects)
transforms.scaleY(factor: Number, ...objects)
transforms.scaleZ(factor: Number, ...objects)
transforms.mirror({ origin = [0,0,0], normal = [0,0,1] }, ...objects)
transforms.mirrorX(...objects)
transforms.mirrorY(...objects)
transforms.mirrorZ(...objects)
transforms.center({ axes = [true,true,true], relativeTo = [0,0,0] }, ...objects)
transforms.centerX(...objects)
transforms.centerY(...objects)
transforms.centerZ(...objects)
transforms.align({ modes = ['center', 'center', 'min'], relativeTo = [0,0,0], grouped = false }, ...geometries)

// Extrusions, of 2D shapes
extrusions.extrudeLinear({ height = 1, twistAngle = 0, twistSteps = 1, repair = true }, ...objects) // radians
extrusions.extrudeRotate({ angle = TAU, startAngle = 0, overflow = 'cap', segments = 12 }, geometry: geom2) // radians
extrusions.extrudeRectangular({ size = 1, height = 1, delta = 1, corners = 'edge', segments = 16, twistAngle = 0, twistSteps = 1, repair = true }, ...objects) // radians
extrusions.extrudeHelical({ angle = TAU, startAngle = 0, pitch = 10, height, endOffset = 0, segmentsPerRotation = 32 }, geometry: geom2) // radians

// Expansions
expansions.expand({ delta = 1, corners = 'edge', segments = 16 }, ...objects)
expansions.offset({ delta = 1, corners = 'edge', segments = 16 }, ...objects)

// Hulls
hulls.hull(...geometries)
hulls.hullChain(...geometries)

// Color and measurement
colors.colorize(color: Array, objects)
measurements.measureDimensions(...geometries)
measurements.measureBoundingBox(...geometries)
measurements.measureCenter(...geometries)
measurements.measureVolume(...geometries)
measurements.measureArea(...geometries)

// Other
modifiers.snap(...geometries)
```
