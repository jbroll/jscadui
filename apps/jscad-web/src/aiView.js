// The `view` tool's app-side pipeline: validate the request, turn its aims
// into the renderer's shot plan, render off-screen and hand the agent loop raw
// shots. Everything that touches the app — the live mesh and the renderer — is
// injected, so this module never imports the app and the unit suite drives it
// without WebGL or a worker.
//
// The live viewer is deliberately absent: the handler neither reads nor writes
// the user's camera, so a view call can never move what they are looking at.
//
// A bad view fails the whole call: the plan is built for every shot before the
// renderer runs, so one bad aim means no renders at all.
//
// A part-name aim is refused, never guessed. `proxyState.types` is keyed by
// param path in the order the model set `_type` while building, while
// `measure({parts})` numbers the items `main()` returns; on a real multi-part
// model the two orders match neither in length nor in content (the hierarchical
// car: 11 typed paths against 13 geometry items, and `body` lands on a rear
// wheel hub — test/aiViewProvenance.test.js is that evidence). Nothing in a
// build reports which geometry item belongs to which part, so no honest mapping
// exists today and the aim fails with the coordinate route that does work.
// A build that named its own geometry would let a part-name aim resolve here.

import { boundingBox } from '@jscadui/format-common'
import { normalizeViewRequest } from '@jscadui/agent-loop/src/viewSpec.js'
import { resolveLookAt } from './aiViewParts.js'
import { PRESET_DIRS } from './aiViewRender.js'

// Named errors, as the request spec and part resolver do, so a caller can match
// on the name and the message reads `Name: detail`.
const named = (name, detail) => Object.assign(new Error(`${name}: ${detail}`), { name })

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s]

const unit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2])
  return length > 0 ? scale(a, 1 / length) : [0, 0, 1]
}

// The centre of the whole model, as the position aim measures its direction
// from. @jscadui/format-common returns `{min: {x, y, z}, max: {x, y, z}}`.
const modelCenter = (mesh) => {
  const box = boundingBox(mesh)
  return [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2]
}

// The part-name aim's refusal: the name asked for, why no mapping exists, and
// the route that gets the same shot, so the agent corrects the call in one step.
const unsupportedPart = (part) =>
  named(
    'PartLookAtUnsupportedError',
    `cannot aim at part ${JSON.stringify(part)} by name: a build does not report which geometry item belongs to which part, ` +
      `so a name cannot be resolved to a measured center. Use a preset, or measure the parts and aim with lookAt: [x, y, z] coordinates.`,
  )

// The no-geometry result is the last build's own wording when it has one (so
// the agent hears why the model is empty), else a plain statement of fact.
const noGeometryError = async (noGeometry) => {
  try {
    const result = await noGeometry?.()
    const message = result?.error?.message
    if (typeof message === 'string' && message !== '') return named(result.error.name ?? 'NoGeometryError', message)
  } catch {
    // A failing probe falls back to the plain wording; it must not mask the
    // real error the caller needs to see.
  }
  return named('NoGeometryError', 'no geometry to render; write the model first')
}

/**
 * Builds the `view` tool handler for the app.
 *
 * The returned handler takes the tool's raw arguments and resolves to
 * `{ok: true, shots}`, each shot `{image: {dataUrl, mime}, camera}` in the loop's
 * shape; it rejects with a named Error on a bad call, an empty model or a
 * part-name aim (which the app cannot resolve — see the module comment).
 * @param {{
 *   getMesh: () => Array<object> | undefined,
 *   noGeometry: () => Promise<object | null>,
 *   render: (mesh: Array<object>, plan: object, env?: object) => Promise<Array<{pngDataUrl: string, camera: object}>>,
 *   env?: () => object,
 * }} deps
 * @returns {(input: unknown) => Promise<{ok: true, shots: Array<object>}>}
 */
export const createViewHandler = ({ getMesh, noGeometry, render, env }) => async (input) => {
  const { views, size } = normalizeViewRequest(input)

  const mesh = getMesh()
  if (!Array.isArray(mesh) || mesh.length === 0) throw await noGeometryError(noGeometry)

  // Every shot is planned before the renderer runs: an unusable aim throws here
  // and nothing is rendered.
  const shots = []
  for (const view of views) {
    if (view.kind === 'preset') {
      const dirs = PRESET_DIRS[view.preset]
      shots.push({ dir: dirs.dir, up: dirs.up })
    } else if (view.kind === 'lookAtPart') {
      throw unsupportedPart(view.part)
    } else if (view.kind === 'lookAt') {
      // A point aim shoots the default iso-front direction; the renderer
      // auto-fits the whole model around the target it is given.
      const iso = PRESET_DIRS['iso-front']
      shots.push({ dir: iso.dir, up: iso.up, target: await resolveLookAt(view) })
    } else {
      // A position aim looks from the requested point (plus its offset) back at
      // the model centre; the renderer owns the distance, so the model auto-fits.
      const target = modelCenter(mesh)
      shots.push({ dir: unit(sub(add(view.position, view.offset), target)), up: [0, 0, 1], target })
    }
  }

  const results = await render(mesh, { shots, size }, env ? env() : undefined)
  return {
    ok: true,
    shots: results.map((result) => ({ image: { dataUrl: result.pngDataUrl, mime: 'image/png' }, camera: result.camera })),
  }
}
