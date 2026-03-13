#!/usr/bin/env node

/**
 * CLI tool for running OpenSCAD or JSCAD code with Manifold backend and exporting to STL
 *
 * Usage:
 *   run-jscad input.scad -o output.stl   # Transpile and run OpenSCAD
 *   run-jscad input.js -o output.stl     # Run JSCAD directly
 *   run-jscad input.scad --volume        # Just print volume (for comparison)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from '../esm/parser/parse.js'
import { transpile } from '../esm/transpiler/transpile.js'
import { registerCachedFonts } from '../../jscad-text/src/fonts/fontCache.js'

// Register any Liberation fonts already in the local cache (~/.cache/jscadui/fonts/).
// This is synchronous and fast — no download happens here.
// To populate the cache, run: node packages/openscad/bin/download-fonts.js
registerCachedFonts()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const VERSION = '0.1.0'

function printHelp() {
  console.log(`
run-jscad - Run OpenSCAD or JSCAD code with Manifold backend

Usage:
  run-jscad <input.scad> [options]    Transpile and run OpenSCAD
  run-jscad <input.js> [options]      Run JSCAD directly

Options:
  -o, --output <file>       Write STL output to file
  --volume                  Print volume of the geometry
  --bbox                    Print bounding box
  --mesh-stats              Print mesh statistics (vertices, triangles)
  --source-comments         Include source line comments in transpiled code
  --lib-path <path>         Add OpenSCAD library search path (can be repeated)
  --debug-transpile         Print transpiled JavaScript to stderr
  --patch-file <file>       Load patched transpiled code from file (debug)
  -h, --help                Show this help
  -v, --version             Show version

Examples:
  run-jscad model.scad -o model.stl                    Transpile and export to STL
  run-jscad model.js -o model.stl                      Run JSCAD and export to STL
  run-jscad model.scad --volume                        Print volume for comparison
  run-jscad model.scad --source-comments               Transpile with line comments
  run-jscad model.scad --lib-path ~/mylibs --lib-path /usr/share/openscad
  run-jscad model.scad --debug-transpile               Show transpiled code
`)
}

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    volume: false,
    bbox: false,
    meshStats: false,
    sourceComments: false,
    libPaths: [],
    debugTranspile: false,
    patchFile: null,
    help: false,
    version: false,
    fn: 0,  // Global $fn override
  }

  let i = 0
  while (i < args.length) {
    const arg = args[i]

    if (arg === '-h' || arg === '--help') {
      options.help = true
    } else if (arg === '-v' || arg === '--version') {
      options.version = true
    } else if (arg === '--volume') {
      options.volume = true
    } else if (arg === '--bbox') {
      options.bbox = true
    } else if (arg === '--mesh-stats') {
      options.meshStats = true
    } else if (arg === '--source-comments') {
      options.sourceComments = true
    } else if (arg === '--debug-transpile') {
      options.debugTranspile = true
    } else if (arg === '-o' || arg === '--output') {
      i++
      options.output = args[i]
    } else if (arg === '--fn') {
      i++
      options.fn = parseInt(args[i], 10)
    } else if (arg === '--lib-path') {
      i++
      options.libPaths.push(args[i])
    } else if (arg === '--patch-file') {
      i++
      options.patchFile = args[i]
    } else if (!arg.startsWith('-')) {
      options.input = arg
    } else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
    i++
  }

  return options
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Export geometry to STL format
 * @param {Object} geometry - ManifoldGeom3 or similar with vertices/indices/normals
 * @returns {string} STL text content
 */
export function exportStl(geometry) {
  const vertices = geometry.vertices
  const indices = geometry.indices
  const normals = geometry.normals

  const lines = ['solid JSCAD\n']

  // Each triangle (3 indices)
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]
    const i1 = indices[i + 1]
    const i2 = indices[i + 2]

    // Get normal (same for all 3 vertices of a flat-shaded triangle)
    const nx = normals[i * 3]
    const ny = normals[i * 3 + 1]
    const nz = normals[i * 3 + 2]

    // Get vertices
    const v0x = vertices[i0 * 3], v0y = vertices[i0 * 3 + 1], v0z = vertices[i0 * 3 + 2]
    const v1x = vertices[i1 * 3], v1y = vertices[i1 * 3 + 1], v1z = vertices[i1 * 3 + 2]
    const v2x = vertices[i2 * 3], v2y = vertices[i2 * 3 + 1], v2z = vertices[i2 * 3 + 2]

    lines.push(`facet normal ${nx} ${ny} ${nz}\n`)
    lines.push('outer loop\n')
    lines.push(`vertex ${v0x} ${v0y} ${v0z}\n`)
    lines.push(`vertex ${v1x} ${v1y} ${v1z}\n`)
    lines.push(`vertex ${v2x} ${v2y} ${v2z}\n`)
    lines.push('endloop\nendfacet\n')
  }

  lines.push('endsolid JSCAD\n')
  return lines.join('')
}

