#!/usr/bin/env node

/**
 * STL comparison tool using Manifold
 *
 * Computes Jaccard similarity between two STL files:
 *   Jaccard = Volume(A ∩ B) / Volume(A ∪ B)
 *
 * A Jaccard of 1.0 means identical geometry.
 * A Jaccard of 0.0 means no overlap.
 *
 * Usage:
 *   compare-stl reference.stl generated.stl
 *   compare-stl reference.stl generated.stl --threshold 0.99
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const VERSION = '0.1.0'

function printHelp() {
  console.log(`
compare-stl - Compare two STL files using Jaccard similarity

Usage:
  compare-stl <reference.stl> <generated.stl> [options]

Options:
  --threshold <n>         Minimum Jaccard for pass (default: 0.99)
  --verbose               Print detailed volume info
  -h, --help              Show this help
  -v, --version           Show version

Output:
  Prints Jaccard similarity (0.0 to 1.0).
  Exit code 0 if >= threshold, 1 otherwise.

Examples:
  compare-stl openscad.stl jscad.stl              Compare two files
  compare-stl openscad.stl jscad.stl --verbose    Show volume details
  compare-stl a.stl b.stl --threshold 0.95        Custom threshold
`)
}

function parseArgs(args) {
  const options = {
    reference: null,
    generated: null,
    threshold: 0.99,
    verbose: false,
    help: false,
    version: false,
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '-v' || arg === '--version') {
      options.version = true
    } else if (arg === '--verbose') {
      options.verbose = true
    } else if (arg === '--threshold') {
      i++
      options.threshold = parseFloat(args[i])
    } else if (!arg.startsWith('-')) {
      if (!options.reference) {
        options.reference = arg
      } else if (!options.generated) {
        options.generated = arg
      }
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }

  return options
}

/**
 * Parse ASCII STL file into vertices array
 * Returns array of triangles, each triangle is 9 numbers (3 vertices × 3 coords)
 */
function parseAsciiStl(content) {
  const triangles = []
  const lines = content.split('\n')

  let currentTriangle = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('vertex ')) {
      const parts = trimmed.split(/\s+/)
      currentTriangle.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3])
      )

      if (currentTriangle.length === 9) {
        triangles.push(currentTriangle)
        currentTriangle = []
      }
    }
  }

  return triangles
}

/**
 * Parse binary STL file into triangles array
 */
function parseBinaryStl(buffer) {
  const triangles = []

  // Binary STL needs at least 84 bytes (80 header + 4 count)
  if (buffer.length < 84) {
    throw new Error(`STL file too short for binary format: ${buffer.length} bytes`)
  }

  // Skip 80-byte header
  let offset = 80

  // Read triangle count (uint32)
  const numTriangles = buffer.readUInt32LE(offset)
  offset += 4

  for (let i = 0; i < numTriangles; i++) {
    // Skip normal (12 bytes)
    offset += 12

    // Read 3 vertices (9 floats = 36 bytes)
    const tri = []
    for (let j = 0; j < 9; j++) {
      tri.push(buffer.readFloatLE(offset))
      offset += 4
    }
    triangles.push(tri)

    // Skip attribute byte count (2 bytes)
    offset += 2
  }

  return triangles
}

/**
 * Parse STL file (auto-detect ASCII vs binary)
 */
function parseStl(filePath) {
  const buffer = readFileSync(filePath)

  // Check if ASCII (starts with "solid")
  const header = buffer.subarray(0, 5).toString('ascii')
  if (header === 'solid') {
    // Could be ASCII, but check if it's actually binary with "solid" in header
    const content = buffer.toString('utf8')
    // Detect ASCII by presence of "facet normal" OR "endsolid" (handles empty ASCII STL)
    if (content.includes('facet normal') || content.includes('endsolid')) {
      return parseAsciiStl(content)
    }
  }

  return parseBinaryStl(buffer)
}

/**
 * Build one Manifold mesh from a flat triangle array, with deduplication.
 * Auto-orients to positive volume.
 */
function buildManifold(triangles, Manifold, Module) {
  const vertices = []
  const indices = []
  const vertexMap = new Map()

  const getVertexIndex = (x, y, z) => {
    const key = `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`
    if (vertexMap.has(key)) return vertexMap.get(key)
    const index = vertices.length / 3
    vertices.push(x, y, z)
    vertexMap.set(key, index)
    return index
  }

  for (const tri of triangles) {
    indices.push(
      getVertexIndex(tri[0], tri[1], tri[2]),
      getVertexIndex(tri[3], tri[4], tri[5]),
      getVertexIndex(tri[6], tri[7], tri[8])
    )
  }

  const mesh = new Module.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(indices)
  })
  const manifold = Manifold.ofMesh(mesh)

  // Auto-orient: ensure positive volume (outward-facing normals).
  if (manifold.volume() < 0) {
    const flippedIndices = new Uint32Array(indices.length)
    for (let i = 0; i < indices.length; i += 3) {
      flippedIndices[i] = indices[i]
      flippedIndices[i + 1] = indices[i + 2]
      flippedIndices[i + 2] = indices[i + 1]
    }
    const flippedMesh = new Module.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(vertices),
      triVerts: flippedIndices
    })
    return Manifold.ofMesh(flippedMesh)
  }
  return manifold
}

