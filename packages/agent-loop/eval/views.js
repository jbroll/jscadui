// The four views the describer reads. A top view came back in round 3: the three
// side-on views barely show an opening or slot cut into the top of a functional object
// (a toothbrush holder's paste slot, a cable clip's clamp).
export const VIEWS = [
  { name: 'iso-front', label: 'front three-quarter view', dir: [1, -1, 0.7], up: [0, 0, 1] },
  { name: 'iso-back', label: 'back three-quarter view', dir: [-1, 1, 0.7], up: [0, 0, 1] },
  { name: 'side', label: 'side view', dir: [0.25, -1, 0.35], up: [0, 0, 1] },
  { name: 'top', label: 'top view', dir: [0.15, -0.35, 1], up: [0, 1, 0] },
]

export const VIEW_LABELS = Object.fromEntries(VIEWS.map((v) => [v.name, v.label]))
