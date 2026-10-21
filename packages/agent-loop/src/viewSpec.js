// The `view` tool's request spec: the camera aims and image size a call asks
// for, validated and normalized for the renderer. Pure module, no app or
// provider imports, so the loop, the app handler and the eval share one
// contract. A violation throws a named ArgumentsError for the caller to turn
// into a tool error; nothing here renders or reads geometry.

// The presets a camera spec may name. Directions and up vectors live with the
// renderer, which owns the framing math.
export const VIEW_PRESETS = ['front', 'back', 'left', 'right', 'side', 'top', 'bottom', 'iso-front', 'iso-back']

// A call carries 1-4 camera specs; more would cost more tokens than they return.
export const MAX_VIEWS = 4

// The image size, and the longest side the agent may ask for. Token cost is
// roughly width x height / 750 per image and images are resent every later
// round, so a larger frame is an error rather than a quiet downscale.
export const DEFAULT_VIEW_SIZE = { w: 640, h: 480 }
export const MAX_VIEW_SIZE = 768

// The aim keys a spec may carry: a direction (preset or position), a point (lookAt), or one of each.
const AIM_FORMS = ['preset', 'lookAt', 'position']

// The part references measure and check report, which a lookAt also takes.
const PART_FORMS = 'to aim at a part, give its index (57), an index range ("51-54") or its part name (front.left)'

const named = (name, message) => Object.assign(new Error(message), { name })

// The default call: one iso-front auto-fit of the whole model, never the live
// user pose. A fresh spec each call, so a caller cannot corrupt the next.
const defaultView = () => ({ kind: 'preset', preset: 'iso-front' })

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Three finite numbers, copied so the result never aliases the caller's array.
const triple = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw named('ArgumentsError', `${label} must be three finite numbers [x, y, z]`)
  }
  return [value[0], value[1], value[2]]
}

const lookAtSpec = (value, at) => {
  if (Number.isInteger(value) && value >= 0) return { kind: 'lookAtPart', part: String(value) }
  if (typeof value === 'string') {
    const part = value.trim()
    if (part === '') throw named('ArgumentsError', `${at} lookAt part is empty; ${PART_FORMS}`)
    return { kind: 'lookAtPart', part }
  }
  if (!Array.isArray(value)) throw named('ArgumentsError', `${at} lookAt must be three finite numbers [x, y, z]; ${PART_FORMS}`)
  return { kind: 'lookAt', point: triple(value, `${at} lookAt`) }
}

// preset and position each set the camera direction; lookAt sets the point
// aimed at, alone (from iso-front) or beside either of them.
const normalizeSpec = (input, index) => {
  const at = `views[${index}]`
  if (!isPlainObject(input)) throw named('ArgumentsError', `${at} must be a camera spec object`)
  const forms = AIM_FORMS.filter((key) => input[key] !== undefined)
  if (forms.length === 0) throw named('ArgumentsError', `${at} needs one of preset, lookAt or position`)
  if (input.preset !== undefined && input.position !== undefined) {
    throw named('ArgumentsError', `${at} names both preset and position, two camera directions; use one, and lookAt for the point it aims at`)
  }
  const target = input.lookAt === undefined ? undefined : lookAtSpec(input.lookAt, at)
  const aimed = target ? { target } : {}
  if (input.preset !== undefined) {
    if (!VIEW_PRESETS.includes(input.preset)) {
      throw named('ArgumentsError', `${at} preset ${JSON.stringify(input.preset)} is unknown; use one of ${VIEW_PRESETS.join(', ')}`)
    }
    return { kind: 'preset', preset: input.preset, ...aimed }
  }
  if (input.position !== undefined) {
    const position = triple(input.position, `${at} position`)
    const offset = input.offset === undefined ? [0, 0, 0] : triple(input.offset, `${at} offset`)
    return { kind: 'position', position, offset, ...aimed }
  }
  return target
}

const normalizeViews = (views) => {
  if (!Array.isArray(views)) throw named('ArgumentsError', 'views must be an array of 1 to 4 camera specs')
  if (views.length > MAX_VIEWS) throw named('ArgumentsError', `view got ${views.length} camera specs; at most ${MAX_VIEWS} are allowed per call`)
  if (views.length === 0) return [defaultView()]
  return views.map(normalizeSpec)
}

const side = (value, name) => {
  if (!Number.isInteger(value) || value < 1) throw named('ArgumentsError', `size.${name} must be a positive whole number of pixels`)
  return value
}

