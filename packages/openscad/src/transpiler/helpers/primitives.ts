/**
 * Primitive wrapper helper generation
 */

import type { TranspileContext } from '../context.js'

/**
 * Build primitive wrapper helpers based on usage
 */
export function buildPrimitiveHelpers(ctx: TranspileContext): string[] {
  const imports: string[] = []

  if (ctx.usedPrimitives.has('cube') || ctx.usedPrimitives.has('cuboid')) {
    // Use __cuboid if user defined cuboid (we imported it aliased above)
    const cuboidFn = ctx.availableSymbols.has('cuboid') ? '__cuboid' : 'cuboid'
    imports.push(`
const _cube = ({ size, center = false }) => {
  // size can be number or [x,y,z] array - validate each component
  const s = Array.isArray(size) ? size.map(v => _num(v) ?? 1) : [_num(size) ?? 1, _num(size) ?? 1, _num(size) ?? 1]
  const geo = s[0] === s[1] && s[1] === s[2] ? cube({ size: s[0] }) : ${cuboidFn}({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2, s[2]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('cylinder')) {
    imports.push(`
const _cylinder = ({ h, r, r1, r2, d, d1, d2, center = false, $fn = 0, $fa, $fs }) => {
  const height = _num(h, 1)
  const rr = _num(r), dd = _num(d), rr1 = _num(r1), rr2 = _num(r2), dd1 = _num(d1), dd2 = _num(d2)
  const radius1 = rr1 ?? (dd1 ? dd1/2 : (rr ?? (dd ? dd/2 : 1)))
  const radius2 = rr2 ?? (dd2 ? dd2/2 : (rr ?? (dd ? dd/2 : 1)))
  const segments = _getSegments(Math.max(radius1, radius2), $fn, $fa, $fs)
  const geo = cylinder({ height, startRadius: radius1, endRadius: radius2, segments })
  return center ? geo : translate([0, 0, height/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('sphere')) {
    // OpenSCAD-style sphere: rings at (180 * (i + 0.5)) / numRings, no pole vertices
    // This matches OpenSCAD's exact tessellation algorithm
    imports.push(`
const _sphere = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  const fn = _getSegments(radius, $fn, $fa, $fs)
  const numRings = Math.floor((fn + 1) / 2)
  const points = []
  const faces = []

  // Generate ring vertices (no poles - matches OpenSCAD)
  for (let i = 0; i < numRings; i++) {
    const phi = (180 * (i + 0.5)) / numRings * Math.PI / 180
    const z = radius * Math.cos(phi)
    const ringR = radius * Math.sin(phi)
    for (let j = 0; j < fn; j++) {
      const theta = 2 * Math.PI * j / fn
      points.push([ringR * Math.cos(theta), ringR * Math.sin(theta), z])
    }
  }

  // Top cap: triangulate first ring as polygon
  for (let j = 1; j < fn - 1; j++) faces.push([0, j, j + 1])

  // Body: quads between adjacent rings
  for (let i = 0; i < numRings - 1; i++) {
    const ring = i * fn, nextRing = (i + 1) * fn
    for (let j = 0; j < fn; j++) {
      const next = (j + 1) % fn
      faces.push([ring + j, nextRing + j, ring + next])
      faces.push([ring + next, nextRing + j, nextRing + next])
    }
  }

  // Bottom cap: triangulate last ring as polygon
  const lastRing = (numRings - 1) * fn
  for (let j = 1; j < fn - 1; j++) faces.push([lastRing, lastRing + j + 1, lastRing + j])

  return polyhedron({ points, faces, orientation: 'outward' })
}`)
  }

  if (ctx.usedPrimitives.has('circle')) {
    imports.push(`
const _circle = ({ r, d, $fn = 0, $fa, $fs }) => {
  const rr = _num(r), dd = _num(d)
  const radius = rr ?? (dd ? dd/2 : 1)
  const segments = _getSegments(radius, $fn, $fa, $fs)
  return circle({ radius, segments })
}`)
  }

  if (ctx.usedPrimitives.has('rectangle')) {
    imports.push(`
const _square = ({ size, center = false }) => {
  const s = Array.isArray(size) ? size.map(v => _num(v) ?? 1) : [_num(size) ?? 1, _num(size) ?? 1]
  const geo = rectangle({ size: s })
  return center ? geo : translate([s[0]/2, s[1]/2], geo)
}`)
  }

  if (ctx.usedPrimitives.has('regular_polygon')) {
    imports.push(`
const _regular_polygon = ({ order = 6, n, r = 1, $fn = 0 }) => {
  // n is an alias for order (number of sides)
  // Use circle with segments to create regular polygon - matches OpenSCAD's approach
  const sides = _num(n) ?? _num(order) ?? 6
  const radius = _num(r) ?? 1
  return circle({ radius, segments: sides })
}`)
  }

  if (ctx.usedPrimitives.has('polyhedron')) {
    imports.push(`
const _polyhedron = ({ points, faces, triangles, convexity }) => {
  // OpenSCAD and JSCAD use opposite winding orders for faces
  // OpenSCAD: counter-clockwise when viewed from outside
  // JSCAD: clockwise when viewed from outside (right-hand rule inward)
  // So we need to reverse each face's vertex order
  const faceList = faces || triangles || []
  const reversedFaces = faceList.map(f => [...f].reverse())
  return polyhedron({ points, faces: reversedFaces, orientation: 'outward' })
}`)
  }

  // Safe union that filters out undefined values (from assertions, etc.)
  if (ctx.usedHelpers.has('safeUnion')) {
    imports.push(`
const _safeUnion = (parts) => {
  const valid = parts.filter(p => p !== undefined && p !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return union(...valid)
}`)
  }

  return imports
}
