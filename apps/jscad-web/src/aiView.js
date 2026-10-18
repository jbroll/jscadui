// The `view` tool's app-side pipeline: validate the request, turn its aims
// into the renderer's shot plan, render off-screen and hand the agent loop raw
// shots. Everything that touches the app — the live mesh, the typed part names,
// the worker measurement and the renderer — is injected, so this module never
// imports the app and the unit suite drives it without WebGL or a worker.
//
// The live viewer is deliberately absent: the handler neither reads nor writes
// the user's camera, so a view call can never move what they are looking at.
//
// A bad view fails the whole call: the plan is built for every shot before the
// renderer runs, so one unresolvable look-at means no renders at all.

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

/**
 * The typed part paths `proxyState.types` carries, numbered in the order the
 * model created them, as `resolveLookAt` receives them.
 *
 * `main()` returns a bare geometry array with no names, and the proxy records
 * one typed entry per part in creation order, so the Nth typed path names the
 * Nth array item — the same index `measure` and `check` number.
 * @param {{types?: object} | undefined} proxyState the params controller's proxy state
 * @returns {Array<{path: string, index: number}>}
 */
export const partPathsOf = (proxyState) =>
  Object.keys(proxyState?.types ?? {}).map((path, index) => ({ path, index }))

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
 * shape; it rejects with a named Error on a bad call, an empty model or a part
 * that cannot be resolved.
 * @param {{
 *   getMesh: () => Array<object> | undefined,
 *   getPartPaths: () => Array<{path: string, index: number}>,
 *   measure: (options: {parts: string}) => Promise<{parts?: Array<object>}>,
 *   noGeometry: () => Promise<object | null>,
 *   render: (mesh: Array<object>, plan: object, env?: object) => Promise<Array<{pngDataUrl: string, camera: object}>>,
 *   env?: () => object,
 * }} deps
 * @returns {(input: unknown) => Promise<{ok: true, shots: Array<object>}>}
 */
export const createViewHandler = ({ getMesh, getPartPaths, measure, noGeometry, render, env }) => async (input) => {
  const { views, size } = normalizeViewRequest(input)

  const mesh = getMesh()
  if (!Array.isArray(mesh) || mesh.length === 0) throw await noGeometryError(noGeometry)

  const partPaths = getPartPaths()

  // The worker runs only when a view actually names a part, so a preset-only
  // call never pays for a measurement it does not use.
  let parts = []
  if (views.some((view) => view.kind === 'lookAtPart')) {
    const measured = await measure({ parts: 'all' })
    parts = Array.isArray(measured?.parts) ? measured.parts : []
  }
  const partAt = (index) => parts.find((part) => Number(part?.part) === index) ?? parts[index]
  // `resolveLookAt` calls this exactly once per part name; remembering which
  // index it resolved lets the same part's bounding box frame the shot.
  let measuredIndex = -1
  const measurePart = (index) => {
    measuredIndex = index
    const center = partAt(index)?.center
    if (!Array.isArray(center)) throw named('PartNotFoundError', `part ${index} has no measured centre`)
    return [center[0], center[1], center[2]]
  }

  // Every shot is planned before the renderer runs: an unresolvable aim throws
  // here and nothing is rendered.
  const shots = []
  for (const view of views) {
    if (view.kind === 'preset') {
      const dirs = PRESET_DIRS[view.preset]
      shots.push({ dir: dirs.dir, up: dirs.up })
    } else if (view.kind === 'lookAt' || view.kind === 'lookAtPart') {
      const iso = PRESET_DIRS['iso-front']
      const target = await resolveLookAt(view, { partPaths, measurePart })
      const shot = { dir: iso.dir, up: iso.up, target }
      if (view.kind === 'lookAtPart') {
        const box = partAt(measuredIndex)?.boundingBox
        if (Array.isArray(box?.[0]) && Array.isArray(box?.[1])) shot.bbox = { min: box[0], max: box[1] }
      }
      shots.push(shot)
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
