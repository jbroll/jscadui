/**
 * @jscadui/manifold - Manifold-based geometry operations for JSCAD
 *
 * Drop-in replacement for @jscad/modeling-for-manifold that uses Manifold for guaranteed
 * watertight, manifold geometry output.
 *
 * @example
 * import { init, primitives, booleans } from '@jscadui/manifold'
 *
 * // Initialize Manifold WASM module (required before any operations)
 * await init()
 *
 * // Use like @jscad/modeling-for-manifold
 * const { cube, sphere, cylinder } = primitives
 * const { union, subtract, intersect } = booleans
 *
 * const box = cube({ size: 10 })
 * const hole = cylinder({ radius: 3, height: 12 })
 * const result = subtract(box, hole)
 */

// WASM initialization - MUST be called before any operations
// The `ready` promise should be awaited before using any Manifold operations
export { init, ready, startInit, setWasmUrl, getModule, getManifold, getCrossSection, isInitialized } from './init.js'

// Geometry types
export * as geometries from './geometries/index.js'

// Operations - organized like @jscad/modeling-for-manifold
export * as primitives from './primitives/index.js'
export * as booleans from './booleans/index.js'
export * as transforms from './transforms/index.js'
export * as extrusions from './extrusions/index.js'
export * as hulls from './hulls/index.js'
export * as modifiers from './modifiers/index.js'
export * as expansions from './expansions/index.js'

// Measurements, colors, text, and curves
export * as measurements from './measurements/index.js'
export * as colors from './colors/index.js'
export * as text from './text/index.js'
export * as curves from './curves/index.js'

// Math utilities
export * as maths from './maths/index.js'

// General utilities
export * as utils from './utils/index.js'

// Re-export commonly used items at top level for convenience
export {
  // Primitives
  cube,
  cuboid,
  sphere,
  ellipsoid,
  cylinder,
  cylinderElliptic,
  roundedCuboid,
  roundedCylinder,
  geodesicSphere,
  torus,
  polyhedron,
  rectangle,
  square,
  circle,
  ellipse,
  polygon,
  roundedRectangle,
  star,
  // Paths
  arc,
  line
} from './primitives/index.js'

export {
  // Booleans
  union,
  subtract,
  intersect,
  scission,
  minkowski
} from './booleans/index.js'

export {
  // Transforms
  translate,
  translateX,
  translateY,
  translateZ,
  rotate,
  rotateX,
  rotateY,
  rotateZ,
  scale,
  scaleX,
  scaleY,
  scaleZ,
  mirror,
  mirrorX,
  mirrorY,
  mirrorZ,
  transform,
  center,
  centerX,
  centerY,
  centerZ,
  align
} from './transforms/index.js'

export {
  // Extrusions
  extrudeLinear,
  extrudeRotate,
  extrudeHelical,
  extrudeFromSlices,
  project
} from './extrusions/index.js'

export {
  // Hulls
  hull,
  hullChain
} from './hulls/index.js'

export {
  // Modifiers
  offset,
  expand,
  shell,
  generalize,
  snap,
  retessellate
} from './modifiers/index.js'

export {
  // Measurements
  measureBoundingBox,
  measureVolume,
  measureArea,
  measureCenter,
  measureDimensions,
  measureIsEmpty,
  measureAggregateBoundingBox,
  measureBoundingSphere,
  measureEpsilon
} from './measurements/index.js'

export {
  // Colors
  colorize,
  hexToRgb,
  hslToRgb,
  hsvToRgb,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  colorNameToRgb,
  cssColors
} from './colors/index.js'

export {
  // Text
  vectorChar,
  vectorText
} from './text/index.js'

// Geometry wrappers
export {
  ManifoldGeom3,
  fromManifold,
  isManifoldGeom3,
  toManifold
} from './geometries/ManifoldGeom3.js'

/**
 * Configure GPU-computed normals mode.
 * When enabled, ManifoldGeom3 returns indexed mesh without normals,
 * allowing the renderer to compute flat normals in the fragment shader.
 * This reduces CPU work, data transfer, and GPU buffer uploads.
 *
 * @param {boolean} enabled - Whether to enable GPU normals
 */
import { ManifoldGeom3 as _ManifoldGeom3 } from './geometries/ManifoldGeom3.js'
export const setUseGpuNormals = (enabled) => {
  _ManifoldGeom3.useGpuNormals = enabled
}

export {
  ManifoldGeom2,
  fromCrossSection,
  isManifoldGeom2,
  toCrossSection
} from './geometries/ManifoldGeom2.js'

// Conversion utilities
export {
  geom3ToManifold,
  manifoldToGeom3,
  geom2ToCrossSection,
  crossSectionToGeom2
} from './conversions/index.js'

// Math constants
export { TAU, PHI, degToRad, radToDeg } from './maths/index.js'
