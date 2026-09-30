// 20mm cube with a through-hole: boolean correctness plus net volume.
export const fixture = {
  name: 'cube-hole',
  prompt: 'A 20mm cube with a hole through the middle',
  requires: ['measure', 'write'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  target: { dimensions: [20, 20, 20] },
  checks: (m, { solid } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const solidVolume = 20 * 20 * 20
    return [
      { name: '20mm in every axis', pass: dims.every((d) => Math.abs(d - 20) < 0.5) },
      { name: 'a hole removes material but leaves most of it', pass: volume < solidVolume * 0.95 && volume > solidVolume * 0.5 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
