// 12-tooth gear, 40mm outer diameter, 5mm thick.
export const fixture = {
  name: 'gear',
  prompt: 'Model a 12-tooth spur gear, 40mm outer diameter and 5mm thick centered on the origin, in jscad-fluent. Verify with measure, then persist with writeModel.',
  requires: ['eval', 'measure', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m) => [
    { name: '40mm outer diameter', pass: (m?.boundingBox?.[1]?.[0] ?? 0) - (m?.boundingBox?.[0]?.[0] ?? 0) > 38 && (m?.boundingBox?.[1]?.[0] ?? 0) - (m?.boundingBox?.[0]?.[0] ?? 0) < 42 },
    { name: '5mm thick', pass: (m?.boundingBox?.[1]?.[2] ?? 0) - (m?.boundingBox?.[0]?.[2] ?? 0) > 4.5 && (m?.boundingBox?.[1]?.[2] ?? 0) - (m?.boundingBox?.[0]?.[2] ?? 0) < 5.5 },
    { name: 'positive volume', pass: (m?.volume ?? 0) > 1000 },
  ],
}
