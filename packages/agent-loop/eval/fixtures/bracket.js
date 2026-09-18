// L-bracket fitting a 200x200 bed: constraint satisfaction, not just shape.
export const fixture = {
  name: 'bracket',
  prompt: 'Model an L-bracket, 60mm wide with 40mm tall arms 8mm thick, in jscad-fluent. Check it against the mk3 bed, then persist with writeModel.',
  requires: ['eval', 'check', 'writeModel'],
  verifyBeforeWrite: true,
  maxTurns: 10,
  checks: (m) => [
    { name: 'fits mk3 bed', pass: Array.isArray(m?.dimensions) && m.dimensions.every((d, i) => d <= [250, 210, 200][i]) },
  ],
}
