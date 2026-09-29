// Phone stand: shape and lean unstated, so checks only judge plausible size and hollowness.
export const fixture = {
  name: 'phone-stand',
  prompt: 'A phone stand for my desk',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const bboxVolume = dims[0] * dims[1] * dims[2]
    return [
      { name: 'desk-scale', pass: dims.every((d) => d >= 40 && d <= 250) },
      { name: 'not a solid block', pass: volume > 0 && volume < bboxVolume * 0.6 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
