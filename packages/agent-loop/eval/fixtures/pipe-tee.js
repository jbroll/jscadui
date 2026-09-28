// Two colinear 20mm-OD, 2mm-wall arms plus a perpendicular branch, each 30mm from center.
export const fixture = {
  name: 'pipe-tee',
  prompt: 'A pipe tee: 20mm outer diameter, 2mm wall, each of the three arms 30mm long measured from the center.',
  requires: ['eval', 'writeModel'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  target: { dimensions: [20, 40, 60], volume: 8845 },
  checks: (m) => {
    const [a, b, c] = [...(m?.dimensions ?? [0, 0, 0])].sort((p, q) => p - q)
    const volume = m?.volume ?? 0
    return [
      // run: two arms end to end = 60mm; branch: 30mm from center plus the run's own 10mm radius = 40mm; OD = 20mm.
      { name: '20 x 40 x 60 bounding box', pass: Math.abs(a - 20) < 0.5 && Math.abs(b - 40) < 0.5 && Math.abs(c - 60) < 0.5 },
      // bores meeting at the center, 32-64 segments: 8825-8864 mm3. A tee whose run wall
      // blocks the branch is ~9750, and a solid tee ~25450.
      { name: 'open tee volume near 8845', pass: volume > 8650 && volume < 9050 },
    ]
  },
}
