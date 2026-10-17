/**
 * Grid utilities for [ALL] view layouts.
 *
 * Provides gridModule, which every generated ALL.js calls to build its grid,
 * plus the placement helpers it and its callers use directly.
 */

const jscad = require('@jscad/modeling')
const { translate, scale, transform } = jscad.transforms
const { measureAggregateBoundingBox } = jscad.measurements
const { colorize } = jscad.colors
const { mat4 } = jscad.maths

const IDENTITY = mat4.create()

/**
 * Calculate grid positions for N items.
 *
 * Items are arranged in a square-ish grid, row-major order, centred on [0,0].
 *
 * @param {number} index    - Item index (0-based)
 * @param {number} total    - Total number of items
 * @param {number} spacing  - Distance between item centres (model units)
 * @returns {[number, number]} [x, y] position for this item
 */
function gridPosition(index, total, spacing = 60) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)

  // Offsets to centre the grid on the origin
  const xOff = ((cols - 1) * spacing) / 2
  const yOff = ((rows - 1) * spacing) / 2

  const col = index % cols
  const row = Math.floor(index / cols)

  return [col * spacing - xOff, row * spacing - yOff]
}

/**
 * Width and depth a grid of `total` items covers: its cell centres plus one
 * cell. It depends only on the item count, so a parent can size a sub-grid
 * before any of the sub-grid's leaves run.
 *
 * @returns {[number, number]}
 */
function gridExtent(total, spacing, cellSize) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  return [(cols - 1) * spacing + cellSize, (rows - 1) * spacing + cellSize]
}

// gridPosition centres a grid on the origin, so scaling about it keeps the sub-grid centred
function subGridContext(ctx, x, y, cellSize, extent) {
  const s = cellSize / Math.max(...extent)
  const local = mat4.multiply(mat4.create(), mat4.fromTranslation(mat4.create(), [x, y, 0]), mat4.fromScaling(mat4.create(), [s, s, s]))
  return mat4.multiply(mat4.create(), ctx, local)
}

function toWorld(geoms, ctx) {
  if (ctx === IDENTITY) return geoms
  return geoms.map(g => {
    if (isV1Geom(g)) return v1ToWorld(g, ctx)
    const placed = transform(ctx, g)
    disposeIntermediate(g, null)
    return placed
  })
}

// V1 .jscad geometry (classic CSG/CAG from the app's CSG-compat shim) is not a
// modeling geom: modeling's measure reports a zero box for it and modeling's
// transforms leave it untouched, so without this a V1 cell silently vanished
// from the grid. A V1 solid carries its own ruler (getBounds) and mutators
// (translate/scale), which the placement below uses instead.
const isV1Geom = (g) =>
  !!g && typeof g.getBounds === 'function' && typeof g.translate === 'function' &&
  !g.isManifoldGeom3 && !Array.isArray(g.transforms)

// V1 bounds as [[x0, y0, z0], [x1, y1, z1]]; 2D (CAG) bounds gain a flat z.
function v1BBox(g) {
  const [a, b] = g.getBounds()
  const az = a.z ?? 0
  const bz = b.z ?? 0
  return [[a.x, a.y, az], [b.x, b.y, bz]]
}

// Grid contexts are always uniform-scale-plus-translation products (see
// subGridContext), which V1 applies without a matrix import: p' = s*p + t.
function v1ToWorld(g, ctx) {
  return g.scale(ctx[0]).translate([ctx[12], ctx[13], ctx[14] ?? 0])
}

/**
 * Centre a group of geometries at the origin, scale uniformly to cellSize,
 * then translate to the grid position (gx, gy).
 *
 * @param {Array} geoms   - Array of JSCAD geometries
 * @param {number} gx     - Grid X position
 * @param {number} gy     - Grid Y position
 * @param {number} cellSize - Maximum size for the longest axis
 * @returns {Array} Normalized and positioned geometries
 */
