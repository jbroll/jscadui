/**
 * Transform helpers for OpenSCAD compatibility
 */

// JSCAD transforms - injected at init time
let translate, rotateX, rotateY, rotateZ, scale, mirror, transform

export const initTransforms = (jscad) => {
  translate = jscad.transforms.translate
  rotateX = jscad.transforms.rotateX
  rotateY = jscad.transforms.rotateY
  rotateZ = jscad.transforms.rotateZ
  scale = jscad.transforms.scale
  mirror = jscad.transforms.mirror
  transform = jscad.transforms.transform
}

// Translate helper
export const _translate = (v, geo) => {
  if (geo === undefined) return geo
  // v can be [x,y] or [x,y,z] or an object with v property
  const vec = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  const [x = 0, y = 0, z = 0] = Array.isArray(vec) ? vec : [0, 0, 0]
  return translate([x, y, z], geo)
}

// Scale helper
export const _scale = (v, geo) => {
  if (geo === undefined) return geo
  // v can be a number (uniform), [x,y] or [x,y,z] or an object with v property
  const val = (v && typeof v === 'object' && !Array.isArray(v)) ? v.v : v
  if (typeof val === 'number') {
    return scale([val, val, val], geo)
  }
  const [x = 1, y = 1, z = 1] = Array.isArray(val) ? val : [1, 1, 1]
  return scale([x, y, z], geo)
}

// Mirror helper
export const _mirror = (v, geo) => {
  if (geo === undefined) return geo
  // v is the normal vector [x, y, z]
  return mirror({ normal: v }, geo)
}

// Rotation helper for Euler angles
export const _rotate = (params, geo) => {
  const toRad = d => d * Math.PI / 180
  // Handle object form: rotate(a=angle, v=[x,y,z]) or rotate(a=angle)
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const angle = toRad(params.a || 0)
    if (params.v !== undefined) {
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
  const a = Array.isArray(params) ? params : [0, 0, params]
  let result = geo
  if (a[0] !== 0) result = rotateX(toRad(a[0]), result)
  if (a[1] !== 0) result = rotateY(toRad(a[1]), result)
  if (a[2] !== 0) result = rotateZ(toRad(a[2]), result)
  return result
}

// Multmatrix helper - applies a 4x4 transformation matrix
export const _multmatrix = (m, geo) => {
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
