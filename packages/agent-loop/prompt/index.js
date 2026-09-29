import prose from '../prompt.md?raw'
import fluentProse from './fluent.md?raw'
import modelingProse from './modeling.md?raw'
import fluentSheet from './sheet-fluent.md?raw'
import modelingSheet from './sheet-modeling.md?raw'
import fluentSphereUnion from './examples/fluent/01-sphere-union.js?raw'
import fluentHollowCube from './examples/fluent/02-hollow-cube.js?raw'
import fluentCubeHole from './examples/fluent/03-cube-hole.js?raw'
import fluentRoundedTray from './examples/fluent/04-rounded-tray.js?raw'
import fluentHexNut from './examples/fluent/05-hex-nut.js?raw'
import fluentMountingPlate from './examples/fluent/06-mounting-plate.js?raw'
import modelingSphereUnion from './examples/modeling/01-sphere-union.js?raw'
import modelingHollowCube from './examples/modeling/02-hollow-cube.js?raw'
import modelingCubeHole from './examples/modeling/03-cube-hole.js?raw'
import modelingRoundedTray from './examples/modeling/04-rounded-tray.js?raw'
import modelingHexNut from './examples/modeling/05-hex-nut.js?raw'
import modelingMountingPlate from './examples/modeling/06-mounting-plate.js?raw'

export const PROSE = prose

export const API_PROSE = { fluent: fluentProse, modeling: modelingProse }

export const SHEETS = { fluent: fluentSheet, modeling: modelingSheet }

export const EXAMPLES = {
  fluent: [
    { file: '01-sphere-union.js', source: fluentSphereUnion },
    { file: '02-hollow-cube.js', source: fluentHollowCube },
    { file: '03-cube-hole.js', source: fluentCubeHole },
    { file: '04-rounded-tray.js', source: fluentRoundedTray },
    { file: '05-hex-nut.js', source: fluentHexNut },
    { file: '06-mounting-plate.js', source: fluentMountingPlate },
  ],
  modeling: [
    { file: '01-sphere-union.js', source: modelingSphereUnion },
    { file: '02-hollow-cube.js', source: modelingHollowCube },
    { file: '03-cube-hole.js', source: modelingCubeHole },
    { file: '04-rounded-tray.js', source: modelingRoundedTray },
    { file: '05-hex-nut.js', source: modelingHexNut },
    { file: '06-mounting-plate.js', source: modelingMountingPlate },
  ],
}
