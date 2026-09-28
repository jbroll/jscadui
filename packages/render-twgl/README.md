# JSCAD renderer for an external regl renderer

Thin adapter around a regl renderer prepared elsewhere, such as
`@jscad/regl-renderer`. Unlike `@jscadui/render-regl`, this package does not
bundle its own shaders or `regl` dependency: it takes an already-built
renderer object and only adds the JSCAD viewer wiring (camera, orbit
controls, scene conversion).

```js
import { RenderRegl } from '@jscadui/render-twgl'
import reglRenderer from '@jscad/regl-renderer'

const JscadReglViewer = RenderRegl(reglRenderer)
const viewer = JscadReglViewer(containerEl, { camera: { position: [180, -180, 220] } })
viewer.setScene(scene)
```

`reglRenderer` must provide `prepareRender`, `drawCommands`, `cameras` and
`controls`, the shape `@jscad/regl-renderer` exports.

The returned viewer exposes `sendCmd`, `resize`, `destroy`, `getCamera`,
`setCamera`, `setBg`, `setMeshColor` and `setScene`.
