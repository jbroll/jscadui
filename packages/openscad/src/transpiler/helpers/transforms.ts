/**
 * Transform helper generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build transform helpers based on usage
 */
export function buildTransformHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  // Rotation helper for Euler angles
  if (ctx.usedTransforms.has('rotateX') || ctx.usedTransforms.has('rotateY') || ctx.usedTransforms.has('rotateZ')) {
    imports.push(`
const _rotate = (params, geo) => {
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
        t*nx*nx + c,    t*nx*ny + s*nz, t*nx*nz - s*ny, 0,  // column 0
        t*nx*ny - s*nz, t*ny*ny + c,    t*ny*nz + s*nx, 0,  // column 1
        t*nx*nz + s*ny, t*ny*nz - s*nx, t*nz*nz + c,    0,  // column 2
        0, 0, 0, 1                                           // column 3
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
}`)
  }

  // Multmatrix helper - applies a 4x4 transformation matrix
  if (ctx.usedTransforms.has('transform')) {
    imports.push(`
const _multmatrix = (m, geo) => {
  // OpenSCAD multmatrix uses row-major 4x4 or 4x3 matrix
  // JSCAD transform uses column-major flat array [m00,m10,m20,m30,m01,m11,...]
  // Flatten and transpose the matrix
  const flat = []
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < (m.length < 4 ? 3 : 4); row++) {
      flat.push(m[row] && m[row][col] !== undefined ? m[row][col] : (row === col ? 1 : 0))
    }
    if (m.length < 4) flat.push(col === 3 ? 1 : 0)  // Add homogeneous row if 4x3
  }
  return transform(flat, geo)
}`)
  }

  return imports
}
