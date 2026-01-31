/** 
 * Produce directly a 4x4 matrix that does the rotation based on the rotation angles provided for X and Z
 * @param {Number} rx - rotation on X axis
 * @param {Number} rz  - rotation on Z axis
 * @returns {import('gl-matrix').mat4}
 */
export const fromXZRotation = (rx, rz) => {
  // L10 fix: Validate inputs to prevent NaN propagation through matrix calculations
  if (!Number.isFinite(rx) || !Number.isFinite(rz)) {
    // Return identity matrix for invalid inputs
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  }
  const zs = Math.sin(rz)
  const zc = Math.cos(rz)
  const xs = Math.sin(rx)
  const xc = Math.cos(rx)
  return [zc, zs, 0, 0, -zs * xc, zc * xc, xs, 0, -zs * -xs, zc * -xs, xc, 0, 0, 0, 0, 1]
}
