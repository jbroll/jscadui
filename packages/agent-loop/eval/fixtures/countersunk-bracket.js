// L bracket, two 4mm holes in the base countersunk to 8mm at the top face.
export const fixture = {
  name: 'countersunk-bracket',
  prompt: 'An L bracket 50mm wide, arms 40mm, 5mm thick, with two 4mm holes in the base countersunk to 8mm at the top face.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [40, 40, 50], volume: 18541 },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      { name: '50 x 40 x 40 bracket', pass: Math.abs(a - 40) < 0.5 && Math.abs(b - 40) < 0.5 && Math.abs(c - 50) < 0.5 },
      // 5mm-thick L bracket with two countersunk 4mm holes, at 32-64 segments: 18540-18541 mm3;
      // 8mm-thick walls (same bounding box) push it to ~28800.
      { name: 'volume near 18540', pass: volume > 18170 && volume < 18910 },
    ]
  },
}
