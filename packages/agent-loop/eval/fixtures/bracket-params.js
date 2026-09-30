// Three parameters the user named, each one that reshapes the model when changed.
const ASKED = [/wid/i, /heig|tall/i, /hole|screw|bolt|bore|diam/i]

const numeric = (p) => typeof p.initial === 'number' && p.type !== 'group'
const text = (p) => `${p.name} ${p.label ?? ''}`

export const fixture = {
  name: 'bracket-params',
  group: 'harder',
  prompt: 'a shelf bracket where I can adjust the width, height and screw hole size',
  requires: ['write'],
  verifyBeforeWrite: false,
  maxTurns: 8,
  probe: { paramVariants: true },
  checks: (m, { params = [], solid, probe } = {}) => {
    const dims = m?.dimensions ?? [0, 0, 0]
    const volume = m?.volume ?? 0
    const variants = probe?.paramVariants ?? []
    const named = ASKED.map((pattern) => params.filter((p) => numeric(p) && pattern.test(text(p))))
    const reshapes = ASKED.map((pattern) => variants.some((v) => v.changed && pattern.test(text(v))))
    return [
      { name: 'three or more parameters', pass: params.filter(numeric).length >= 3 },
      { name: 'width, height and hole size parameters', pass: named.every((list) => list.length > 0) },
      { name: 'each one changes the model', pass: reshapes.every(Boolean) },
      { name: 'bracket-shaped, not a block', pass: volume > 0 && volume < dims[0] * dims[1] * dims[2] * 0.6 && dims.every((d) => d >= 3 && d <= 400) },
      { name: 'watertight', pass: solid?.watertight === true },
    ]
  },
}
