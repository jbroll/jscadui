/**
 * TTFLoader - load TTF/OTF fonts and convert glyph outlines to polylines.
 *
 * Supports multiple input types:
 *   - URL string (https:// or http://) → sync XHR in browser workers, or async fetch()
 *   - File path string                 → opentype.loadSync() [Node.js only]
 *   - ArrayBuffer / Buffer             → direct parse (synchronous)
 *   - Uint8Array                       → direct parse (synchronous)
 *
 * The font is parsed using opentype.js. Glyph contours are tessellated into
 * polylines using the $fn quality parameter.
 *
 * Synchronous loading (text2d / the normal path):
 *   - Browser Web Worker: uses sync XMLHttpRequest (explicitly allowed in workers)
 *   - Node.js file path: uses opentype.loadSync() → fs.readFileSync()
 *   - Node.js HTTP URL: not supported synchronously; pre-load with fontLoader.load()
 *   - ArrayBuffer/Buffer/Uint8Array: always synchronous (bytes already in memory)
 *
 * Async loading (pre-load before first use, or Node.js HTTP):
 *   const font = await fontLoader.load('https://example.com/Font.ttf')
 *   const geom = text2d('Hello', { font: 'https://example.com/Font.ttf' })
 */

import opentype from 'opentype.js'

function isUrl(source) {
  return source.startsWith('http://') || source.startsWith('https://') ||
         source.startsWith('//') || source.startsWith('file://')
}

/**
 * Load raw font bytes synchronously.
 *
 * - ArrayBuffer / Uint8Array / Buffer: returned as-is (already in memory)
 * - URL string in browser (including Web Worker): uses sync XMLHttpRequest
 * - File path string in Node.js: delegated to opentype.loadSync() below
 * - Node.js HTTP URL: throws — use fontLoader.load() to pre-load async
 *
 * @param {string | ArrayBuffer | Buffer | Uint8Array} source
 * @returns {ArrayBuffer | null} null means "use opentype.loadSync directly (Node.js file path)"
 */
function loadFontBytesSync(source) {
  if (source instanceof ArrayBuffer) {
    return source
  }

  if (source instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer?.isBuffer?.(source))) {
    const buf = source instanceof Uint8Array ? source : new Uint8Array(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  // Local Font Access API FontData object (browser)
  if (source && typeof source === 'object' && typeof source.blob === 'function') {
    throw new Error(
      'TTFLoader: FontData objects require async loading. ' +
      'Use: await fontLoader.load(fontData)'
    )
  }

  if (typeof source === 'string') {
    // Browser context or explicit URL: use sync XHR
    // Sync XHR is explicitly allowed in Web Workers (removed only from main thread)
    if (typeof XMLHttpRequest !== 'undefined') {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', source, false)  // false = synchronous
      xhr.responseType = 'arraybuffer'
      xhr.send(null)
      if (xhr.status === 200) return xhr.response
      throw new Error(`Failed to load font from ${source}: ${xhr.status} ${xhr.statusText}`)
    }

    // Node.js: file paths handled by opentype.loadSync (return null to signal this)
    if (!isUrl(source)) {
      return null  // caller uses opentype.loadSync(source) directly
    }

    // Node.js + HTTP URL: not synchronously loadable without sync XHR
    throw new Error(
      `Cannot load font synchronously from URL in Node.js: "${source}"\n` +
      'Pre-load the font first:\n' +
      '  await fontLoader.load(url)\n' +
      'Then text2d() will use the cached font synchronously.'
    )
  }

  throw new Error(`TTFLoader: unsupported font source type: ${typeof source}`)
}

/**
 * Load raw font bytes asynchronously (for pre-loading or Node.js HTTP URLs).
 *
 * @param {string | ArrayBuffer | Buffer | Uint8Array | object} source
 * @returns {Promise<ArrayBuffer>}
 */
async function loadFontBytesAsync(source) {
  if (source instanceof ArrayBuffer) {
    return source
  }

  if (source instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer?.isBuffer?.(source))) {
    const buf = source instanceof Uint8Array ? source : new Uint8Array(source)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  // Local Font Access API FontData object (browser)
  if (source && typeof source === 'object' && typeof source.blob === 'function') {
    const blob = await source.blob()
    return blob.arrayBuffer()
  }

  if (typeof source === 'string') {
    const srcIsUrl = isUrl(source)

    if (srcIsUrl || typeof window !== 'undefined') {
      // Browser or URL: use fetch
      const response = await fetch(source)
      if (!response.ok) {
        throw new Error(`Failed to load font from ${source}: ${response.status} ${response.statusText}`)
      }
      return response.arrayBuffer()
    }

    // Node.js file path
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(source)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  throw new Error(`TTFLoader: unsupported font source type: ${typeof source}`)
}

/**
 * Tessellate a cubic Bézier segment to polyline points.
 * Returns intermediate points only (not p0, which the caller already has).
 *
 * @param {number[]} p0 - start point [x, y]
 * @param {number[]} p1 - control point 1
 * @param {number[]} p2 - control point 2
 * @param {number[]} p3 - end point
 * @param {number} steps - number of subdivisions
 * @returns {number[][]} intermediate + end points
 */
function tessellate3(p0, p1, p2, p3, steps) {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0]
    const y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
    pts.push([x, y])
  }
  return pts
}

