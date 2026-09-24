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
    const placed = transform(ctx, g)
    disposeIntermediate(g, null)
    return placed
  })
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

  // Get bounding box - handle both single bbox and array of bboxes
  const rawBbox = measureAggregateBoundingBox(...geoms)

  let x0, y0, z0, x1, y1, z1

  // Check if we got an array of bboxes (multiple geometries) or a single bbox
  if (Array.isArray(rawBbox[0]) && Array.isArray(rawBbox[0][0])) {
    // Multiple bboxes returned - compute aggregate manually
    x0 = Infinity; y0 = Infinity; z0 = Infinity
    x1 = -Infinity; y1 = -Infinity; z1 = -Infinity

    for (const [[minX, minY, minZ], [maxX, maxY, maxZ]] of rawBbox) {
      x0 = Math.min(x0, minX)
      y0 = Math.min(y0, minY)
      z0 = Math.min(z0, minZ)
      x1 = Math.max(x1, maxX)
      y1 = Math.max(y1, maxY)
      z1 = Math.max(z1, maxZ)
    }
  } else {
    // Single bbox - use directly
    [[x0, y0, z0], [x1, y1, z1]] = rawBbox
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

function uniqueName(name, seen) {
  seen[name] = (seen[name] ?? 0) + 1
  return seen[name] === 1 ? name : `${name}_${seen[name]}`
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

  /**
   * @param {object} [params]
   * @param {{ctx?: number[], path?: number[], stream?: object | null}} [where]
   * @returns {Promise<Array>} the leaves in world coordinates, or nothing when streaming
   */
  const runGrid = async (params = {}, { ctx = IDENTITY, path = [], stream = null } = {}) => {
    const all = []
    const nameSeen = {}
    const failed = []
    const generation = globalThis.__jscadScriptGeneration
    const claiming = typeof stream?.claim === 'function'

    const send = (geoms) => {
      if (!stream) {
        all.push(...geoms)
        return
      }
      try {
        stream.emit(geoms)
      } finally {
        for (const g of geoms) if (typeof g?.dispose === 'function') g.dispose()
      }
    }

    // One bad model marks its own cell; the rest of the grid still renders
    const fail = (url, x, y, err) => {
      if (isWasmTrap(err)) globalThis.__allWasmTrap ??= url
      console.error(`ALL: FAILED ${url}: ${err.message}`)
      failed.push(url)
      try {
        send(markerFor(x, y, cellSize, ctx))
      } catch (markerErr) {
        if (isWasmTrap(markerErr)) globalThis.__allWasmTrap ??= url
        send([prebuiltSkull(x, y, cellSize, ctx)])
      }
    }

    for (const [i, url] of items.entries()) {
      // A trapped worker stops claiming and leaves its unclaimed leaves to the others
      if (claiming && globalThis.__allWasmTrap) break
      const [x, y] = gridPosition(i, items.length, spacing)
      const name = uniqueName(urlToPartName(url), nameSeen)
      const key = [...path, i]

      let mod
      if (isGridUrl(url)) {
        try {
          mod = req(url)
        } catch (err) {
          fail(url, x, y, err)
          continue
        }
        if (typeof mod?.runGrid === 'function') {
          all.push(...await mod.runGrid(params[name], { ctx: subGridContext(ctx, x, y, cellSize, mod.extent), path: key, stream }))
          continue
        }
      }

      if (claiming && !(await stream.claim(key.join('/'), url))) continue
      try {
        // A trapped wasm instance stays broken, so no later cell's result can be trusted
        if (globalThis.__allWasmTrap) throw new Error(`not run: wasm trapped in ${globalThis.__allWasmTrap}`)
        mod ??= req(url)
        const fn = (mod && mod.main) || (typeof mod === 'function' ? mod : null)
        if (typeof fn === 'function') {
          const geoms = [].concat(await fn(params[name])).flat()
          // emit evaluates the cell's CSG, so its failures belong to this cell too
          send(toWorld(normalizeAndPlace(geoms, x, y, cellSize), ctx))
        }
      } catch (err) {
        fail(url, x, y, err)
      }

      if (!stream) globalThis.__jscadProgress?.()
      // Manifold handles are freed by a FinalizationRegistry, which only runs once main yields
      await new Promise(r => setTimeout(r, 0))
      // Yielding lets a newer script start in this worker; stop rather than run beside it
      if (globalThis.__jscadScriptGeneration !== generation) throw new Error(`grid superseded by a newer script after ${url}`)
    }

    if (failed.length) {
      console.error(`ALL: ${failed.length}/${items.length} models failed: ${failed.join(' ')}`)
    }
    return all
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

  return { main, runGrid, extent }
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
