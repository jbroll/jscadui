// The `view` tool's camera framing, shared by the app's renderer
// (apps/jscad-web/src/aiViewRender.js) and the eval's (eval/render.js), so both
// aim and fit a shot the same way. Pure math: no three.js, no DOM.
//
// The eight bounding-box corners are measured in the camera's view space and
// the widest half-angle any corner needs, horizontal or vertical, sets a
// perspective field of view, times a 1.06 margin. A non-square frame opens its
// wider axis rather than stretching or cropping the model.

const MARGIN = 1.06

// The fallback depth planes for a box with no size, as the app viewer uses.
const NEAR = 1
const FAR = 50000

const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

// Three finite numbers, from a `[x, y, z]` array or a `{x, y, z}` vector
// (what @jscadui/format-common's boundingBox returns).
export const triple = (value, label) => {
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

const boxCorners = (min, max) => {
  const out = []
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z])
  return out
}

const frameFrom = (min, max, dir, up, size, target) => {
  const { w, h } = size ?? {}
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw named('ArgumentsError', 'size must be an object {w, h} of positive pixels')
  }
  const aspect = w / h
  const distance = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 3
  const position = add(target, scale(dir, distance))
  // The basis three.js's lookAt builds: +z back toward the camera, +x right,
  // +y up, with `up` squared off `dir` first so a tilted up stays correct.
  const z = dir
  const upHat = unit(sub(up, scale(z, dot(up, z))), 'up')
  const right = unit(cross(upHat, z), 'up')
  const top = cross(z, right)
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
 * The camera that auto-fits a bounding box from a direction. The box's centre
 * is the look-at target.
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

/**
 * The camera for one planned shot: its own `bbox` or else the model's is
 * framed, aimed at its `target` or else that box's centre.
 * @param {{dir: number[], up: number[], target?: number[], bbox?: {min: unknown, max: unknown}}} shot
 * @param {{min: unknown, max: unknown}} model the whole model's box
 * @param {{w: number, h: number}} size the frame size in pixels
 * @returns {{position: number[], target: number[], fov: number, aspect: number, up: number[]}}
 */
export const frameShot = (shot, model, size) => {
  const min = triple(shot.bbox ? shot.bbox.min : model?.min, shot.bbox ? 'shot.bbox.min' : 'model.min')
  const max = triple(shot.bbox ? shot.bbox.max : model?.max, shot.bbox ? 'shot.bbox.max' : 'model.max')
  const target = shot.target ? triple(shot.target, 'shot.target') : midpoint(min, max)
  return frameFrom(min, max, unit(triple(shot.dir, 'shot.dir'), 'shot.dir'), triple(shot.up, 'shot.up'), size, target)
}

/**
 * Depth planes a hundredfold either side of the camera's distance to its target.
 * @param {{position: number[], target: number[]}} camera
 * @returns {{near: number, far: number}}
 */
export const clipPlanes = ({ position, target }) => {
  const distance = Math.hypot(...sub(position, target))
  return { near: distance / 100 || NEAR, far: distance * 100 || FAR }
}