function normalizeAndPlace(geoms, gx, gy, cellSize) {
  if (geoms.length === 0) return []

  // Modeling's aggregate measure cannot see V1 CSG (it reports a zero box),
  // so measure each family with its own ruler and combine the boxes.
  const boxes = []
  const modeling = []
  for (const g of geoms) {
    if (isV1Geom(g)) {
      try {
        boxes.push(v1BBox(g))
      } catch { /* unmeasurable: contributes nothing, as before */ }
    } else {
      modeling.push(g)
    }
  }

  if (modeling.length) {
    // Get bounding box - handle both single bbox and array of bboxes
    const rawBbox = measureAggregateBoundingBox(...modeling)

    // Check if we got an array of bboxes (multiple geometries) or a single bbox
    if (Array.isArray(rawBbox[0]) && Array.isArray(rawBbox[0][0])) {
      // Multiple bboxes returned - compute aggregate manually
      for (const bb of rawBbox) boxes.push(bb)
    } else {
      // Single bbox - use directly
      boxes.push(rawBbox)
    }
  }

  let x0 = Infinity, y0 = Infinity, z0 = Infinity
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity

  for (const [[minX, minY, minZ], [maxX, maxY, maxZ]] of boxes) {
    x0 = Math.min(x0, minX)
    y0 = Math.min(y0, minY)
    z0 = Math.min(z0, minZ)
    x1 = Math.max(x1, maxX)
    y1 = Math.max(y1, maxY)
    z1 = Math.max(z1, maxZ)
  }

  const width = x1 - x0
  const height = y1 - y0
  const depth = z1 - z0
  const maxSize = Math.max(width, height, depth)

  if (maxSize === 0 || !isFinite(maxSize)) {
    return []
  }

  const s = cellSize / maxSize

  // Centroid of the bounding box
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const cz = (z0 + z1) / 2

  // For each geometry: centre → scale → place
  return geoms.map(g => {
    if (isV1Geom(g)) {
      return g.translate([-cx, -cy, -cz]).scale(s).translate([gx, gy, 0])
    }
    const centred = translate([-cx, -cy, -cz], g)
    const scaled = scale([s, s, s], centred)
    const placed = translate([gx, gy, 0], scaled)
    // A manifold transform result owns its own handle, so the steps can go now
    // rather than wait for the finalizer; g stays, as a model may reuse it.
    disposeIntermediate(centred, g)
    disposeIntermediate(scaled, g)
    return placed
  })
}

function disposeIntermediate(geom, keep) {
  for (const x of [geom].flat(Infinity)) {
    if (x !== keep && x?.isManifoldGeom3 && typeof x.dispose === 'function') x.dispose()
  }
}

/**
 * Derive a valid JS identifier from a file URL.
 *
 * Examples:
 *   .../01-menger.example.js      → menger
 *   .../09-hull-chain.example.js  → hull_chain
 *   .../14-AMFImport/index.js     → AMFImport
 *
 * @param {string} url
 * @returns {string}
 */
function urlToPartName(url) {
  const parts = url.replace(/\/$/, '').split('/')
  let name = parts[parts.length - 1]

  // For index files, use the parent directory name instead
  if (name === 'index.js' || name === 'index.scad') {
    name = parts[parts.length - 2] || name
  }

  // Remove NN- numeric prefix
  name = name.replace(/^\d+-/, '')
  // Remove .example.js / .example.scad / .js / .scad suffixes
  name = name.replace(/\.example\.(js|scad)$/, '').replace(/\.(js|scad)$/, '')
  // Replace hyphens and dots with underscores → valid JS identifier
  return name.replace(/[-.]/g, '_')
}

const SKULL_COLORS = { white: [0.95, 0.95, 0.92, 1], black: [0.1, 0.1, 0.1, 1] }

// skull.svg as a relief with longest side 1, one plain geom3 per colour
function skullLayers() {
  const mesh = require('./skull-mesh.js')
  const vertex = (i) => mesh.vertices.slice(i * 3, i * 3 + 3)
  // Named, not iterated: @jscadui/require adds a `default` key to exports
  return Object.entries(SKULL_COLORS).map(([name, color]) => {
    const indices = mesh[name]
    const polygons = []
    for (let i = 0; i < indices.length; i += 3) {
      polygons.push({ vertices: [vertex(indices[i]), vertex(indices[i + 1]), vertex(indices[i + 2])] })
    }
    return { polygons, transforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color }
  })
}

/**
 * A skull-and-crossbones to stand in for a model that failed to load.
 *
 * @returns {Array} the off-white plate and the black linework, coloured
 */
function failureMarker() {
  return skullLayers().map(g => colorize(g.color, g))
}

