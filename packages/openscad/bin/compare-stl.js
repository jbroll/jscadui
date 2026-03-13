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
 * Convert triangles to Manifold mesh with vertex deduplication
 */
async function trianglesToManifold(triangles, Manifold, Module) {
  // Build vertex and index arrays with deduplication
  const vertices = []
  const indices = []
  const vertexMap = new Map()

  const getVertexIndex = (x, y, z) => {
    // Use string key for deduplication (rounded to avoid floating point issues)
    const key = `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`
    if (vertexMap.has(key)) {
      return vertexMap.get(key)
    }
    const index = vertices.length / 3
    vertices.push(x, y, z)
    vertexMap.set(key, index)
    return index
  }

  // Process each triangle
  for (const tri of triangles) {
    const i0 = getVertexIndex(tri[0], tri[1], tri[2])
    const i1 = getVertexIndex(tri[3], tri[4], tri[5])
    const i2 = getVertexIndex(tri[6], tri[7], tri[8])
    indices.push(i0, i1, i2)
  }

  // Create Manifold mesh
  const mesh = new Module.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(vertices),
    triVerts: new Uint32Array(indices)
  })

  const manifold = Manifold.ofMesh(mesh)

  // Auto-orient: ensure positive volume (outward-facing normals) for consistent comparison.
  // OpenSCAD and JSCAD may produce STLs with opposite winding conventions depending on
  // the geometry type (primitives vs VNF-based polyhedra). Normalizing to positive
  // volume allows Jaccard similarity to work correctly regardless of winding convention.
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
