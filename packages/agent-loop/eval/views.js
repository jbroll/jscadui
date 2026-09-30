// The three views the describer reads. No top view: in the trial Moondream
// read the caboose's top view as "an electronic module" and it flipped the judge.
export const VIEWS = [
  { name: 'iso-front', label: 'front three-quarter view', dir: [1, -1, 0.7], up: [0, 0, 1] },
  { name: 'iso-back', label: 'back three-quarter view', dir: [-1, 1, 0.7], up: [0, 0, 1] },
  { name: 'side', label: 'side view', dir: [0, -1, 0.05], up: [0, 0, 1] },
]

export const VIEW_LABELS = Object.fromEntries(VIEWS.map((v) => [v.name, v.label]))
