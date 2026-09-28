// The first-time request that exposed Muse 1.3 contributor's import mistakes.
export const fixture = {
  name: 'single-sphere',
  prompt: 'A single sphere',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  checks: (m) => {
    const [x, y, z] = m?.dimensions ?? [0, 0, 0]
    const ratio = x > 0 ? m.volume / ((4 / 3) * Math.PI * (x / 2) ** 3) : 0
    return [
      { name: 'round in every axis', pass: x > 0 && Math.abs(y - x) <= x * 0.02 && Math.abs(z - x) <= x * 0.02 },
      { name: 'sphere volume', pass: ratio > 0.9 && ratio < 1.01 },
    ]
  },
}
