/**
 * FontMap - resolve OpenSCAD font names to loadable sources.
 *
 * Priority order for resolving a font name:
 *   1. Static CDN map (bundled, always available)
 *   2. System fonts discovered via Local Font Access API (Chrome) or fc-list (Node.js)
 *
 * Usage:
 *   import { resolveFont, loadSystemFonts } from './FontMap.js'
 *
 *   // Optional: populate system fonts at startup
 *   await loadSystemFonts()
 *
 *   // Resolve by name or pass-through URL
 *   const source = resolveFont('Liberation Sans')   // → file path (Node.js) or CDN URL (browser)
 *   const source = resolveFont('https://...')       // → same URL (pass-through)
 *   // Returns: string URL, string file path, or FontData (Local Font Access)
 *
 * Font name format follows OpenSCAD convention:
 *   "Family Name"               - regular weight
 *   "Family Name:style=Bold"    - with style qualifier
 */

/**
 * In Node.js, Liberation Sans is resolved from the bundled TTF (same font OpenSCAD ships).
 * In browser, the actual Liberation Sans is fetched from jsDelivr (sync XHR in Web Workers).
 *
 * We use import.meta.url + URL constructor to build the absolute path portably.
 * In browser, XMLHttpRequest is defined (even in Web Workers); in Node.js it is not.
 */
const LIBERATION_SANS_SOURCE =
  typeof XMLHttpRequest !== 'undefined'
    // Browser (Web Worker): actual Liberation Sans via jsDelivr npm CDN
    ? 'https://cdn.jsdelivr.net/npm/@typopro/dtp-liberation@3.7.5/TypoPRO-LiberationSans-Regular.ttf'
    // Node.js: use the bundled Liberation Sans that OpenSCAD ships (file:// URL → path)
    : new URL('./data/LiberationSans-Regular.ttf', import.meta.url).pathname

/**
 * jsDelivr npm CDN for the actual Liberation fonts (not substitutes).
 * @typopro/dtp-liberation bundles the Liberation font family as TTF files.
 * These are the same fonts OpenSCAD ships, ensuring geometry compatibility.
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@typopro/dtp-liberation@3.7.5/TypoPRO'

/**
 * jsDelivr GitHub CDN for Google Fonts repository.
 */
const BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main'

