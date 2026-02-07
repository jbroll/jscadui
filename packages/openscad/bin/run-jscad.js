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
import { resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from '../esm/parser/parse.js'
import { transpile } from '../esm/transpiler/transpile.js'

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
  -o, --output <file>     Write STL output to file
  --volume                Print volume of the geometry
  --bbox                  Print bounding box
  --mesh-stats           Print mesh statistics (vertices, triangles)
  -h, --help              Show this help
  -v, --version           Show version

Examples:
  run-jscad model.scad -o model.stl      Transpile and export to STL
  run-jscad model.js -o model.stl        Run JSCAD and export to STL
  run-jscad model.scad --volume          Print volume for comparison
`)
}

function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    volume: false,
    bbox: false,
    meshStats: false,
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
    } else if (arg === '-o' || arg === '--output') {
      i++
      options.output = args[i]
    } else if (arg === '--fn') {
      i++
      options.fn = parseInt(args[i], 10)
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
function exportStl(geometry) {
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
async function createRuntime() {
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

  const transforms = await import(transformsPath)
  const extrusions = await import(extrusionsPath)
  const hulls = await import(hullsPath)
  const colors = await import(colorsPath)

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
      },
    },
    // Manifold module for advanced operations
    _manifold: manifold,
  }
}

/**
 * File resolver for use statements in OpenSCAD
 * Resolves relative to the directory containing the current file
 */
function createFileResolver(fileDir) {
  return function fileResolver(filename, fromFile) {
    const baseDir = fromFile ? dirname(resolve(fileDir, fromFile)) : fileDir
    const targetPath = resolve(baseDir, filename)

    if (existsSync(targetPath)) {
      return readFileSync(targetPath, 'utf8')
    }

    console.error(`Warning: Could not resolve ${filename} from ${fromFile || 'main file'}`)
    return undefined
  }
}

/**
 * Transpile OpenSCAD source and return code + in-memory module cache
 */
function transpileScad(source, fileName, fileDir, fn = 0) {
  const { ast, errors } = parse(source)

  if (errors.length > 0) {
    throw new Error(`Parse errors: ${JSON.stringify(errors)}`)
  }

  const result = transpile(ast, {
    fileResolver: createFileResolver(fileDir),
    currentFile: fileName,
    fn: fn,
  })

  // Build in-memory module cache from transpiled files
  const moduleCache = new Map()
  for (const [name, file] of result.files) {
    const jsName = './' + name.replace(/\.scad$/, '.js')
    moduleCache.set(jsName, file.code)
  }

  return { code: result.code, moduleCache }
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
      const fileName = basename(inputPath)
      const transpiled = transpileScad(source, fileName, fileDir, options.fn)
      jsCode = transpiled.code
      moduleCache = transpiled.moduleCache
    } else {
      jsCode = source
    }

    // Custom require that serves transpiled files from in-memory cache
    function customRequire(path) {
      if (path === '@jscad/modeling') {
        return jscadModeling
      }
      // Check if it's a transpiled dependency
      if (moduleCache.has(path)) {
        const code = moduleCache.get(path)
        const exports = {}
        const moduleObj = { exports }
        const fn = new Function('require', 'module', 'exports', code)
        fn(customRequire, moduleObj, exports)
        return moduleObj.exports
      }
      throw new Error('Module not found: ' + path)
    }

    // Evaluate the code with our custom require
    const exports = {}
    const moduleObj = { exports }
    const fn = new Function('require', 'module', 'exports', jsCode)
    fn(customRequire, moduleObj, exports)

    // Call main() if it exists
    let result
    if (typeof moduleObj.exports.main === 'function') {
      result = moduleObj.exports.main()
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
