// L bracket with countersunk holes: countersink presence isn't checkable from
// bbox/volume alone, so this only checks the bracket's shape and size.
export const fixture = {
  name: 'shelf-bracket',
  prompt: 'An L bracket to hold a shelf, with countersunk screw holes',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const bboxVolume = dims[0] * dims[1] * dims[2]
    return [
      { name: 'L-shaped, not a flat plate', pass: volume > 0 && volume < bboxVolume * 0.5 },
      { name: 'plausible size', pass: dims.every((d) => d >= 20 && d <= 250) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