/**
 * Tessellate a quadratic Bézier segment to polyline points.
 *
 * @param {number[]} p0 - start point
 * @param {number[]} p1 - control point
 * @param {number[]} p2 - end point
 * @param {number} steps
 * @returns {number[][]}
 */
function tessellate2(p0, p1, p2, steps) {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const x = u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0]
    const y = u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1]
    pts.push([x, y])
  }
  return pts
}

/**
 * Convert an opentype.js glyph path to an array of contours (closed polylines).
 * Each contour is an array of [x, y] points.
 *
 * @param {import('opentype.js').Path} path - opentype.js glyph path
 * @param {number} steps - Bézier tessellation steps
 * @param {number} scale - scale factor (size / unitsPerEm)
 * @returns {Array<Array<[number, number]>>} array of contours
 */
function pathToContours(path, steps, scale) {
  const contours = []
  let current = null
  let startX = 0, startY = 0

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        if (current && current.length > 1) contours.push(current)
        current = [[cmd.x * scale, cmd.y * scale]]
        startX = cmd.x; startY = cmd.y
        break

      case 'L':
        current?.push([cmd.x * scale, cmd.y * scale])
        break

      case 'Q': {
        const prev = current?.[current.length - 1] || [0, 0]
        const pts = tessellate2(
          [prev[0] / scale, prev[1] / scale],
          [cmd.x1, cmd.y1],
          [cmd.x, cmd.y],
          steps
        )
        for (const pt of pts) current?.push([pt[0] * scale, pt[1] * scale])
        break
      }

      case 'C': {
        const prev = current?.[current.length - 1] || [0, 0]
        const pts = tessellate3(
          [prev[0] / scale, prev[1] / scale],
          [cmd.x1, cmd.y1],
          [cmd.x2, cmd.y2],
          [cmd.x, cmd.y],
          steps
        )
        for (const pt of pts) current?.push([pt[0] * scale, pt[1] * scale])
        break
      }

      case 'Z':
        if (current && current.length > 1) {
          // Ensure closed (opentype.js may not repeat first point)
          const first = current[0]
          const last = current[current.length - 1]
          if (first[0] !== last[0] || first[1] !== last[1]) {
            current.push([startX * scale, startY * scale])
          }
          contours.push(current)
        }
        current = null
        break
    }
  }
  if (current && current.length > 1) contours.push(current)

  return contours
}

/**
 * Determine if a contour is clockwise (hole) via the shoelace formula.
 * In OpenType fonts: outer contours are CCW, holes are CW.
 *
 * @param {Array<[number, number]>} pts
 * @returns {boolean} true if the contour winds clockwise (= hole)
 */
export function isClockwise(pts) {
  let sum = 0
  for (let i = 0; i < pts.length - 1; i++) {
    sum += (pts[i + 1][0] - pts[i][0]) * (pts[i + 1][1] + pts[i][1])
  }
  return sum > 0
}

/**
 * A parsed TTF font that can lay out text.
 */
export class TTFFont {
  /** @param {import('opentype.js').Font} otFont */
  constructor(otFont) {
    this._font = otFont
    // Cache parsed glyph contour data keyed by "char:steps"
    this._contourCache = new Map()
  }

  /**
   * Get glyph contours for a single character.
   *
   * @param {string} char
   * @param {number} size - desired output size (cap height in user units)
   * @param {number} steps - Bézier tessellation steps
   * @returns {{ contours: Array<Array<[number,number]>>, advanceWidth: number }}
   */
  getGlyph(char, size, steps) {
    const font = this._font
    const scale = size / font.unitsPerEm
    const key = `${char}:${steps}:${size}`
    if (this._contourCache.has(key)) return this._contourCache.get(key)

    const glyph = font.charToGlyph(char)
    if (!glyph) return { contours: [], advanceWidth: 0 }

    const path = glyph.getPath(0, 0, size)
    const contours = pathToContours(path, steps, 1)  // path already scaled by getPath
    const advanceWidth = (glyph.advanceWidth ?? 0) * scale
    const result = { contours, advanceWidth }
    this._contourCache.set(key, result)
    return result
  }

