import prose from '../prompt.md?raw'
import sphereUnion from './examples/01-sphere-union.js?raw'
import hollowCube from './examples/02-hollow-cube.js?raw'
import fluentCubeHole from './examples/03-fluent-cube-hole.js?raw'

export const PROSE = prose

export const EXAMPLES = [
  { file: '01-sphere-union.js', source: sphereUnion },
  { file: '02-hollow-cube.js', source: hollowCube },
  { file: '03-fluent-cube-hole.js', source: fluentCubeHole },
]