export const STATIC_FONT_MAP = {
  // ── OpenSCAD standard fonts (bundled in every OpenSCAD installation) ──────
  //
  // Liberation Sans — OpenSCAD's default font (font="" or font="Liberation Sans")
  // Node.js: bundled LiberationSans-Regular.ttf (exact OpenSCAD file)
  // Browser: actual Liberation Sans via jsDelivr
  'Liberation Sans':                   LIBERATION_SANS_SOURCE,
  'Liberation Sans:style=Bold':        `${LIB}-LiberationSans-Bold.ttf`,
  'Liberation Sans:style=Italic':      `${LIB}-LiberationSans-Italic.ttf`,
  'Liberation Sans:style=Bold Italic': `${LIB}-LiberationSans-BoldItalic.ttf`,

  // Liberation Serif
  'Liberation Serif':                   `${LIB}-LiberationSerif-Regular.ttf`,
  'Liberation Serif:style=Bold':        `${LIB}-LiberationSerif-Bold.ttf`,
  'Liberation Serif:style=Italic':      `${LIB}-LiberationSerif-Italic.ttf`,
  'Liberation Serif:style=Bold Italic': `${LIB}-LiberationSerif-BoldItalic.ttf`,

  // Liberation Mono
  'Liberation Mono':                   `${LIB}-LiberationMono-Regular.ttf`,
  'Liberation Mono:style=Bold':        `${LIB}-LiberationMono-Bold.ttf`,
  'Liberation Mono:style=Italic':      `${LIB}-LiberationMono-Italic.ttf`,
  'Liberation Mono:style=Bold Italic': `${LIB}-LiberationMono-BoldItalic.ttf`,

  // Generic font family aliases — OpenSCAD's fontconfig maps these to Liberation
  'sans-serif':                   LIBERATION_SANS_SOURCE,
  'sans-serif:style=Bold':        `${LIB}-LiberationSans-Bold.ttf`,
  'sans-serif:style=Italic':      `${LIB}-LiberationSans-Italic.ttf`,
  'sans-serif:style=Bold Italic': `${LIB}-LiberationSans-BoldItalic.ttf`,
  'serif':                   `${LIB}-LiberationSerif-Regular.ttf`,
  'serif:style=Bold':        `${LIB}-LiberationSerif-Bold.ttf`,
  'serif:style=Italic':      `${LIB}-LiberationSerif-Italic.ttf`,
  'serif:style=Bold Italic': `${LIB}-LiberationSerif-BoldItalic.ttf`,
  'monospace':                   `${LIB}-LiberationMono-Regular.ttf`,
  'monospace:style=Bold':        `${LIB}-LiberationMono-Bold.ttf`,
  'monospace:style=Italic':      `${LIB}-LiberationMono-Italic.ttf`,
  'monospace:style=Bold Italic': `${LIB}-LiberationMono-BoldItalic.ttf`,

  // ── Noto Sans — common on Linux systems with OpenSCAD ────────────────────
  'Noto Sans':                   `${BASE}/ofl/notosans/NotoSans-Regular.ttf`,
  'Noto Sans:style=Bold':        `${BASE}/ofl/notosans/NotoSans-Bold.ttf`,
  'Noto Sans:style=Italic':      `${BASE}/ofl/notosans/NotoSans-Italic.ttf`,
  'Noto Sans:style=Bold Italic': `${BASE}/ofl/notosans/NotoSans-BoldItalic.ttf`,

  // Common Google Fonts
  'Roboto':              `${BASE}/apache/roboto/static/Roboto-Regular.ttf`,
  'Roboto:style=Bold':   `${BASE}/apache/roboto/static/Roboto-Bold.ttf`,
  'Roboto:style=Italic': `${BASE}/apache/roboto/static/Roboto-Italic.ttf`,

  'Open Sans':              `${BASE}/apache/opensans/static/OpenSans-Regular.ttf`,
  'Open Sans:style=Bold':   `${BASE}/apache/opensans/static/OpenSans-Bold.ttf`,
  'Open Sans:style=Italic': `${BASE}/apache/opensans/static/OpenSans-Italic.ttf`,

  'Lato':              `${BASE}/ofl/lato/Lato-Regular.ttf`,
  'Lato:style=Bold':   `${BASE}/ofl/lato/Lato-Bold.ttf`,
  'Lato:style=Italic': `${BASE}/ofl/lato/Lato-Italic.ttf`,

  'Montserrat':              `${BASE}/ofl/montserrat/static/Montserrat-Regular.ttf`,
  'Montserrat:style=Bold':   `${BASE}/ofl/montserrat/static/Montserrat-Bold.ttf`,
  'Montserrat:style=Italic': `${BASE}/ofl/montserrat/static/Montserrat-Italic.ttf`,

  'Oswald':              `${BASE}/ofl/oswald/static/Oswald-Regular.ttf`,
  'Oswald:style=Bold':   `${BASE}/ofl/oswald/static/Oswald-Bold.ttf`,

  'Source Code Pro':            `${BASE}/ofl/sourcecodepro/static/SourceCodePro-Regular.ttf`,
  'Source Code Pro:style=Bold': `${BASE}/ofl/sourcecodepro/static/SourceCodePro-Bold.ttf`,

  'Ubuntu':              `${BASE}/ufl/ubuntu/Ubuntu-R.ttf`,
  'Ubuntu:style=Bold':   `${BASE}/ufl/ubuntu/Ubuntu-B.ttf`,
  'Ubuntu:style=Italic': `${BASE}/ufl/ubuntu/Ubuntu-RI.ttf`,

  'Inconsolata':            `${BASE}/ofl/inconsolata/static/Inconsolata-Regular.ttf`,
  'Inconsolata:style=Bold': `${BASE}/ofl/inconsolata/static/Inconsolata-Bold.ttf`,
}

/**
 * Runtime map: starts as a copy of STATIC_FONT_MAP, extended by system font discovery.
 *
 * Values are either:
 *   - string: a URL or file path passed to TTFLoader
 *   - FontData: a Local Font Access API FontData object (has .blob() method)
 */
const runtimeMap = new Map(Object.entries(STATIC_FONT_MAP))

/**
 * Node.js font cache: maps CDN URLs to local file paths.
 * Populated by ensureLiberationFonts() from fontCache.js.
 * Allows synchronous TTF loading in Node.js without bundling font files.
 *
 * @type {Map<string, string>}
 */
const nodeFontCache = new Map()

/**
 * Register a local file path as a cached version of a CDN URL.
 * Called by ensureLiberationFonts() after downloading fonts to the local cache.
 *
 * @param {string} url - CDN URL (e.g. "https://cdn.jsdelivr.net/npm/...")
 * @param {string} localPath - local file path (e.g. "/home/user/.cache/jscadui/fonts/...")
 */
export function registerNodeFont(url, localPath) {
  nodeFontCache.set(url, localPath)
}

/**
 * Determine if a string looks like a URL or file path (pass-through, no lookup needed).
 *
 * @param {string} s
 * @returns {boolean}
 */
function isDirectSource(s) {
  return (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('//') ||
    s.startsWith('/') ||
    s.startsWith('./') ||
    s.startsWith('../') ||
    s.startsWith('file://')
  )
}

/**
 * Resolve a font name or URL to a loadable source.
 *
 * @param {string} nameOrUrl - font name (e.g. "Liberation Sans") or direct URL/path
 * @returns {string | object} URL string, file path string, or FontData object
 * @throws {Error} if the name is not found in the map
 */
