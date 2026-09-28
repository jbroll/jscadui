# JSCAD renderer using Babylon.js

`RenderBabylon(BABYLON)` takes the Babylon.js module and returns a viewer
factory. The module does not import Babylon.js itself, so it works wherever
Babylon.js is already loaded, for example from a pre-packaged bundle.

```js
import * as BABYLON from 'babylonjs'
import { RenderBabylon } from '@jscadui/render-babylonjs'

const JscadBabylonViewer = RenderBabylon(BABYLON)
const viewer = JscadBabylonViewer(containerEl, { camera: { position: [180, -180, 220] } })
viewer.setScene(scene)
```

The returned viewer exposes `sendCmd`, `resize`, `destroy`, `getCamera`,
`setCamera`, `setBg`, `setMeshColor`, `setScene` and `getViewerEnv`.