/**
 * Create a JSCAD runtime environment with Manifold backend
 * This provides the same API as @jscad/modeling
 */
export async function createRuntime() {
  // Dynamically import the Manifold package
  const manifoldPath = join(__dirname, '..', '..', 'manifold', 'src', 'index.js')
  const manifold = await import(manifoldPath)

  // Initialize Manifold WASM
  await manifold.init()

  // Import all modules from Manifold package
  const transformsPath = join(__dirname, '..', '..', 'manifold', 'src', 'transforms', 'index.js')
  const extrusionsPath = join(__dirname, '..', '..', 'manifold', 'src', 'extrusions', 'index.js')
  const hullsPath = join(__dirname, '..', '..', 'manifold', 'src', 'hulls', 'index.js')
  const colorsPath = join(__dirname, '..', '..', 'manifold', 'src', 'colors', 'index.js')

  const expansionsPath = join(__dirname, '..', '..', 'manifold', 'src', 'expansions', 'index.js')
  const textPath = join(__dirname, '..', '..', 'manifold', 'src', 'text', 'index.js')
  const measurementsPath = join(__dirname, '..', '..', 'manifold', 'src', 'measurements', 'index.js')

  const transforms = await import(transformsPath)
  const extrusions = await import(extrusionsPath)
  const hulls = await import(hullsPath)
  const colors = await import(colorsPath)
  const expansions = await import(expansionsPath)
  const textModule = await import(textPath)
  const measurements = await import(measurementsPath)

  // Import geometries module for geom2 (needed by _linearExtrude with scale/twist)
  const geometriesPath = join(__dirname, '..', '..', 'manifold', 'src', 'geometries', 'index.js')
  const geometries = await import(geometriesPath)

  // Build the runtime that matches @jscad/modeling API
  // The emitter generates code like: cube({ size: 10 })
  return {
    primitives: {
      cube: manifold.primitives.cube,
      cuboid: manifold.primitives.cuboid,
      sphere: manifold.primitives.sphere,
      cylinder: manifold.primitives.cylinder,
      cylinderElliptic: manifold.primitives.cylinderElliptic,
      circle: manifold.primitives.circle,
      rectangle: manifold.primitives.rectangle,
      square: manifold.primitives.square,
      polygon: manifold.primitives.polygon,
      polyhedron: manifold.primitives.polyhedron,
      torus: manifold.primitives.torus,
      geodesicSphere: manifold.primitives.geodesicSphere,
      roundedCuboid: manifold.primitives.roundedCuboid,
      roundedCylinder: manifold.primitives.roundedCylinder,
      ellipsoid: manifold.primitives.ellipsoid,
      star: manifold.primitives.star,
      roundedRectangle: manifold.primitives.roundedRectangle,
      ellipse: manifold.primitives.ellipse,
    },
    booleans: {
      union: manifold.booleans.union,
      subtract: manifold.booleans.subtract,
      intersect: manifold.booleans.intersect,
      minkowski: manifold.booleans.minkowski,
    },
    transforms: {
      translate: transforms.translate,
      rotate: transforms.rotate,
      scale: transforms.scale,
      mirror: transforms.mirror,
      rotateX: transforms.rotateX,
      rotateY: transforms.rotateY,
      rotateZ: transforms.rotateZ,
      translateX: transforms.translateX,
      translateY: transforms.translateY,
      translateZ: transforms.translateZ,
      scaleX: transforms.scaleX,
      scaleY: transforms.scaleY,
      scaleZ: transforms.scaleZ,
      mirrorX: transforms.mirrorX,
      mirrorY: transforms.mirrorY,
      mirrorZ: transforms.mirrorZ,
      transform: transforms.transform,
    },
    extrusions: {
      extrudeLinear: extrusions.extrudeLinear,
      extrudeRotate: extrusions.extrudeRotate,
      extrudeFromSlices: extrusions.extrudeFromSlices,
      slice: extrusions.slice,  // Keep for compatibility
      _jscadSlice: extrusions.slice,  // Renamed to avoid conflict with OpenSCAD's slice()
    },
    geometries: {
      geom2: geometries.geom2,
      geom3: geometries.geom3,
      path2: geometries.path2,
    },
    hulls: {
      hull: hulls.hull,
      hullChain: hulls.hullChain,
    },
    colors: {
      colorize: colors.colorize,
      cssColors: colors.cssColors,
      colorNameToRgb: colors.colorNameToRgb,
    },
    expansions: {
      offset: expansions.offset,
      expand: expansions.expand,
    },
    text: {
      vectorChar: textModule.vectorChar,
      vectorText: textModule.vectorText,
    },
    measurements: {
      measureBoundingBox: measurements.measureBoundingBox,
      measureVolume: measurements.measureVolume,
      measureArea: measurements.measureArea,
      measureCenter: measurements.measureCenter,
      measureDimensions: measurements.measureDimensions,
      measureIsEmpty: measurements.measureIsEmpty,
      measureAggregateBoundingBox: measurements.measureAggregateBoundingBox,
      measureBoundingSphere: measurements.measureBoundingSphere,
      measureEpsilon: measurements.measureEpsilon,
    },
    maths: {
      mat4: {
        create: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        fromRotation: (out, angle, axis) => {
          // Simple axis-angle to matrix conversion
          const x = axis[0], y = axis[1], z = axis[2]
          const len = Math.hypot(x, y, z)
          if (len === 0) return out
          const nx = x / len, ny = y / len, nz = z / len
          const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
          out[0] = t * nx * nx + c
          out[1] = t * nx * ny + s * nz
          out[2] = t * nx * nz - s * ny
          out[3] = 0
          out[4] = t * nx * ny - s * nz
          out[5] = t * ny * ny + c
          out[6] = t * ny * nz + s * nx
          out[7] = 0
          out[8] = t * nx * nz + s * ny
          out[9] = t * ny * nz - s * nx
          out[10] = t * nz * nz + c
          out[11] = 0
          out[12] = 0
          out[13] = 0
          out[14] = 0
          out[15] = 1
          return out
        },
        translate: (out, m, v) => {
          const [x, y, z] = v
          out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; out[3] = m[3]
          out[4] = m[4]; out[5] = m[5]; out[6] = m[6]; out[7] = m[7]
          out[8] = m[8]; out[9] = m[9]; out[10] = m[10]; out[11] = m[11]
          out[12] = m[0] * x + m[4] * y + m[8] * z + m[12]
          out[13] = m[1] * x + m[5] * y + m[9] * z + m[13]
          out[14] = m[2] * x + m[6] * y + m[10] * z + m[14]
          out[15] = m[3] * x + m[7] * y + m[11] * z + m[15]
          return out
        },
        rotateZ: (out, m, angle) => {
          const s = Math.sin(angle), c = Math.cos(angle)
          const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3]
          const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7]
          out[0] = a00 * c + a10 * s; out[1] = a01 * c + a11 * s
          out[2] = a02 * c + a12 * s; out[3] = a03 * c + a13 * s
          out[4] = a10 * c - a00 * s; out[5] = a11 * c - a01 * s
          out[6] = a12 * c - a02 * s; out[7] = a13 * c - a03 * s
          out[8] = m[8]; out[9] = m[9]; out[10] = m[10]; out[11] = m[11]
          out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15]
          return out
        },
        scale: (out, m, v) => {
          const [x, y, z] = v
          out[0] = m[0] * x; out[1] = m[1] * x; out[2] = m[2] * x; out[3] = m[3] * x
          out[4] = m[4] * y; out[5] = m[5] * y; out[6] = m[6] * y; out[7] = m[7] * y
          out[8] = m[8] * z; out[9] = m[9] * z; out[10] = m[10] * z; out[11] = m[11] * z
          out[12] = m[12]; out[13] = m[13]; out[14] = m[14]; out[15] = m[15]
          return out
        },
      },
    },
    // Manifold module for advanced operations
    _manifold: manifold,
  }
}

