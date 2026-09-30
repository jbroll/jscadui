// T fitting for 20mm pipe: the pipe's OD or socket sets the smallest dimension.
export const fixture = {
  name: 'pipe-tee',
  prompt: 'A T fitting for 20mm pipe',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m, { solid } = {}) => {
    const [smallest, mid, largest] = [...(m?.dimensions ?? [0, 0, 0])].sort((a, b) => a - b)
    const volume = m?.volume ?? 0
    const bboxVolume = smallest * mid * largest
    return [
      { name: 'sized for 20mm pipe', pass: smallest >= 20 && smallest <= 40 },
      { name: 'three arms extend past the fitting', pass: mid >= 36 && largest >= 40 },
      { name: 'hollow bore, not a solid tee', pass: volume > 0 && volume < bboxVolume * 0.45 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
