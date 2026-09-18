// 20mm cube with a centered through-hole: boolean correctness plus net volume.
export const fixture = {
  name: 'cube-hole',
  prompt: 'Model a 20mm cube centered on the origin with a 5mm-radius through-hole along Z, in jscad-fluent. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 8,
  checks: (m) => [
    { name: 'volume near 6115', pass: (m?.volume ?? 0) > 5800 && (m?.volume ?? 0) < 6500 },
    { name: '20mm extents', pass: Array.isArray(m?.boundingBox) && m.boundingBox[0].every((v) => Math.abs(v + 10) < 0.01) && m.boundingBox[1].every((v) => Math.abs(v - 10) < 0.01) },
  ],
}
