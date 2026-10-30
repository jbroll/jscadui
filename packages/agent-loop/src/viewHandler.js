// The `view` tool's pipeline, shared by the app and the eval: validate the
// request, turn its aims into the renderer's shot plan, render off-screen and
// hand the agent loop raw shots. The mesh, the renderer and the build's
// anchors are injected, so this module never imports the app or a browser.
//
// The app's live viewer is deliberately absent: the handler neither reads nor
// writes the user's camera, so a view call can never move what they are looking at.
//
// A bad view fails the whole call: the plan is built for every shot before the
// renderer runs, so one bad aim means no renders at all.
//
// A part aim takes the references measure and check report. An index or range
// aims at that selection's bounding-box center, measured by the injected
// `measure`; a name maps to its auto-attached anchor frame origin from
// `measure({anchors: true})`. A part the build lacks is a `PartNotFoundError`,
// never a guess. Anchors ride jscad-engine solids only, so on a manifold build
// every name misses; indexes and coords always work.

import { boundingBox } from '@jscadui/format-common'
import { isIndexSelector } from '@jscadui/model-tools/src/partRefs.js'
import { checkPartIndex, resolveLookAt } from './viewParts.js'
import { normalizeViewRequest, PRESET_DIRS } from './viewSpec.js'

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
 * The part-name -> [x, y, z] frame origins a `measure({anchors: true})` result
 * reports. A name several solids share keeps the first origin (a part's solids
 * share one name, and the first is the part's own primitive). Missing anchors
 * read as an empty map, so an unmeasured build simply resolves nothing.
 * @param {{anchors?: Array<{part: string, anchors: Object|null}>|null}} result a model-tools measure result
 * @returns {Map<string, [number, number, number]>}
 */
export const buildAnchorFrames = (result) => {
  const frames = new Map()
  for (const part of result?.anchors ?? []) {
    for (const [name, frame] of Object.entries(part?.anchors ?? {})) {
      if (!frames.has(name) && Array.isArray(frame?.origin)) frames.set(name, frame.origin)
    }
  }
  return frames
}

// What the part aims resolve against, measured only when a view names a part,
// so a preset or point call never pays for it. Index aims are checked against
// the part count first, so measure never answers its own out-of-range error.
const partContext = async (views, measure) => {
  const aims = views.map((view) => (view.kind === 'lookAtPart' ? view : view.target)).filter((aim) => aim?.kind === 'lookAtPart').map((aim) => aim.part)
  if (aims.length === 0 || !measure) return {}
  const measured = await measure({ anchors: true })
  const ctx = { anchorFrames: buildAnchorFrames(measured), partCount: measured?.anchors?.length ?? 0 }
  const selectors = [...new Set(aims.filter(isIndexSelector))]
  selectors.forEach((part) => checkPartIndex(part, ctx))
  if (selectors.length > 0) {
    const { parts } = await measure({ parts: selectors })
    ctx.partCenters = new Map(parts.map((part) => [part.part, part.center]))
  }
  return ctx
}

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
 * Builds the `view` tool handler.
 *
 * The returned handler takes the tool's raw arguments and resolves to
 * `{ok: true, shots}`, each shot `{image: {dataUrl, mime}, camera}` in the loop's
 * shape; it rejects with a named Error on a bad call, an empty model or a part
 * the build lacks (`PartNotFoundError`/`AmbiguousPartError`).
 * @param {{
 *   getMesh: () => Array<object> | undefined | Promise<Array<object> | undefined>,
 *   noGeometry: () => Promise<object | null>,
 *   render: (mesh: Array<object>, plan: object, env?: object) => Promise<Array<{pngDataUrl: string, camera: object}>>,
 *   measure?: (options: {anchors?: true, parts?: string[]}) => Promise<object>,
 *   env?: () => object,
 *   center?: (mesh: Array<object>) => [number, number, number],
 * }} deps `center` gives the model centre a position aim looks at; the
 *   default reads the app's mesh entities' `vertices`.
 * @returns {(input: unknown) => Promise<{ok: true, shots: Array<object>}>}
 */
export const createViewHandler = ({ getMesh, noGeometry, render, measure, env, center = modelCenter }) => async (input) => {
  const { views, size } = normalizeViewRequest(input)

  const mesh = await getMesh()
  if (!Array.isArray(mesh) || mesh.length === 0) throw await noGeometryError(noGeometry)

  const parts = await partContext(views, measure)

  // Every shot is planned before the renderer runs: an unusable aim throws here
  // and nothing is rendered.
  const shots = []
  for (const view of views) {
    if (view.kind === 'preset') {
      const dirs = PRESET_DIRS[view.preset]
      shots.push(view.target ? { dir: dirs.dir, up: dirs.up, target: resolveLookAt(view.target, parts) } : { dir: dirs.dir, up: dirs.up })
    } else if (view.kind === 'lookAtPart') {
      // A part aim shoots iso-front auto-fit to that part's center or frame origin.
      const iso = PRESET_DIRS['iso-front']
      shots.push({ dir: iso.dir, up: iso.up, target: resolveLookAt(view, parts) })
    } else if (view.kind === 'lookAt') {
      // A point aim shoots the default iso-front direction; the renderer
      // auto-fits the whole model around the target it is given.
      const iso = PRESET_DIRS['iso-front']
      shots.push({ dir: iso.dir, up: iso.up, target: resolveLookAt(view) })
    } else {
      // A position aim looks from the requested point (plus its offset) at its
      // lookAt, else the model centre; the renderer owns the distance, so the model auto-fits.
      const target = view.target ? resolveLookAt(view.target, parts) : center(mesh)
      shots.push({ dir: unit(sub(add(view.position, view.offset), target)), up: [0, 0, 1], target })
    }
  }

  const results = await render(mesh, { shots, size }, env ? env() : undefined)
  return {
    ok: true,
    shots: results.map((result) => ({ image: { dataUrl: result.pngDataUrl, mime: 'image/png' }, camera: result.camera })),
  }
}