/**
 * Get OpenSCAD library paths
 * Follows OpenSCAD's convention: ~/.local/share/OpenSCAD/libraries on Linux
 *
 * @param {string[]} customPaths - Additional library paths from --lib-path options
 */
function getLibraryPaths(customPaths = []) {
  const paths = []
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) {
    // Linux/Mac: ~/.local/share/OpenSCAD/libraries
    paths.push(join(home, '.local', 'share', 'OpenSCAD', 'libraries'))
    // Alternative: ~/Documents/OpenSCAD/libraries
    paths.push(join(home, 'Documents', 'OpenSCAD', 'libraries'))
  }
  // Add custom library paths from CLI options
  paths.push(...customPaths)
  return paths
}

/**
 * File resolver for use statements in OpenSCAD
 * Simple resolution order:
 * 1. Try relative to current file (or base directory)
 * 2. Try in library paths (OPENSCADPATH-like behavior)
 *
 * No special casing - filesystem checks are cheap in Node.js
 */
export function createFileResolver(fileDir, customLibPaths = []) {
  const libraryPaths = getLibraryPaths(customLibPaths)

  return function fileResolver(filename, fromFile) {
    // Try relative to current file first
    const baseDir = fromFile ? dirname(fromFile) : fileDir
    const relativePath = resolve(baseDir, filename)

    if (existsSync(relativePath)) {
      return {
        path: relativePath,  // Use full filesystem path
        content: readFileSync(relativePath, 'utf8')
      }
    }

    // Try each library path
    for (const libPath of libraryPaths) {
      const libTargetPath = resolve(libPath, filename)
      if (existsSync(libTargetPath)) {
        return {
          path: libTargetPath,  // Use full filesystem path
          content: readFileSync(libTargetPath, 'utf8')
        }
      }
    }

    console.error(`Warning: Could not resolve ${filename} from ${fromFile || 'main file'}`)
    return undefined
  }
}

