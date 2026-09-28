// Rounded edges must cost volume against the sharp 6000 mm³ box.
export const fixture = {
  name: 'rounded-box',
  prompt: 'A 30 by 20 by 10 box with rounded edges',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [10, 20, 30] },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '10 x 20 x 30', pass: Math.abs(a - 10) < 0.5 && Math.abs(b - 20) < 0.5 && Math.abs(c - 30) < 0.5 },
      { name: 'edges rounded', pass: volume > 4800 && volume < 5990 },
    ]
  },
}
