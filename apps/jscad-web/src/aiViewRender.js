// The `view` tool's off-screen renderer: it frames a model's bounding box from
// the preset directions and returns a PNG data URL plus the camera used, per
// shot. It never touches the live viewer canvas, so the user's own camera and
// what they see are undisturbed.
//
// Framing ports the eval renderer (`eval/render/page.html:79-111`): the eight
// bounding-box corners are projected into the camera's view space and the
// largest half-extent any corner needs — horizontal or vertical — is kept,
// times the eval's 6% margin (`half = max-span / 2 * 1.06`). The eval frames
// that extent with an orthographic camera; the app viewer and its THREE bundle
// carry only a perspective camera, so the extent becomes the field of view
// instead, measured per corner so a near face is covered too. The fit is
// aspect-correct: a non-square frame opens its wider axis rather than
// stretching or cropping the model.
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
import { CommonToThree } from '@jscadui/format-threejs'
import { DEFAULT_VIEW_SIZE, VIEW_PRESETS } from '@jscadui/agent-loop/src/viewSpec.js'

// Half the analysed extent times 1.06, as the eval framed its views: a 3%
// margin on each side, so a silhouette never sits on the frame edge.
const MARGIN = 1.06

// The eval's `side` view is raised off the pure elevation (0.25, -1, 0.35) so a
// bare silhouette is not read as a flat slab. The front/back/left/right presets
// extend that convention: each is a cardinal view with the same slight tilt and
// +Z up, and `top`/`bottom` reuse the eval's near-vertical tilt with +Y up.
const PRESET_VECTORS = {
  front: { dir: [0.25, -1, 0.35], up: [0, 0, 1] },
  back: { dir: [-0.25, 1, 0.35], up: [0, 0, 1] },
  right: { dir: [1, 0.25, 0.35], up: [0, 0, 1] },
  left: { dir: [-1, -0.25, 0.35], up: [0, 0, 1] },
  top: { dir: [0.15, -0.35, 1], up: [0, 1, 0] },
  bottom: { dir: [0.15, -0.35, -1], up: [0, 1, 0] },
  'iso-front': { dir: [1, -1, 0.7], up: [0, 0, 1] },
  'iso-back': { dir: [-1, 1, 0.7], up: [0, 0, 1] },
}

/**
 * The direction and up vectors for every preset, keyed by the names
 * `VIEW_PRESETS` defines (Task 1) so the two cannot drift.
 * @type {Record<string, {dir: [number, number, number], up: [number, number, number]}>}
 */
export const PRESET_DIRS = Object.fromEntries(VIEW_PRESETS.map((preset) => [preset, PRESET_VECTORS[preset]]))

// Named errors, as the request spec and part resolver do, so a caller can match
// on the name and the message reads `Name: detail`.
const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

// Three finite numbers, taken from a `[x, y, z]` array or a `{x, y, z}` vector
// (what @jscadui/format-common's boundingBox returns).
const triple = (value, label) => {
  const t = Array.isArray(value) ? value : value && typeof value === 'object' ? [value.x, value.y, value.z] : undefined
  if (!t || t.length !== 3 || !t.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw named('ArgumentsError', `${label} must be three finite numbers [x, y, z]`)
  }
  return [t[0], t[1], t[2]]
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const unit = (a, label) => {
  const length = Math.hypot(a[0], a[1], a[2])
  if (!(length > 0)) throw named('ArgumentsError', `${label} must not be the zero vector`)
  return scale(a, 1 / length)
}

const midpoint = (min, max) => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]

// The eight corners of an axis-aligned box — the points the eval projects to
// measure the model's extent in the camera's plane.
const boxCorners = (min, max) => {
  const out = []
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z])
  return out
}

// Frames an axis-aligned box seen from `target` along `dir`, with `up` as the
// camera's up. Shared by the exported preset framing and the shot loop, which
// may aim at a resolved point rather than the box centre.
const frameFrom = (min, max, dir, up, size, target) => {
  const { w, h } = size
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw named('ArgumentsError', 'size must be an object {w, h} of positive pixels')
  }
  const aspect = w / h
  const distance = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 3
  const position = add(target, scale(dir, distance))
  // The camera basis the eval builds via `lookAt`: +z back toward the camera,
  // +x right (up crossed into z), +y up. `up` is squared off `dir` first, as
  // three.js does, so a tilted `up` (top/bottom) stays correct.
  const z = dir
  const upHat = unit(sub(up, scale(z, dot(up, z))), 'up')
  const right = unit(cross(upHat, z), 'up')
  const top = cross(z, right)
  // The largest half-angle the box needs, over every corner and both axes,
  // already scaled by the inverse aspect so a wide frame opens horizontally.
  const tan = boxCorners(min, max).reduce((acc, corner) => {
    const v = sub(corner, position)
    const depth = -dot(v, z)
    if (!(depth > 0)) return acc
    return Math.max(acc, Math.abs(dot(v, top)) / depth, Math.abs(dot(v, right)) / depth / aspect)
  }, 0)
  const fov = (2 * Math.atan(tan * MARGIN) * 180) / Math.PI
  return { position, target, fov, aspect, up: upHat }
}

/**
 * The camera that auto-fits a bounding box from a direction, with the eval's
 * 6% margin. The box's centre is the look-at target.
 * @param {{min: unknown, max: unknown}} bbox the box to frame
 * @param {[number, number, number]} dir the camera direction (target to camera)
 * @param {[number, number, number]} up the camera up vector
 * @param {{w: number, h: number}} size the frame size in pixels
 * @returns {{position: number[], target: number[], fov: number, aspect: number, up: number[]}}
 */
export const frameCamera = (bbox, dir, up, size) => {
  const min = triple(bbox?.min, 'bbox.min')
  const max = triple(bbox?.max, 'bbox.max')
  return frameFrom(min, max, unit(triple(dir, 'dir'), 'dir'), triple(up, 'up'), size, midpoint(min, max))
}

// The camera the eval and the app viewer share: +Z up, these depth planes
// (render-threejs uses 1..50000 with its fixed 45 degree fov).
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
export const renderViews = async (mesh, { shots, size = { ...DEFAULT_VIEW_SIZE } } = {}, { THREE = globalThis.THREE, smooth = false, bg = [1, 1, 1] } = {}) => {
  if (!Array.isArray(mesh) || mesh.length === 0) throw named('ViewRenderError', 'no geometry to render')
  if (!Array.isArray(shots) || shots.length === 0) throw named('ViewRenderError', 'renderViews needs at least one shot')
  if (!THREE) throw named('ViewRenderError', 'renderViews needs three.js on globalThis.THREE')
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(size.w, size.h)
  try {
    const { scene, camera: view } = buildScene(THREE, mesh, smooth, bg)
    const model = boundingBox(mesh)
    const modelMin = triple(model.min, 'model.min')
    const modelMax = triple(model.max, 'model.max')
    const results = []
    for (const shot of shots) {
      const min = shot.bbox ? triple(shot.bbox.min, 'shot.bbox.min') : modelMin
      const max = shot.bbox ? triple(shot.bbox.max, 'shot.bbox.max') : modelMax
      const target = shot.target ? triple(shot.target, 'shot.target') : midpoint(min, max)
      const camera = frameFrom(min, max, unit(triple(shot.dir, 'shot.dir'), 'shot.dir'), triple(shot.up, 'shot.up'), size, target)
      const distance = Math.hypot(...sub(camera.position, camera.target))
      view.fov = camera.fov
      view.aspect = camera.aspect
      view.near = distance / 100 || NEAR
      view.far = distance * 100 || FAR
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
