// Prod chat 037181f1 (2026-10-19): one 562 s round wrote a 240-line model in
// a single file, which then failed to build; the user saw nothing for minutes.
export const fixture = {
  name: 'jeep-scale-model',
  group: 'cadence',
  prompt: 'create a 10:1 scale model of a WW2 Williys Jeep.',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: {} },
  checks: (m, { solid, probe } = {}) => {
    const [length = 0, width = 0] = [...(m?.dimensions ?? [])].sort((a, b) => b - a)
    return [
      { name: 'a vehicle of several parts', pass: (probe?.bodies?.length ?? 0) >= 5 },
      // 10:1 reads either way (1:10 is about 340 mm long, 10:1 about 34 m).
      { name: 'jeep proportions at either reading of the scale', pass: length >= 150 && length <= 40000 && width >= length * 0.3 && width <= length * 0.7 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
