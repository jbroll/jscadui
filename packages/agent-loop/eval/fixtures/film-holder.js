// Prod chat 972a48f1 (2026-10-28): part files were written for 7.5 minutes
// while main.js still returned a placeholder cube, so nothing new showed.
export const fixture = {
  name: 'film-holder',
  group: 'cadence',
  prompt:
    'use websearch to investigate and design a compact 8mm film holder with film and take up reels + stepper motor drive and tension idler wheels.  target completely 3d printed parts - design and inspect individual parts for printability.',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { bodies: {} },
  checks: (m, { solid, probe } = {}) => {
    const largest = Math.max(0, ...(m?.dimensions ?? []))
    return [
      { name: 'several parts: reels, idlers, a frame', pass: (probe?.bodies?.length ?? 0) >= 4 },
      { name: 'compact: 60 to 400 mm across', pass: largest >= 60 && largest <= 400 },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