/**
 * Transpile OpenSCAD source and return code + in-memory module cache
 * @param {Map} [sharedCache] - Optional shared transpiler cache (Map<path, TranspiledFile>)
 *   for reuse across multiple transpile calls in the same process.
 */
export function transpileScad(source, fileName, fileDir, fn = 0, sourceComments = false, customLibPaths = [], sharedCache = undefined) {
  const { ast, errors } = parse(source)

  if (errors.length > 0) {
    throw new Error(`Parse errors: ${JSON.stringify(errors)}`)
  }

  const result = transpile(ast, {
    fileResolver: createFileResolver(fileDir, customLibPaths),
    currentFile: fileName,
    fn: fn,
    includeSourceComments: sourceComments,
  }, sharedCache)

  // Build in-memory module cache from transpiled files.
  // Keys are absolute paths (from fileResolver) — match what require() passes.
  const moduleCache = new Map()
  for (const [name, file] of result.files) {
    moduleCache.set(name.replace(/\.scad$/, '.js'), file.code)
  }

  return { code: result.code, moduleCache }
}

// ── Module-level runtime cache ─────────────────────────────────────────────
// These are initialized once per process and shared across all in-process calls.

let _manifoldRuntime = null
let _manifoldModule = null
let _openscadRuntime = null

async function _getManifoldRuntime() {
  if (!_manifoldRuntime) _manifoldRuntime = await createRuntime()
  return _manifoldRuntime
}

/** Return the raw initialized Manifold module (for STL comparison). */
export async function getManifoldModule() {
  if (!_manifoldModule) {
    const manifoldPath = join(__dirname, '..', '..', 'manifold', 'src', 'index.js')
    _manifoldModule = await import(manifoldPath)
    await _manifoldModule.init()
  }
  return _manifoldModule
}

async function _getOpenscadRuntime() {
  if (!_openscadRuntime) {
    const runtimePath = join(__dirname, '..', '..', 'openscad-runtime', 'src', 'index.js')
    _openscadRuntime = await import(runtimePath)
  }
  return _openscadRuntime
}

// ── Shared require factory ─────────────────────────────────────────────────
// Extracted from main() so it can be reused by runScadToStl.

