import { between, fill, sortedDims, volume } from '../measures.js'
import { JEEP_SOURCE } from './jeepSource.js'

export const scenario = {
  name: 'jeep-inspect-fix',
  category: 'inspect-and-repair',
  prompt: 'use the view tool to find errors in the Jeep and fix them',
  persona: 'hobbyist who built a Jeep model last week and thinks parts of it look wrong',
  facts: [
    'the model is a WW2 Willys Jeep, roughly 370 mm long, and the overall size is fine',
    'the wheels and tires look odd to you, and the top bows over the cab do not look right',
    'wants the same Jeep fixed, not replaced with a new design',
    'display piece, not printed as one part',
  ],
  files: { 'main.js': JEEP_SOURCE },
  checks: (m) => {
    const [, , longest] = sortedDims(m)
    return [
      { name: 'still about the same size (300-440 mm long)', pass: between(longest, 300, 440) },
      { name: 'still an open vehicle, not a solid block', pass: volume(m) > 0 && fill(m) < 0.5 },
    ]
  },
}
