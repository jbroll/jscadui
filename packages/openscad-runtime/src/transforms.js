/**
 * Transform helpers for OpenSCAD compatibility
 */

import { NO_CHILD } from './primitives.js'
import { consuming } from './consume.js'

// Filter null/undefined/NO_CHILD from geometry arrays before passing to JSCAD.
// OpenSCAD silently ignores absent children; JSCAD throws on null array elements.
const filterGeo = (geo) => {
  if (!Array.isArray(geo)) return geo
  const filtered = geo.filter(g => g != null && g !== NO_CHILD)
  return filtered.length === 0 ? undefined : filtered
}

// JSCAD transforms - injected at init time
let translate, rotateX, rotateY, rotateZ, scale, mirror, transform, measureBoundingBox

export const initTransforms = (jscad) => {
  translate = consuming(jscad.transforms.translate)
  rotateX = consuming(jscad.transforms.rotateX)
  rotateY = consuming(jscad.transforms.rotateY)
  rotateZ = consuming(jscad.transforms.rotateZ)
  scale = consuming(jscad.transforms.scale)
  mirror = consuming(jscad.transforms.mirror)
  transform = consuming(jscad.transforms.transform)
  measureBoundingBox = jscad.measurements.measureBoundingBox
}

// Translate helper
export const _translate = (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  // v can be [x,y] or [x,y,z] or an object with v property
  const vec = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  const [x = 0, y = 0, z = 0] = Array.isArray(vec) ? vec : [0, 0, 0]
  return translate([x, y, z], g)
}

// Scale helper
export const _scale = (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  // v can be a number (uniform), [x,y] or [x,y,z] or an object with v property
  const val = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  if (typeof val === 'number') {
    return scale([val, val, val], g)
  }
  const [x = 1, y = 1, z = 1] = Array.isArray(val) ? val : [1, 1, 1]
  return scale([x, y, z], g)
}

// Mirror helper
export const _mirror = (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  // OpenSCAD reads a short normal such as [0, 1] or [1] with zeros for the
  // missing components; jscad builds its plane from all three, so a missing
  // one makes the plane NaN.
  const normal = Array.isArray(v) && v.length < 3 ? [v[0] ?? 0, v[1] ?? 0, 0] : v
  // OpenSCAD treats a zero normal as identity
  if (Array.isArray(normal) && normal[0] === 0 && normal[1] === 0 && normal[2] === 0) return g
  return mirror({ normal }, g)
}

// Rotation helper for Euler angles
export const _rotate = (params, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  geo = g
  const toRad = d => d * Math.PI / 180
  // OpenSCAD (checked against 2026.09): an angle that is neither a number nor a
  // list (undef, a string) is no rotation; a number with an axis that is not a
  // 3-vector of numbers (undef, [0,1,0,0]) rotates about Z.
  const isNum = x => typeof x === 'number'
  const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum)
  // Handle object form: rotate(a=angle, v=[x,y,z]) or rotate(a=angle)
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const a = params.a
    // If a is an array (Euler angles), handle like rotate([x, y, z])
    if (Array.isArray(a)) {
      let result = geo
      if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
      if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
      if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
      return result
    }
    if (!isNum(a)) return geo
    const angle = toRad(a)
    if (isVec3(params.v)) {
      // Axis-angle rotation with explicit axis
      const [x, y, z] = params.v
      // Rodrigues' rotation formula via mat4
      const len = Math.sqrt(x*x + y*y + z*z)
      if (len < 0.0001) return geo
      const nx = x/len, ny = y/len, nz = z/len
      const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
      // Build rotation matrix in column-major order for JSCAD's transform
      const m = [
        t*nx*nx + c,    t*nx*ny + s*nz, t*nx*nz - s*ny, 0,
        t*nx*ny - s*nz, t*ny*ny + c,    t*ny*nz + s*nx, 0,
        t*nx*nz + s*ny, t*ny*nz - s*nx, t*nz*nz + c,    0,
        0, 0, 0, 1
      ]
      return transform(m, geo)
    }
    // No axis specified, rotate around Z (like rotate(a))
    return angle !== 0 ? rotateZ(angle, geo) : geo
  }
  // Handle Euler angles: rotate([x, y, z]) or rotate(z)
  if (!Array.isArray(params) && !isNum(params)) return geo
  const a = Array.isArray(params) ? params : [0, 0, params]
  let result = geo
  if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
  if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
  if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
  return result
}

// Resize helper - scales geometry to fit target dimensions
// newsize[i] = 0 means keep that axis unchanged
export const _resize = (newsize, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  geo = g
  const bounds = measureBoundingBox(geo)
  const curSize = [
    bounds[1][0] - bounds[0][0],
    bounds[1][1] - bounds[0][1],
    bounds[1][2] - bounds[0][2],
  ]
  const factors = newsize.map((s, i) => (s > 0 && curSize[i] > 0) ? s / curSize[i] : 1)
  return scale(factors, geo)
}

// Multmatrix helper - applies a 4x4 transformation matrix
export const _multmatrix = (m, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  geo = g
  // OpenSCAD multmatrix uses row-major 4x4 or 4x3 matrix
  // JSCAD transform uses column-major flat array [m00,m10,m20,m30,m01,m11,...]
  const flat = []
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < (m.length < 4 ? 3 : 4); row++) {
      flat.push(m[row] && m[row][col] !== undefined ? m[row][col] : (row === col ? 1 : 0))
    }
    if (m.length < 4) flat.push(col === 3 ? 1 : 0)
  }
  return transform(flat, geo)
}