function createMakeRequire(jscadModeling, openscadRuntime, moduleCache, fn, libPaths, sharedCache) {
  function makeRequire(currentFileDir) {
    return function customRequire(path) {
      if (path === '@jscad/modeling') return jscadModeling
      if (path === '@jscadui/openscad-runtime') return openscadRuntime

      // The transpiler generates require() paths with .scad extension
      // Convert to .js to look up in the moduleCache
      const jsPath = path.replace(/\.scad$/, '.js')

      if (moduleCache.has(jsPath)) {
        const code = moduleCache.get(jsPath)
        const exports = {}
        const moduleObj = { exports }
        const modFn = new Function('require', 'module', 'exports', code)
        modFn(customRequire, moduleObj, exports)
        return moduleObj.exports
      }

      // Try to load .scad files from the filesystem (transpile on demand)
      if (path.endsWith('.scad')) {
        try {
          const resolvedPath = resolve(currentFileDir, path)
          if (existsSync(resolvedPath)) {
            const scadSource = readFileSync(resolvedPath, 'utf8')
            const fileDir = dirname(resolvedPath)
            const transpiled = transpileScad(scadSource, resolvedPath, fileDir, fn, false, libPaths, sharedCache)

            // Add transpiled dependencies to moduleCache for this run
            for (const [name, code] of transpiled.moduleCache) {
              if (!moduleCache.has(name)) moduleCache.set(name, code)
            }

            const exports = {}
            const moduleObj = { exports }
            const newFileDir = dirname(resolvedPath)
            const nestedRequire = makeRequire(newFileDir)
            const modFn = new Function('require', 'module', 'exports', transpiled.code)
            modFn(nestedRequire, moduleObj, exports)
            return moduleObj.exports
          }
        } catch (_err) {
          throw new Error(`Module not found: ${path} (${_err.message})`)
        }
      }

      // Try to load regular .js files from the filesystem
      if (path.endsWith('.js') || path.startsWith('./') || path.startsWith('../')) {
        try {
          const resolvedPath = resolve(currentFileDir, path)
          if (existsSync(resolvedPath)) {
            const code = readFileSync(resolvedPath, 'utf8')
            const exports = {}
            const moduleObj = { exports }
            const newFileDir = dirname(resolvedPath)
            const nestedRequire = makeRequire(newFileDir)
            const modFn = new Function('require', 'module', 'exports', code)
            modFn(nestedRequire, moduleObj, exports)
            return moduleObj.exports
          }
        } catch (_err) {
          // Fall through to error below
        }
      }

      throw new Error('Module not found: ' + path)
    }
  }
  return makeRequire
}

// ── Shared params proxy factory ────────────────────────────────────────────

function createParamsProxy() {
  const paramsData = {}
  return new Proxy(paramsData, {
    set(target, prop, value) {
      // If setting a parameter definition object, store the default value
      if (value && typeof value === 'object' && 'default' in value) {
        target[prop] = value.default
      } else {
        target[prop] = value
      }
      return true
    },
    get(target, prop) {
      if (!(prop in target)) {
        target[prop] = new Proxy({}, this)
      }
      return target[prop]
    }
  })
}

// ── In-process execution (for test-harness) ────────────────────────────────

/**
 * Transpile and run a .scad file in-process, writing the result to stlPath.
 * Uses module-level cached runtimes (Manifold WASM + openscad-runtime).
 *
 * @param {string} scadPath - Path to the .scad source file
 * @param {string} stlPath - Output STL file path
 * @param {number} fn - Global $fn override (0 = use OpenSCAD formula)
 * @param {string[]} libPaths - Additional library search paths
 * @param {Map} [sharedCache] - Shared transpiler cache (avoids re-transpiling shared libs)
 */
export async function runScadToStl(scadPath, stlPath, fn, libPaths, sharedCache) {
  const inputPath = resolve(scadPath)
  const fileDir = dirname(inputPath)
  const source = readFileSync(inputPath, 'utf8')

  const { code: jsCode, moduleCache } = transpileScad(source, inputPath, fileDir, fn, false, libPaths, sharedCache)

  const jscadModeling = await _getManifoldRuntime()
  const openscadRuntime = await _getOpenscadRuntime()

  global.jscadui_openscad = { parse, transpile, j$: openscadRuntime.j$ }

  const makeRequire = createMakeRequire(jscadModeling, openscadRuntime, moduleCache, fn, libPaths, sharedCache)
  const customRequire = makeRequire(fileDir)

  const exports = {}
  const moduleObj = { exports }
  const modFn = new Function('require', 'module', 'exports', jsCode)
  modFn(customRequire, moduleObj, exports)

  if (typeof moduleObj.exports.main !== 'function') {
    throw new Error('No main() function found in ' + scadPath)
  }

  const params = createParamsProxy()
  const result = await Promise.resolve(moduleObj.exports.main(params))

  // Null/undefined result = all geometry was ghost (% modifier) → write empty STL
  if (!result || (Array.isArray(result) && result.length === 0)) {
    writeFileSync(stlPath, 'solid JSCAD\nendsolid JSCAD\n')
    return
  }

  const geometry = Array.isArray(result) ? jscadModeling.booleans.union(result) : result
  if (!geometry) {
    writeFileSync(stlPath, 'solid JSCAD\nendsolid JSCAD\n')
    return
  }
  writeFileSync(stlPath, exportStl(geometry))
}

