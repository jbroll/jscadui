#!/usr/bin/env node
// Writes skull-mesh.js: skull.svg as a two-colour relief, stored as triangles so
// the grid can draw it with no boolean and no wasm.
// Run: node apps/jscad-web/examples/lib/build-skull-mesh.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'manifold-3d'

const here = dirname(fileURLToPath(import.meta.url))
const wasm = await Module()
wasm.setup()
const { CrossSection } = wasm

const PLATE = 10
const LINE = 16
// Curve and round-join detail, kept low so skull-mesh.js stays small
const STEP = 8
const JOIN_SEGMENTS = 10
const SIMPLIFY = 0.4

const svg = readFileSync(join(here, 'skull.svg'), 'utf-8')
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const width = (w) => w.endsWith('pt') ? parseFloat(w) * 1.25 : parseFloat(w)

const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t
  return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k])
}

// Returns subpaths as { points, closed } with curves flattened and y flipped to point up
const parsePath = (d) => {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g)
  const subpaths = []
  let cur = [0, 0]
  let start = [0, 0]
  let sub = null
  let lastCtrl = null
  let cmd = null
  let i = 0
  const num = () => parseFloat(tokens[i++])
  const pt = (rel) => { const x = num(); const y = num(); return rel ? [cur[0] + x, cur[1] + y] : [x, y] }
  const lineTo = (p) => { sub.points.push(p); cur = p; lastCtrl = null }
  const curveTo = (c1, c2, p) => {
    const length = Math.hypot(c1[0] - cur[0], c1[1] - cur[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p[0] - c2[0], p[1] - c2[1])
    const n = Math.max(2, Math.ceil(length / STEP))
    const p0 = cur
    for (let k = 1; k <= n; k++) sub.points.push(cubic(p0, c1, c2, p, k / n))
    cur = p
    lastCtrl = c2
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++]
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case 'M':
        cur = start = pt(rel)
        sub = { points: [cur], closed: false }
        subpaths.push(sub)
        lastCtrl = null
        cmd = rel ? 'l' : 'L'
        break
      case 'L': lineTo(pt(rel)); break
      case 'H': { const x = num(); lineTo([rel ? cur[0] + x : x, cur[1]]); break }
      case 'V': { const y = num(); lineTo([cur[0], rel ? cur[1] + y : y]); break }
      case 'C': { const c1 = pt(rel); const c2 = pt(rel); curveTo(c1, c2, pt(rel)); break }
      case 'S': {
        const c1 = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur
        const c2 = pt(rel)
        curveTo(c1, c2, pt(rel))
        break
      }
      case 'Z':
        sub.closed = true
        cur = start
        lastCtrl = null
        break
      default: throw new Error(`unsupported path command ${cmd}`)
    }
  }
  for (const s of subpaths) s.points = s.points.map(([x, y]) => [x, -y])
  return subpaths
}

const signedArea = (pts) => pts.reduce((a, p, k) => { const q = pts[(k + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) / 2
const ccw = (pts) => signedArea(pts) < 0 ? pts.slice().reverse() : pts

const fillRegion = (subpaths) => {
  const contours = subpaths.map(s => s.points).filter(pts => pts.length >= 3)
  return contours.length ? new CrossSection(contours, 'NonZero') : null
}

// A stroke is the union of a disc at every vertex and a quad along every segment
const strokeRegion = (subpaths, strokeWidth) => {
  const r = strokeWidth / 2
  const disc = (c) => Array.from({ length: JOIN_SEGMENTS }, (_, k) => {
    const a = (2 * Math.PI * k) / JOIN_SEGMENTS
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  })
  const contours = []
  for (const { points, closed } of subpaths) {
    const pts = closed ? [...points, points[0]] : points
    pts.forEach(p => contours.push(disc(p)))
    for (let k = 1; k < pts.length; k++) {
      const [a, b] = [pts[k - 1], pts[k]]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 1e-9) continue
      const n = [-(b[1] - a[1]) / len * r, (b[0] - a[0]) / len * r]
      contours.push(ccw([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]))
    }
  }
  return new CrossSection(contours, 'Positive')
}

// Paint the elements in order, so a later white fill hides the lines under it
let black = null
let covered = null
const add = (a, b) => a ? a.add(b) : b
for (const [tag] of svg.matchAll(/<path\b[^>]*>/g)) {
  const subpaths = parsePath(attr(tag, 'd'))
  const fill = attr(tag, 'fill') ?? '#000'
  const stroke = attr(tag, 'stroke')
  if (fill !== 'none') {
    const region = fillRegion(subpaths)
    if (region) {
      black = fill === '#000' ? add(black, region) : black?.subtract(region) ?? null
      covered = add(covered, region)
    }
  }
  if (stroke && stroke !== 'none') {
    const region = strokeRegion(subpaths, width(attr(tag, 'stroke-width') ?? '1'))
    black = add(black, region)
    covered = add(covered, region)
  }
}
black = black.simplify(SIMPLIFY)
const white = covered.subtract(black).simplify(SIMPLIFY)

// Stand the drawing up facing the default camera at +X,-Y,+Z: drawing x runs
// along (1,1,0), drawing y along +Z, and the relief comes out along (1,-1,0).
const s = Math.SQRT1_2
const place = ([x, y, z]) => [s * (x + z), s * (x - z), y]

const layers = { white: white.extrude(PLATE).getMesh(), black: black.extrude(LINE).getMesh() }
const points = Object.values(layers).flatMap(mesh =>
  Array.from({ length: mesh.numVert }, (_, v) => place(mesh.position(v))))
const min = [0, 1, 2].map(k => Math.min(...points.map(p => p[k])))
const max = [0, 1, 2].map(k => Math.max(...points.map(p => p[k])))
const size = Math.max(...max.map((m, k) => m - min[k]))
const centre = max.map((m, k) => (m + min[k]) / 2)

const vertices = []
const out = { vertices }
for (const [name, mesh] of Object.entries(layers)) {
  const index = new Map()
  const indexOf = (v) => {
    const p = place(mesh.position(v)).map((c, k) => Math.round(((c - centre[k]) / size) * 1e4) / 1e4)
    const key = p.join(',')
    if (!index.has(key)) { index.set(key, vertices.length / 3); vertices.push(...p) }
    return index.get(key)
  }
  const tris = []
  for (let t = 0; t < mesh.numTri; t++) {
    const [a, b, c] = mesh.verts(t).map(indexOf)
    if (a !== b && b !== c && a !== c) tris.push(a, b, c)
  }
  out[name] = tris
}

writeFileSync(join(here, 'skull-mesh.js'),
  '// Generated by build-skull-mesh.mjs from skull.svg. Do not edit.\n' +
  `module.exports = ${JSON.stringify(out)}\n`)
console.log(`skull-mesh.js: ${vertices.length / 3} vertices, ${out.white.length / 3} white and ${out.black.length / 3} black triangles`)