/**
 * Split triangles into connected components using oriented edge matching.
 *
 * OpenSCAD exports one triangle set per color() group without CSG-unioning
 * across groups. Bodies that touch share edges with valence 4. Manifold cannot
 * correctly process these non-manifold meshes.
 *
 * Key insight: triangles from the SAME body traverse a shared edge in OPPOSITE
 * directions (a→b and b→a — consistent manifold winding). Triangles from
 * DIFFERENT bodies traverse the shared edge in the SAME direction (both a→b or
 * both b→a), because their outward normals oppose each other at the boundary.
 *
 * BFS only follows edges where the two triangles have opposite traversal order
 * (same-body, manifold-consistent). This keeps each body intact while naturally
 * separating bodies at their touching boundaries.
 */
function splitIntoComponents(triangles) {
  const n = triangles.length
  if (n === 0) return []

  const vertKey = (x, y, z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`

  // Build DIRECTED edge → triangle map.
  // Key: "a|b" (directed a→b). Value: triangle index.
  // Same-body neighbors: triangle with directed edge "a|b" connects to the
  // triangle with reverse edge "b|a". Different-body pairs both have "a|b".
  const dirEdgeToTri = new Map()

  for (let i = 0; i < n; i++) {
    const tri = triangles[i]
    const vk = [
      vertKey(tri[0], tri[1], tri[2]),
      vertKey(tri[3], tri[4], tri[5]),
      vertKey(tri[6], tri[7], tri[8]),
    ]
    for (const [a, b] of [[vk[0], vk[1]], [vk[1], vk[2]], [vk[2], vk[0]]]) {
      const k = `${a}|${b}`
      if (!dirEdgeToTri.has(k)) dirEdgeToTri.set(k, [])
      dirEdgeToTri.get(k).push(i)
    }
  }

  // Check if any oriented edge has >1 triangle (fast path for clean meshes)
  let hasDuplicates = false
  for (const tris of dirEdgeToTri.values()) {
    if (tris.length > 1) { hasDuplicates = true; break }
  }
  if (!hasDuplicates) return [triangles]

  // BFS — traverse to the triangle that has the REVERSE directed edge (b→a).
  // This is always the same-body manifold neighbor.
  // Triangles sharing same-directed edges (a→b + a→b) are different bodies.
  const component = new Int32Array(n).fill(-1)
  let numComponents = 0

  for (let start = 0; start < n; start++) {
    if (component[start] !== -1) continue
    const id = numComponents++
    const queue = [start]
    component[start] = id
    for (let qi = 0; qi < queue.length; qi++) {
      const ti = queue[qi]
      const tri = triangles[ti]
      const vk = [
        vertKey(tri[0], tri[1], tri[2]),
        vertKey(tri[3], tri[4], tri[5]),
        vertKey(tri[6], tri[7], tri[8]),
      ]
      for (const [a, b] of [[vk[0], vk[1]], [vk[1], vk[2]], [vk[2], vk[0]]]) {
        // The same-body neighbor has the reverse edge b→a
        const reverseKey = `${b}|${a}`
        const neighbors = dirEdgeToTri.get(reverseKey)
        if (!neighbors) continue
        for (const neighbor of neighbors) {
          if (component[neighbor] === -1) {
            component[neighbor] = id
            queue.push(neighbor)
          }
        }
      }
    }
  }

  if (numComponents === 1) return [triangles]

  const result = Array.from({ length: numComponents }, () => [])
  for (let i = 0; i < n; i++) result[component[i]].push(triangles[i])
  return result
}

/**
 * Convert triangles to Manifold mesh.
 * If the STL contains multiple bodies separated by non-manifold edges
 * (e.g. OpenSCAD color() groups concatenated without CSG union), splits them
 * into components and unions them to get the correct single solid.
 * Falls back to building a single Manifold if any component is invalid.
 */
async function trianglesToManifold(triangles, Manifold, Module) {
  const components = splitIntoComponents(triangles)

  if (components.length === 1) {
    return buildManifold(triangles, Manifold, Module)
  }

  // Try multi-body: build one Manifold per component, then union.
  // If any component is not a valid closed mesh, fall back to single Manifold.
  const manifolds = []
  let fallback = false
  for (const c of components) {
    try {
      const m = buildManifold(c, Manifold, Module)
      if (m.volume() === 0) { fallback = true; break }
      manifolds.push(m)
    } catch (_e) {
      fallback = true
      break
    }
  }

  if (fallback) {
    for (const m of manifolds) { try { m.delete() } catch (_e) { /* ignore */ } }
    return buildManifold(triangles, Manifold, Module)
  }

  const result = Manifold.union(manifolds)
  for (const m of manifolds) { try { m.delete() } catch (_e) { /* ignore */ } }
  return result
}

/**
 * Compute Jaccard similarity between two STL files in-process.
 * @param {string} refStlPath - Reference STL file path
 * @param {string} genStlPath - Generated STL file path
 * @param {object} manifoldModule - Already-initialized Manifold module (from getManifoldModule())
 * @returns {number} Jaccard similarity (0–1)
 */
export async function computeJaccard(refStlPath, genStlPath, manifoldModule) {
  const Manifold = manifoldModule.getManifold()
  const Module = manifoldModule.getModule()

  const refTriangles = parseStl(resolve(refStlPath))
  const genTriangles = parseStl(resolve(genStlPath))

  // Both empty = perfect match (e.g., all geometry was % ghost modifier)
  if (refTriangles.length === 0 && genTriangles.length === 0) return 1.0
  // One empty, one not = no overlap
  if (refTriangles.length === 0 || genTriangles.length === 0) return 0.0

  const refManifold = await trianglesToManifold(refTriangles, Manifold, Module)
  const genManifold = await trianglesToManifold(genTriangles, Manifold, Module)

  const intersection = Manifold.intersection([refManifold, genManifold])
  const union = Manifold.union([refManifold, genManifold])

  const unionVolume = union.volume()
  const jaccard = unionVolume > 0 ? intersection.volume() / unionVolume : 0

  // Free WASM memory to prevent heap exhaustion across many test runs
  try { refManifold.delete() } catch (_e) { /* ignore WASM delete errors */ }
  try { genManifold.delete() } catch (_e) { /* ignore WASM delete errors */ }
  try { intersection.delete() } catch (_e) { /* ignore WASM delete errors */ }
  try { union.delete() } catch (_e) { /* ignore WASM delete errors */ }

  return jaccard
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  if (options.version) {
    console.log(`compare-stl v${VERSION}`)
    process.exit(0)
  }

  if (!options.reference || !options.generated) {
    console.error('Two STL files required. Use -h for help.')
    process.exit(1)
  }

  try {
    // Initialize Manifold
    const manifoldPath = join(__dirname, '..', '..', 'manifold', 'src', 'index.js')
    const manifold = await import(manifoldPath)
    await manifold.init()

    const Manifold = manifold.getManifold()
    const Module = manifold.getModule()

    // Parse STL files
    const refPath = resolve(options.reference)
    const genPath = resolve(options.generated)

    if (options.verbose) {
      console.error(`Loading reference: ${refPath}`)
    }
    const refTriangles = parseStl(refPath)

    if (options.verbose) {
      console.error(`Loading generated: ${genPath}`)
      console.error(`Reference triangles: ${refTriangles.length}`)
    }
    const genTriangles = parseStl(genPath)

    if (options.verbose) {
      console.error(`Generated triangles: ${genTriangles.length}`)
    }

    // Convert to Manifold
    const refManifold = await trianglesToManifold(refTriangles, Manifold, Module)
    const genManifold = await trianglesToManifold(genTriangles, Manifold, Module)

    // Compute volumes
    const refVolume = refManifold.volume()
    const genVolume = genManifold.volume()

    if (options.verbose) {
      console.error(`Reference volume: ${refVolume}`)
      console.error(`Generated volume: ${genVolume}`)
    }

    // Compute intersection and union
    const intersection = Manifold.intersection([refManifold, genManifold])
    const union = Manifold.union([refManifold, genManifold])

    const intersectionVolume = intersection.volume()
    const unionVolume = union.volume()

    if (options.verbose) {
      console.error(`Intersection volume: ${intersectionVolume}`)
      console.error(`Union volume: ${unionVolume}`)
    }

    // Compute Jaccard similarity
    const jaccard = unionVolume > 0 ? intersectionVolume / unionVolume : 0

    console.log(`Jaccard: ${jaccard.toFixed(6)}`)

    // Exit with appropriate code
    if (jaccard >= options.threshold) {
      if (options.verbose) {
        console.error(`PASS (>= ${options.threshold})`)
      }
      process.exit(0)
    } else {
      if (options.verbose) {
        console.error(`FAIL (< ${options.threshold})`)
      }
      process.exit(1)
    }

  } catch (err) {
    console.error(`Error: ${err.message}`)
    console.error(err.stack)
    process.exit(1)
  }
}

// Only run as CLI when invoked directly (not when imported as a module)
if (resolve(process.argv[1] || '') === resolve(__filename)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
