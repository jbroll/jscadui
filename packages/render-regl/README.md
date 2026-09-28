# JSCAD renderer using regl

Self-contained WebGL renderer built on [regl](https://github.com/regl-project/regl),
with its own shaders, camera and orbit controls. `regl` itself is loaded
dynamically, so it only needs to be present as a peer dependency.

```js
import { RenderRegl } from '@jscadui/render-regl'

const JscadReglViewer = RenderRegl()
const viewer = JscadReglViewer(containerEl, { camera: { position: [180, -180, 220] } })
viewer.setScene(scene)
```

`RenderRegl` also accepts an options object shaped like
`@jscad/regl-renderer` (`{ prepareRender, drawCommands, cameras, controls }`)
to reuse an externally prepared renderer instead of the built-in one.

The returned viewer exposes `sendCmd`, `resize`, `destroy`, `getCamera`,
`setCamera`, `setBg`, `setMeshColor`, `setScene` and `getViewerEnv`. The
module also re-exports its internal camera, controls, scene-helper
(`makeGrid`, `makeAxes`) and bounds utilities for direct use.
