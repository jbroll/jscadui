/** 
 * Produce directly a 4x4 matrix that does the rotation based on the rotation angles provided for X and Z
 * @param {Number} rx - rotation on X axis
 * @param {Number} rz  - rotation on Z axis
 * @returns {import('gl-matrix').mat4}
 */
export const fromXZRotation = (rx, rz) => {
  // L6 fix: Removed commented-out dead code, changed var to const
  const zs = Math.sin(rz)
  const zc = Math.cos(rz)
  const xs = Math.sin(rx)
  const xc = Math.cos(rx)
  return [zc, zs, 0, 0, -zs * xc, zc * xc, xs, 0, -zs * -xs, zc * -xs, xc, 0, 0, 0, 0, 1]
}
