// L-bracket: shape (L, not a slab) matters more than any one exact dimension.
export const fixture = {
  name: 'bracket',
  prompt: 'An L-bracket for a shelf, about 60mm wide',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m, { solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const bboxVolume = dims[0] * dims[1] * dims[2]
    return [
      { name: 'about 60mm wide', pass: dims.some((d) => d >= 50 && d <= 70) },
      { name: 'L-shaped, not a solid block', pass: volume > 0 && volume < bboxVolume * 0.5 },
      { name: 'plausible size', pass: dims.every((d) => d >= 3 && d <= 200) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