const normalizeSize = (size) => {
  if (size === undefined) return { ...DEFAULT_VIEW_SIZE }
  if (!isPlainObject(size)) throw named('ArgumentsError', 'size must be an object {w, h} in pixels')
  const w = side(size.w, 'w')
  const h = side(size.h, 'h')
  if (Math.max(w, h) > MAX_VIEW_SIZE) {
    throw named('ArgumentsError', `view size ${w}x${h} is too large; the longest side must be at most ${MAX_VIEW_SIZE}`)
  }
  return { w, h }
}

/**
 * A camera spec as the renderer receives it.
 * @typedef {{kind: 'preset', preset: string}
 *   | {kind: 'lookAt', point: [number, number, number]}
 *   | {kind: 'lookAtPart', part: string} // an index, an index range or a part name
 *   | {kind: 'position', position: [number, number, number], offset: [number, number, number]}} ViewSpec
 * A preset or position spec may also carry `target`, a lookAt or lookAtPart spec it aims at.
 */

/**
 * Validates and normalizes a `view` call's arguments.
 *
 * Accepts the default call (undefined or `{}`), one bare camera spec
 * (`{preset: 'top'}`), or the full shape `{views: [spec...], size: {w, h}}`.
 * An omitted or empty `views` means one iso-front auto-fit; a spec names a
 * direction (a preset, or a position with an optional world offset), a lookAt
 * point or part reference, or a direction and a lookAt it aims at.
 * @param {unknown} input the tool arguments as received
 * @returns {{views: Array<ViewSpec>, size: {w: number, h: number}}}
 * @throws {Error} a named `ArgumentsError` on any violation
 */
export const normalizeViewRequest = (input) => {
  if (input === undefined || input === null) return { views: [defaultView()], size: { ...DEFAULT_VIEW_SIZE } }
  if (!isPlainObject(input)) throw named('ArgumentsError', 'view request must be an object {views, size}')
  const size = normalizeSize(input.size)
  // Three accepted shapes: the call shape `{views, size}`, a bare spec
  // (`{preset: 'top'}`), or the default call. `views` omitted means the
  // default one iso-front, never a live pose; a mix of both shapes is
  // ambiguous and an error rather than a silent pick.
  const hasAim = AIM_FORMS.some((key) => input[key] !== undefined)
  if (input.views !== undefined) {
    if (hasAim) throw named('ArgumentsError', 'view request names both views and a top-level aim; put each camera spec inside views')
    return { views: normalizeViews(input.views), size }
  }
  if (hasAim) return { views: [normalizeSpec(input, 0)], size }
  return { views: [defaultView()], size }
}

const CAMERA_SPEC_SCHEMA = {
  type: 'object',
  description:
    'One camera: a direction (preset, or position with an optional offset) and/or the point it aims at (lookAt). lookAt alone looks from iso-front; a direction alone aims at the whole model. Not both preset and position.',
  properties: {
    preset: { type: 'string', enum: [...VIEW_PRESETS], description: 'A named view direction, auto-fit to the whole model' },
    lookAt: {
      anyOf: [
        { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        { type: 'integer' },
        { type: 'string' },
      ],
      description:
        'The [x, y, z] point to aim at, or a part as measure and check report it: an index (57 or "57") or index range ("51-54") into the array main() returns, aimed at its bounding-box center, or a part name such as front.left, aimed at its anchor origin',
    },
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'The [x, y, z] camera position' },
    offset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'A [x, y, z] world offset added to the position for this render' },
  },
  additionalProperties: false,
}

/**
 * The `view` tool's inputSchema, derived from the constants this module
 * validates with, so the offered schema and the runtime rules cannot drift.
 */
export const viewInputSchema = {
  type: 'object',
  properties: {
    views: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_VIEWS,
      items: CAMERA_SPEC_SCHEMA,
      description: 'One to four camera specs, one image each; omitted or empty means one iso-front of the whole model',
    },
    size: {
      type: 'object',
      properties: {
        w: { type: 'integer', description: `Image width in pixels, at most ${MAX_VIEW_SIZE}` },
        h: { type: 'integer', description: `Image height in pixels, at most ${MAX_VIEW_SIZE}` },
      },
      additionalProperties: false,
      description: `Image size; defaults to ${DEFAULT_VIEW_SIZE.w}x${DEFAULT_VIEW_SIZE.h}, longest side at most ${MAX_VIEW_SIZE}`,
    },
  },
  additionalProperties: false,
}