/**
 * The failure marker as plain geometry, for a cell that fails once the wasm
 * has trapped: building it needs no wasm.
 *
 * @returns {Array} two plain geom3s placed at (gx, gy) with longest side cellSize, then by ctx
 */
function prebuiltSkull(gx, gy, cellSize, ctx = IDENTITY) {
  const s = cellSize
  const cell = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, gx, gy, 0, 1]
  const placement = ctx === IDENTITY ? cell : mat4.multiply(mat4.create(), ctx, cell)
  return skullLayers().map(g => ({ ...g, transforms: [...placement] }))
}

// Once the wasm has trapped, a built marker would need it too
function markerFor(x, y, cellSize, ctx) {
  if (!globalThis.__allWasmTrap) {
    try {
      return toWorld(normalizeAndPlace(failureMarker(), x, y, cellSize), ctx)
    } catch { /* fall back to the stored skull */ }
  }
  return [prebuiltSkull(x, y, cellSize, ctx)]
}

const isWasmTrap = (err) =>
  (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError) || err?.name === 'RuntimeError'

// A generated grid: ALL.js, or a category grid such as ALL.printed.js
const isGridUrl = (url) => /(^|\/)ALL(\.[^/]+)?\.js$/.test(url)

// A macrotask yield that still fires in a background tab. setTimeout yields
// stop firing there (timer throttling stretches one yield per cell into one
// per minute), stalling long grids with idle workers. A posted message is
// still delivered: same yield semantics, no timer.
function yieldToEventLoop() {
  if (typeof MessageChannel === 'function') {
    const { port1, port2 } = new MessageChannel()
    return new Promise((resolve) => {
      port1.onmessage = () => { port1.close(); port2.close(); resolve() }
      port2.postMessage(null)
    })
  }
  return new Promise((r) => setTimeout(r, 0))
}

function uniqueName(name, seen) {
  seen[name] = (seen[name] ?? 0) + 1
  return seen[name] === 1 ? name : `${name}_${seen[name]}`
}

// Round-robin across sibling lists, so consecutive tasks land in different
// sub-grids instead of walking one category to completion. Applied
// recursively, the whole tree builds breadth-first: a run of heavy models
// in one library no longer parks every worker at once.
function interleave(lists) {
  const out = []
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i])
  }
  return out
}

/**
 * An ALL.js grid. Each item runs under its own params namespace in one cell.
 * An item that is itself a grid runs its own leaves, scaled into its parent's
 * cell, so each leaf streams on its own. When the stream hook can claim, a
 * leaf runs only on the worker that wins its key, the leaf's index path.
 *
 * @param {string[]} items - item urls, relative to the grid file
 * @param {{spacing: number, cellSize: number}} options
 * @param {(url: string) => any} req - the grid file's own require, so items resolve against its directory
 */
