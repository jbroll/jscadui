// The height must reach the UI as a slider, not a constant.
export const fixture = {
  name: 'cylinder-param',
  prompt: 'A cylinder with a slider for its height',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { params = [] } = {}) => {
    const [x, y, z] = m?.dimensions ?? [0, 0, 0]
    const ratio = x > 0 && z > 0 ? m.volume / (Math.PI * (x / 2) ** 2 * z) : 0
    return [
      { name: 'round cross-section', pass: x > 0 && Math.abs(y - x) <= x * 0.02 },
      { name: 'cylinder volume', pass: ratio > 0.95 && ratio < 1.01 },
      { name: 'height slider', pass: params.some((p) => p.type === 'slider') },
    ]
  },
}
