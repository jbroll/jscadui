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

// The aim keys a spec may carry; exactly one of them names the camera.
const AIM_FORMS = ['preset', 'lookAt', 'position']

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

const normalizeSpec = (input, index) => {
  const at = `views[${index}]`
  if (!isPlainObject(input)) throw named('ArgumentsError', `${at} must be a camera spec object`)
  const forms = AIM_FORMS.filter((key) => input[key] !== undefined)
  if (forms.length === 0) throw named('ArgumentsError', `${at} needs one of preset, lookAt or position`)
  if (forms.length > 1) throw named('ArgumentsError', `${at} names more than one aim (${forms.join(', ')}); use exactly one aim`)
  if (forms[0] === 'preset') {
    if (!VIEW_PRESETS.includes(input.preset)) {
      throw named('ArgumentsError', `${at} preset ${JSON.stringify(input.preset)} is unknown; use one of ${VIEW_PRESETS.join(', ')}`)
    }
    return { kind: 'preset', preset: input.preset }
  }
  if (forms[0] === 'lookAt') {
    if (typeof input.lookAt === 'string') {
      const part = input.lookAt.trim()
      if (part === '') throw named('ArgumentsError', `${at} lookAt part name is empty; name a part such as front.left`)
      return { kind: 'lookAtPart', part }
    }
    return { kind: 'lookAt', point: triple(input.lookAt, `${at} lookAt`) }
  }
  const position = triple(input.position, `${at} position`)
  const offset = input.offset === undefined ? [0, 0, 0] : triple(input.offset, `${at} offset`)
  return { kind: 'position', position, offset }
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
 *   | {kind: 'lookAtPart', part: string}
 *   | {kind: 'position', position: [number, number, number], offset: [number, number, number]}} ViewSpec
 */

/**
 * Validates and normalizes a `view` call's arguments.
 *
 * Accepts the default call (undefined or `{}`), one bare camera spec
 * (`{preset: 'top'}`), or the full shape `{views: [spec...], size: {w, h}}`.
 * An omitted or empty `views` means one iso-front auto-fit; a spec names
 * exactly one aim, as a preset, a lookAt point or part name, or a position
 * with an optional world offset.
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
  description: 'One camera aim: a preset, a lookAt point or part name, or a position with an offset. Name exactly one of preset, lookAt or position.',
  properties: {
    preset: { type: 'string', enum: [...VIEW_PRESETS], description: 'A named view direction, auto-fit to the whole model' },
    lookAt: {
      anyOf: [
        { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        { type: 'string' },
      ],
      description: "The [x, y, z] point to aim at, or a part name such as front.left, resolved to that part's center",
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
