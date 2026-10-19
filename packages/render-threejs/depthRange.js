// Fixed clip planes cut off models far larger than the default view, so both
// planes follow the orbit distance and keep the same near/far ratio.
const NEAR_FRACTION = 1 / 100
const FAR_MULTIPLE = 1000

/**
 * @param {number[]} position
 * @param {number[]} target
 * @returns {{ near: number, far: number } | null}
 */
export const depthRange = (position, target) => {
  const distance = Math.hypot(...position.map((v, i) => v - target[i]))
  if (!Number.isFinite(distance) || distance === 0) return null
  return { near: distance * NEAR_FRACTION, far: distance * FAR_MULTIPLE }
}
