// Reads anchor frames attached to geometry as { frames, basis }; a minimal reader of the
// @jbroll/jscad-anchors storage format, kept browser-safe on @jscad/modeling maths.

import jscad from '@jscad/modeling'

const { geometries, maths } = jscad

const { geom2, geom3 } = geometries
const { mat4, vec3 } = maths

const UP = [0, 0, 1]
const DOWN = [0, 0, -1]

const point3 = (v) => [v[0], v[1], v[2] || 0]

// BOSL2 affine3d_rot_from_to(UP, z): axis from vector_axis, which picks BACK for DOWN.
const rotationFromUp = (z) => {
  const w = vec3.normalize(vec3.create(), point3(z))
  if (vec3.distance(w, UP) < 1e-9) return mat4.create()
  const axis =
    vec3.distance(w, DOWN) < 1e-9 ? [0, 1, 0] : vec3.normalize(vec3.create(), vec3.cross(vec3.create(), UP, w))
  const angle = Math.acos(Math.max(-1, Math.min(1, w[2])))
  return mat4.fromRotation(mat4.create(), angle, axis)
}

const spinReference = (z) => point3(vec3.transform(vec3.create(), [1, 0, 0], rotationFromUp(z)))

const frame = (origin, z, x) => {
  if (!(vec3.length(point3(z)) > 1e-12)) throw new Error('frame: z must be a non-zero vector')
  const zn = vec3.normalize(vec3.create(), point3(z))
  let xn = null
  if (x) {
    const xv = point3(x)
    const xo = vec3.subtract(vec3.create(), xv, vec3.scale(vec3.create(), zn, vec3.dot(xv, zn)))
    if (vec3.length(xo) > 1e-6 * vec3.length(xv)) xn = vec3.normalize(xo, xo)
  }
  if (!xn) xn = spinReference(zn)
  return { origin: point3(origin), z: point3(zn), x: point3(xn) }
}

const linear = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
]

const transformFrame = (matrix, f) =>
  frame(vec3.transform(vec3.create(), f.origin, matrix), linear(matrix, f.z), linear(matrix, f.x))

const mapFrames = (frames, fn) =>
  Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, fn(f, name)]))

const basisOf = (geometry) => {
  if (geom3.isA(geometry)) return geometry.polygons
  if (geom2.isA(geometry)) return geometry.sides
  return undefined
}

const localFrames = (geometry) => {
  const anchors = geometry && geometry.anchors
  if (!anchors) return {}
  if (basisOf(geometry) !== anchors.basis) throw new Error('anchors: geometry was baked outside jscad-anchors')
  return anchors.frames
}

const worldFrames = (geometry) => {
  const local = localFrames(geometry)
  if (!geometry || !geometry.transforms || mat4.isIdentity(geometry.transforms)) return local
  return mapFrames(local, (f) => transformFrame(geometry.transforms, f))
}

export const anchors = (geometry) => {
  if (!basisOf(geometry)) throw new Error('anchors: geometry must be geom2 or geom3')
  return worldFrames(geometry)
}