export function resolveFont(nameOrUrl) {
  if (!nameOrUrl) throw new Error('Font name or URL is required')

  // Pass-through: URLs and file paths are used directly
  if (isDirectSource(nameOrUrl)) {
    // In Node.js, redirect CDN URLs to local cache when available
    if (typeof XMLHttpRequest === 'undefined' && nodeFontCache.has(nameOrUrl)) {
      return nodeFontCache.get(nameOrUrl)
    }
    return nameOrUrl
  }

  // Look up in the combined runtime map
  if (runtimeMap.has(nameOrUrl)) {
    const source = runtimeMap.get(nameOrUrl)
    // In Node.js, redirect CDN URLs to local cache when available
    if (typeof XMLHttpRequest === 'undefined' && typeof source === 'string' && nodeFontCache.has(source)) {
      return nodeFontCache.get(source)
    }
    return source
  }

  // Build a helpful error message
  const available = [...runtimeMap.keys()].filter(k => !k.includes(':')).sort()
  throw new Error(
    `Font "${nameOrUrl}" not found.\n` +
    `Available font families: ${available.join(', ')}\n` +
    `Use loadSystemFonts() to add system-installed fonts, or provide a URL/path directly.`
  )
}

/**
 * Add or override entries in the runtime font map.
 *
 * @param {Record<string, string>} entries - name → URL/path pairs
 */
export function registerFonts(entries) {
  for (const [name, url] of Object.entries(entries)) {
    runtimeMap.set(name, url)
  }
}

/**
 * Get a read-only snapshot of all currently registered font names.
 *
 * @returns {string[]}
 */
export function listFonts() {
  return [...runtimeMap.keys()]
}

// ─── System font discovery ─────────────────────────────────────────────────

let systemFontsLoaded = false

/**
 * Discover and register system-installed fonts.
 *
 * - In Chrome 103+: uses the Local Font Access API (window.queryLocalFonts)
 * - In Node.js: parses output of `fc-list` (fontconfig, Linux/Mac)
 *
 * Safe to call multiple times; only runs once.
 * Does not throw - missing permissions or fc-list are silently ignored.
 *
 * @returns {Promise<number>} number of new font entries added
 */
export async function loadSystemFonts() {
  if (systemFontsLoaded) return 0
  systemFontsLoaded = true

  const before = runtimeMap.size

  if (typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function') {
    await _loadBrowserFonts()
  } else if (typeof process !== 'undefined' && process.versions?.node) {
    await _loadNodeFonts()
  }

  return runtimeMap.size - before
}

/**
 * Load fonts from the Chrome Local Font Access API.
 * Registered fonts are FontData objects; TTFLoader must handle them via .blob().
 */
async function _loadBrowserFonts() {
  try {
    const fonts = await window.queryLocalFonts()
    for (const font of fonts) {
      // font.family, font.style, font.fullName, font.postscriptName
      // .blob() returns the raw font data
      const key = font.family
      const styleKey = font.style && font.style !== 'Regular'
        ? `${font.family}:style=${font.style}`
        : null

      // Only add if not already in map (CDN entries take precedence)
      if (!runtimeMap.has(key)) runtimeMap.set(key, font)
      if (styleKey && !runtimeMap.has(styleKey)) runtimeMap.set(styleKey, font)

      // Also register by fullName for exact matching
      if (font.fullName && !runtimeMap.has(font.fullName)) {
        runtimeMap.set(font.fullName, font)
      }
    }
  } catch {
    // Permission denied or API unavailable - silently ignore
  }
}

/**
 * Load fonts from `fc-list` on Linux/Mac (Node.js only).
 * Registered fonts are file:// URLs pointing to the font files.
 */
async function _loadNodeFonts() {
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    // fc-list format: "Family Name:style=Style\t/path/to/font.ttf"
    const { stdout } = await execAsync(
      'fc-list --format "%{family}:%{style}\\t%{file}\\n"',
      { timeout: 5000 }
    )

    for (const line of stdout.split('\n')) {
      const tabIdx = line.indexOf('\t')
      if (tabIdx < 0) continue
      const nameStyle = line.slice(0, tabIdx).trim()
      const file = line.slice(tabIdx + 1).trim()
      if (!file) continue

      // fc-list may return comma-separated family names for multi-family fonts
      const [rawFamily, rawStyle] = nameStyle.split(':')
      const families = rawFamily.split(',').map(f => f.trim()).filter(Boolean)
      const style = rawStyle?.replace(/^style=/, '').trim() || 'Regular'

      const fileUrl = file.startsWith('/') ? `file://${file}` : file

      for (const family of families) {
        // Bare family → first encountered style (typically Regular wins due to sort order)
        if (!runtimeMap.has(family)) runtimeMap.set(family, fileUrl)

        // Qualified key e.g. "DejaVu Sans:style=Bold"
        if (style !== 'Regular') {
          const styleKey = `${family}:style=${style}`
          if (!runtimeMap.has(styleKey)) runtimeMap.set(styleKey, fileUrl)
        }
      }
    }
  } catch {
    // fc-list not installed or failed - silently ignore
  }
}