function gridModule(items, { spacing, cellSize }, req) {
  const extent = gridExtent(items.length, spacing, cellSize)

  // Structural walk: every task's key, params name path and placement, plus
  // a loader holding this grid's own require. Names and positions match the
  // historical depth-first walk; only execution order changes. Appends to
  // `out` in depth-first order and returns this subtree breadth-first.
  const collect = (ctx, path, namePath, out) => {
    const nameSeen = {}
    const groups = items.map((url, i) => {
      const [x, y] = gridPosition(i, items.length, spacing)
      const name = uniqueName(urlToPartName(url), nameSeen)
      const key = [...path, i]
      if (isGridUrl(url)) {
        let mod
        try {
          mod = req(url)
        } catch (err) {
          const task = { kind: 'failed-grid', key, url, x, y, ctx, err }
          out.push(task)
          return [task]
        }
        if (mod && typeof mod.collect === 'function') {
          const subExtent = mod.extent ?? [cellSize, cellSize]
          return mod.collect(subGridContext(ctx, x, y, cellSize, subExtent), key, [...namePath, name], out)
        }
        const task = { kind: 'legacy-grid', key, url, mod, x, y, ctx, namePath: [...namePath, name] }
        out.push(task)
        return [task]
      }
      const task = { kind: 'leaf', key, url, x, y, ctx, namePath: [...namePath, name], load: () => req(url) }
      out.push(task)
      return [task]
    })
    return interleave(groups)
  }

  /**
   * @param {object} [params]
   * @param {{ctx?: number[], path?: number[], stream?: object | null}} [where]
   * @returns {Promise<Array>} the leaves in world coordinates, or nothing when streaming
   */
  const runGrid = async (params = {}, { ctx = IDENTITY, path = [], stream = null } = {}) => {
    const ordered = []
    const tasks = collect(ctx, path, [], ordered)
    ordered.forEach((task, dfs) => { task.dfs = dfs })
    const results = new Map()
    const failed = []
    const generation = globalThis.__jscadScriptGeneration
    const claiming = typeof stream?.claim === 'function'

    const scoped = (namePath) => {
      let p = params
      for (const n of namePath) p = p?.[n]
      return p
    }

    const send = async (geoms, dfs) => {
      if (!stream) {
        results.set(dfs, geoms)
        return
      }
      try {
        // The worker evaluates lazy tree nodes during emit, so the run must
        // wait for it: disposing first would free the handles it reads.
        await stream.emit(geoms)
      } finally {
        for (const g of geoms) if (typeof g?.dispose === 'function') g.dispose()
      }
    }

    // One bad model marks its own cell; the rest of the grid still renders
    const fail = async (task, err) => {
      const { url, x, y, ctx: taskCtx } = task
      if (isWasmTrap(err)) globalThis.__allWasmTrap ??= url
      console.error(`ALL: FAILED ${url}: ${err.message}`)
      failed.push(url)
      try {
        await send(markerFor(x, y, cellSize, taskCtx), task.dfs)
      } catch (markerErr) {
        if (isWasmTrap(markerErr)) globalThis.__allWasmTrap ??= url
        await send([prebuiltSkull(x, y, cellSize, taskCtx)], task.dfs)
      }
    }

    for (const task of tasks) {
      // A trapped worker stops claiming and leaves its unclaimed leaves to the others
      if (claiming && globalThis.__allWasmTrap) break
      const { key, url } = task

      if (task.kind === 'failed-grid') {
        // Every worker walks the sub-grid, so only the one that claims it draws the marker
        if (!claiming || await stream.claim(key.join('/'), url)) await fail(task, task.err)
        continue
      }

      if (task.kind === 'legacy-grid') {
        const subExtent = task.mod?.extent ?? [cellSize, cellSize]
        const geoms = await task.mod.runGrid(scoped(task.namePath), { ctx: subGridContext(task.ctx, task.x, task.y, cellSize, subExtent), path: key, stream })
        if (!stream) results.set(task.dfs, geoms)
        continue
      }

      if (claiming && !(await stream.claim(key.join('/'), url))) continue
      try {
        // A trapped wasm instance stays broken, so no later cell's result can be trusted
        if (globalThis.__allWasmTrap) throw new Error(`not run: wasm trapped in ${globalThis.__allWasmTrap}`)
        const mod = task.load()
        const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
        if (typeof fn === 'function') {
          const geoms = [].concat(await fn(scoped(task.namePath))).flat().filter(g => !g?.previewOnly)
          // emit evaluates the cell's CSG, so its failures belong to this cell too
          await send(toWorld(normalizeAndPlace(geoms, task.x, task.y, cellSize), task.ctx), task.dfs)
        }
      } catch (err) {
        await fail(task, err)
      }

      if (!stream) globalThis.__jscadProgress?.()
      // Manifold handles are freed by a FinalizationRegistry, which only runs once main yields
      await yieldToEventLoop()
      // Yielding lets a newer script start in this worker; stop rather than run beside it
      if (globalThis.__jscadScriptGeneration !== generation) throw new Error(`grid superseded by a newer script after ${url}`)
    }

    if (failed.length) {
      console.error(`ALL: ${failed.length}/${items.length} models failed: ${failed.join(' ')}`)
    }
    return [...results.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, geoms]) => geoms)
  }

  // Leaf code sees neither streaming nor claiming; the grid hands the hook down itself
  const main = async (params) => {
    const stream = globalThis.__jscadStream
    globalThis.__jscadStream = null
    try {
      return await runGrid(params, { stream })
    } finally {
      globalThis.__jscadStream = stream
    }
  }

  return { main, runGrid, extent, collect }
}

module.exports = {
  gridPosition,
  gridExtent,
  gridModule,
  normalizeAndPlace,
  urlToPartName,
  failureMarker,
  prebuiltSkull
}
