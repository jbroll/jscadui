/**
 * Transform helpers for OpenSCAD compatibility
 */

import { NO_CHILD } from './sentinels.js'
import { consuming } from './consume.js'
import { affine, IDENTITY, mul } from './overlay.js'

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

const toRad = d => d * Math.PI / 180
const isNum = x => typeof x === 'number'
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum)

const translationMatrix = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
const scaleMatrix = ([x, y, z]) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]
const rotateXMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1] }
const rotateYMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }
const rotateZMatrix = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }

const translateVector = (v) => {
  // v can be [x,y] or [x,y,z] or an object with v property
  const vec = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  const [x = 0, y = 0, z = 0] = Array.isArray(vec) ? vec : [0, 0, 0]
  return [x, y, z]
}

const scaleVector = (v) => {
  // v can be a number (uniform), [x,y] or [x,y,z] or an object with v property
  const val = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  if (typeof val === 'number') return [val, val, val]
  const [x = 1, y = 1, z = 1] = Array.isArray(val) ? val : [1, 1, 1]
  return [x, y, z]
}

// OpenSCAD reads a short normal such as [0, 1] or [1] with zeros for the
// missing components; jscad builds its plane from all three, so a missing
// one makes the plane NaN.
const mirrorNormal = (v) => Array.isArray(v) && v.length < 3 ? [v[0] ?? 0, v[1] ?? 0, 0] : v
// OpenSCAD treats a zero normal as identity
const isZeroNormal = (n) => Array.isArray(n) && n[0] === 0 && n[1] === 0 && n[2] === 0

const mirrorMatrix = (v) => {
  const n = mirrorNormal(v)
  if (!Array.isArray(n) || isZeroNormal(n)) return IDENTITY
  const len = Math.hypot(n[0], n[1], n[2])
  const [x, y, z] = [n[0] / len, n[1] / len, n[2] / len]
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, 0, -2 * x * y, 1 - 2 * y * y, -2 * y * z, 0, -2 * x * z, -2 * y * z, 1 - 2 * z * z, 0, 0, 0, 0, 1]
}

// Rodrigues' rotation formula, column-major for JSCAD's transform; null for a
// near-zero axis, which OpenSCAD treats as no rotation.
const axisAngleMatrix = (angle, [x, y, z]) => {
  const len = Math.sqrt(x*x + y*y + z*z)
  if (len < 0.0001) return null
  const nx = x/len, ny = y/len, nz = z/len
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [
    t*nx*nx + c,    t*nx*ny + s*nz, t*nx*nz - s*ny, 0,
    t*nx*ny - s*nz, t*ny*ny + c,    t*ny*nz + s*nx, 0,
    t*nx*nz + s*ny, t*ny*nz - s*nx, t*nz*nz + c,    0,
    0, 0, 0, 1
  ]
}

const eulerMatrix = (a) => {
  let m = IDENTITY
  if (a[0] !== 0) m = mul(rotateXMatrix(toRad(a[0])), m)
  if (a[1] !== 0) m = mul(rotateYMatrix(toRad(a[1])), m)
  if (a[2] !== 0) m = mul(rotateZMatrix(toRad(a[2])), m)
  return m
}

// Mirrors _rotate's argument handling below, as a matrix for overlays.
const rotateMatrix = (params) => {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const a = params.a
    if (Array.isArray(a)) return eulerMatrix(a)
    if (!isNum(a)) return IDENTITY
    if (isVec3(params.v)) return axisAngleMatrix(toRad(a), params.v) ?? IDENTITY
    return a !== 0 ? rotateZMatrix(toRad(a)) : IDENTITY
  }
  if (!Array.isArray(params) && !isNum(params)) return IDENTITY
  return eulerMatrix(Array.isArray(params) ? params : [0, 0, params])
}

// OpenSCAD multmatrix uses row-major 4x4 or 4x3 matrix
// JSCAD transform uses column-major flat array [m00,m10,m20,m30,m01,m11,...]
const flatMatrix = (m) => {
  const flat = []
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < (m.length < 4 ? 3 : 4); row++) {
      flat.push(m[row] && m[row][col] !== undefined ? m[row][col] : (row === col ? 1 : 0))
    }
    if (m.length < 4) flat.push(col === 3 ? 1 : 0)
  }
  return flat
}

// newsize[i] = 0 means keep that axis unchanged
const resizeFactors = (newsize, geo) => {
  const bounds = measureBoundingBox(geo)
  const curSize = [
    bounds[1][0] - bounds[0][0],
    bounds[1][1] - bounds[0][1],
    bounds[1][2] - bounds[0][2],
  ]
  return newsize.map((s, i) => (s > 0 && curSize[i] > 0) ? s / curSize[i] : 1)
}

export const _translate = affine((v) => translationMatrix(translateVector(v)), (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return translate(translateVector(v), g)
})

export const _scale = affine((v) => scaleMatrix(scaleVector(v)), (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return scale(scaleVector(v), g)
})

export const _mirror = affine(mirrorMatrix, (v, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  const normal = mirrorNormal(v)
  if (isZeroNormal(normal)) return g
  return mirror({ normal }, g)
})

// Rotation helper for Euler angles
export const _rotate = affine(rotateMatrix, (params, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  geo = g
  // OpenSCAD (checked against 2026.09): an angle that is neither a number nor a
  // list (undef, a string) is no rotation; a number with an axis that is not a
  // 3-vector of numbers (undef, [0,1,0,0]) rotates about Z.
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
      const m = axisAngleMatrix(angle, params.v)
      return m ? transform(m, geo) : geo
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
})

// Resize helper - scales geometry to fit target dimensions
const resizeMatrix = (newsize, geo) => {
  const g = geo === NO_CHILD ? undefined : filterGeo(geo)
  return g == null ? IDENTITY : scaleMatrix(resizeFactors(newsize, g))
}

export const _resize = affine(resizeMatrix, (newsize, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return scale(resizeFactors(newsize, g), g)
})

// Multmatrix helper - applies a 4x4 transformation matrix
export const _multmatrix = affine(flatMatrix, (m, geo) => {
  if (geo === NO_CHILD) return NO_CHILD
  const g = filterGeo(geo)
  if (g == null) return undefined
  return transform(flatMatrix(m), g)
})