async function main() {
  const args = process.argv.slice(2)
  const options = parseArgs(args)

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  if (options.version) {
    console.log(`run-jscad v${VERSION}`)
    process.exit(0)
  }

  // Read input
  let source
  let inputPath
  let isScad = false

  if (options.input) {
    inputPath = resolve(options.input)
    isScad = options.input.endsWith('.scad')
    try {
      source = readFileSync(inputPath, 'utf8')
    } catch (err) {
      console.error(`Error reading file: ${options.input}`)
      console.error(err.message)
      process.exit(1)
    }
  } else if (!process.stdin.isTTY) {
    source = await readStdin()
  } else {
    console.error('No input file specified. Use -h for help.')
    process.exit(1)
  }

  try {
    // Create runtime with Manifold backend
    const jscadModeling = await createRuntime()

    // If it's a .scad file, transpile it first
    let jsCode
    let moduleCache = new Map()

    if (isScad) {
      const fileDir = dirname(inputPath)
      const fileName = inputPath  // Use full filesystem path
      const transpiled = transpileScad(source, fileName, fileDir, options.fn, options.sourceComments, options.libPaths)
      jsCode = transpiled.code
      moduleCache = transpiled.moduleCache
      if (options.debugTranspile) {
        console.error('=== MAIN FILE ===')
        console.error(jsCode)
        for (const [name, code] of moduleCache) {
          console.error(`=== ${name} ===`)
          console.error(code)
        }
      }
      // Allow loading patched code from a file for debugging
      if (options.patchFile) {
        jsCode = readFileSync(options.patchFile, 'utf8')
        console.error('Loaded patched code from:', options.patchFile)
      }
    } else {
      jsCode = source
    }

    // Dynamically import the openscad-runtime package
    const runtimePath = join(__dirname, '..', '..', 'openscad-runtime', 'src', 'index.js')
    const openscadRuntime = await import(runtimePath)

    // Create the jscadui_openscad global that the transpiled code expects
    // This mirrors the bundle structure from bundle.openscad.js
    global.jscadui_openscad = {
      parse,
      transpile,
      j$: openscadRuntime.j$
    }

    const mainFileDir = dirname(inputPath)
    const makeRequire = createMakeRequire(jscadModeling, openscadRuntime, moduleCache, options.fn, options.libPaths, undefined)
    const customRequire = makeRequire(mainFileDir)

    // Evaluate the code with our custom require
    const exports = {}
    const moduleObj = { exports }
    const modFn = new Function('require', 'module', 'exports', jsCode)
    modFn(customRequire, moduleObj, exports)

    // Call main() if it exists - handle both sync and async main()
    let result
    if (typeof moduleObj.exports.main === 'function') {
      const params = createParamsProxy()
      result = await Promise.resolve(moduleObj.exports.main(params))
    } else {
      result = null
    }

    if (!result) {
      console.error('No geometry returned from main()')
      process.exit(1)
    }

    // Handle array of geometries (union them)
    const geometry = Array.isArray(result)
      ? jscadModeling.booleans.union(result)
      : result

    // Print requested info
    if (options.volume) {
      const vol = geometry.volume ? geometry.volume() : geometry.manifold?.volume()
      console.log(`Volume: ${vol}`)
    }

    if (options.bbox) {
      const bbox = geometry.boundingBox ? geometry.boundingBox() : geometry.manifold?.boundingBox()
      if (bbox) {
        console.log(`Bounding box: min=[${bbox[0].join(', ')}] max=[${bbox[1].join(', ')}]`)
      }
    }

    if (options.meshStats) {
      const verts = geometry.vertices
      const indices = geometry.indices
      console.log(`Mesh stats: ${verts.length / 3} vertices, ${indices.length / 3} triangles`)
    }

    // Export to STL if requested
    if (options.output) {
      const stl = exportStl(geometry)
      writeFileSync(options.output, stl)
      console.error(`Wrote ${options.output}`)
    } else if (!options.volume && !options.bbox && !options.meshStats) {
      // If no output or stats requested, print STL to stdout
      const stl = exportStl(geometry)
      console.log(stl)
    }

  } catch (err) {
    console.error(`Execution error: ${err.message}`)
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
