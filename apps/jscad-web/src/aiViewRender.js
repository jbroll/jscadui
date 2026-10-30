// The `view` tool's off-screen renderer: it frames a model's bounding box from
// the preset directions and returns a PNG data URL plus the camera used, per
// shot. It never touches the live viewer canvas, so the user's own camera and
// what they see are undisturbed.
//
// Framing is shared with the eval's renderer (`@jscadui/agent-loop/src/viewFrame.js`).
//
// The scene is built with the app's own mesh converter, `CommonToThree`
// (`@jscadui/format-threejs`) — the very one the app viewer
// (`@jscadui/render-threejs`) uses — and the renderer, lights and materials
// mirror how `src/engine.js` builds that viewer, so an agent view draws the
// same geometry, colours and transforms the user sees. The viewer itself owns
// a private perspective camera with no way to repoint it (its `camera` field
// is shadowed by a constructor parameter), so the pass is rendered here rather
// than through the viewer.

import { boundingBox } from '@jscadui/format-common'
import * as ThreeNS from 'three'
import { CommonToThree } from '@jscadui/format-threejs'
import { DEFAULT_VIEW_SIZE } from '@jscadui/agent-loop/src/viewSpec.js'
import { clipPlanes, frameShot } from '@jscadui/agent-loop/src/viewFrame.js'

// The three.js namespace a render uses: an explicitly injected one wins (unit
// tests), then the viewer's ambient global, then this module's own bundled
// copy — so a view renders under either render engine, with no dependency on
// which bundles the page happened to load as globals.
export const resolveThree = (envTHREE) => envTHREE ?? globalThis.THREE ?? ThreeNS

// Named errors, as the request spec and part resolver do, so a caller can match
// on the name and the message reads `Name: detail`.
const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

// render-threejs's depth planes; each shot replaces them.
const NEAR = 1
const FAR = 50000

// Builds the mesh objects the app viewer would build for a model, using the
// app's converter so colours, transforms and instancing all match.
const buildScene = (THREE, mesh, smooth, bg) => {
  const convert = CommonToThree(THREE)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(...bg)
  scene.add(new THREE.AmbientLight(0xeeeeee, 0.5))
  // render-threejs hangs the key light off the camera, so it follows the view.
  const key = new THREE.DirectionalLight(0xeeeef4, 0.7)
  key.position.set(50, 0, 100)
  const camera = new THREE.PerspectiveCamera(45, 1, NEAR, FAR)
  camera.up.set(0, 0, 1)
  camera.add(key)
  scene.add(camera)
  for (const entity of mesh) {
    const object = convert(entity, { smooth })
    if (object) scene.add(object)
  }
  return { scene, camera }
}

/**
 * Renders one PNG per shot, off-screen, and returns it with the camera used.
 *
 * Each shot names a `dir` and `up` (preset or explicit) and may name a
 * `target` to aim at and a `bbox` to auto-fit; without a `bbox` the whole
 * model's box is framed, and without a `target` the framed box's centre is.
 * @param {Array<object>} mesh the app's geometry entities, as setModel carries
 * @param {{shots: Array<{dir: number[], up: number[], target?: number[], bbox?: object}>, size?: {w: number, h: number}}} plan
 * @param {{THREE?: object, smooth?: boolean, bg?: number[]}} [env] injectable THREE (the app's global) for tests
 * @returns {Promise<Array<{pngDataUrl: string, camera: object}>>}
 */
export const renderViews = async (mesh, { shots, size = { ...DEFAULT_VIEW_SIZE } } = {}, { THREE: envTHREE, smooth = false, bg = [1, 1, 1] } = {}) => {
  if (!Array.isArray(mesh) || mesh.length === 0) throw named('ViewRenderError', 'no geometry to render')
  if (!Array.isArray(shots) || shots.length === 0) throw named('ViewRenderError', 'renderViews needs at least one shot')
  const THREE = resolveThree(envTHREE)
  if (!THREE) throw named('ViewRenderError', 'renderViews needs a three.js namespace: inject env.THREE, load the viewer bundle, or bundle three')
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size.w, size.h)
  try {
    const { scene, camera: view } = buildScene(THREE, mesh, smooth, bg)
    const model = boundingBox(mesh)
    const results = []
    for (const shot of shots) {
      const camera = frameShot(shot, model, size)
      const { near, far } = clipPlanes(camera)
      view.fov = camera.fov
      view.aspect = camera.aspect
      view.near = near
      view.far = far
      view.up.set(...camera.up)
      view.position.set(...camera.position)
      view.lookAt(...camera.target)
      view.updateProjectionMatrix()
      renderer.render(scene, view)
      results.push({ pngDataUrl: renderer.domElement.toDataURL('image/png'), camera })
    }
    return results
  } finally {
    renderer.dispose()
  }
}