  /**
   * Lay out text and return per-glyph contour data with x/y positions.
   *
   * @param {string} text
   * @param {object} opts
   * @param {number} opts.size
   * @param {number} [opts.spacing=1] - spacing multiplier
   * @param {string} [opts.halign='left'] - 'left'|'center'|'right'
   * @param {number} [opts.lineSpacing=1.4]
   * @param {number} [opts.$fn=32] - Bézier tessellation quality
   * @returns {{ lines: Array<{contours: Array<{contours, x, y}>, width: number, y: number}>,
   *             totalWidth: number, capHeight: number, descender: number, lineSpacing: number }}
   */
  layoutText(text, { size = 10, spacing = 1, halign = 'left', lineSpacing = 1.4, $fn = 32 } = {}) {
    const font = this._font
    const scale = size / font.unitsPerEm
    const capHeight = (font.tables?.os2?.sCapHeight ?? font.ascender * 0.7) * scale
    const descender = Math.abs(font.descender ?? 0) * scale
    const textLines = text.split('\n')
    const lines = []
    let totalWidth = 0

    for (const lineText of textLines) {
      let x = 0
      const glyphs = []

      for (let ci = 0; ci < lineText.length; ci++) {
        const char = lineText[ci]
        const { contours, advanceWidth } = this.getGlyph(char, size, $fn)

        // Kerning
        let kern = 0
        if (ci > 0) {
          const prevChar = lineText[ci - 1]
          const kv = font.getKerningValue?.(font.charToGlyph(prevChar), font.charToGlyph(char))
          kern = (kv ?? 0) * scale
        }

        glyphs.push({ contours, x: x + kern })
        x += advanceWidth * spacing + kern
      }

      const lineWidth = x
      totalWidth = Math.max(totalWidth, lineWidth)
      lines.push({ glyphs, width: lineWidth })
    }

    // Apply halign
    const alignedLines = lines.map((line, i) => {
      let dx = 0
      if (halign === 'center') dx = -line.width / 2
      else if (halign === 'right') dx = -line.width

      const y = -i * size * lineSpacing
      const positioned = line.glyphs.map(g => ({
        contours: g.contours,
        x: g.x + dx,
        y,
      }))
      return { glyphs: positioned, width: line.width, y }
    })

    return {
      lines: alignedLines,
      totalWidth,
      capHeight,
      descender,
      lineSpacing: size * lineSpacing,
    }
  }
}

/**
 * Font loader with caching. Shared instance per application.
 */
export class TTFLoader {
  constructor() {
    /** @type {Map<string, TTFFont>} */
    this._cache = new Map()
  }

  /**
   * Load a font synchronously.
   *
   * - ArrayBuffer/Uint8Array/Buffer: parsed immediately (always works)
   * - URL in browser Web Worker: sync XMLHttpRequest (works, lazy on first call)
   * - File path in Node.js: opentype.loadSync() → fs.readFileSync()
   * - HTTP URL in Node.js: throws — pre-load with fontLoader.load(url) first
   *
   * @param {string | ArrayBuffer | Buffer | Uint8Array} source
   * @returns {TTFFont}
   */
  loadSync(source) {
    const cacheKey = typeof source === 'string' ? source : null
    if (cacheKey && this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey)
    }

    let otFont
    const bytes = loadFontBytesSync(source)
    if (bytes === null) {
      // Node.js file path: delegate to opentype.loadSync (uses readFileSync internally)
      otFont = opentype.loadSync(source)
    } else {
      otFont = opentype.parse(bytes)
    }

    const font = new TTFFont(otFont)
    if (cacheKey) this._cache.set(cacheKey, font)
    return font
  }

  /**
   * Load a font asynchronously (async I/O: fetch or fs.readFile).
   * Use this to pre-load fonts before synchronous rendering, or for
   * Node.js HTTP URLs which cannot be loaded synchronously.
   *
   * @param {string | ArrayBuffer | Buffer | Uint8Array} source
   * @returns {Promise<TTFFont>}
   */
  async load(source) {
    // Use string sources as cache keys
    const cacheKey = typeof source === 'string' ? source : null
    if (cacheKey && this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey)
    }

    const bytes = await loadFontBytesAsync(source)
    const otFont = opentype.parse(bytes)
    const font = new TTFFont(otFont)

    if (cacheKey) this._cache.set(cacheKey, font)
    return font
  }
}

/** Shared loader instance */
export const defaultLoader = new TTFLoader()
