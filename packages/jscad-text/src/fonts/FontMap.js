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

import { defaultLoader } from './TTFLoader.js'

/**
 * Every CDN URL names an exact version of an npm package (TypoPRO's TTF
 * packages), so the browser fetches pinned files and Node can serve the same
 * files from node_modules (registerInstalledFonts in fontCache.js).
 */
const LIB = 'https://cdn.jsdelivr.net/npm/@typopro/dtp-liberation@3.7.5/TypoPRO'
const typopro = (pkg, file) => `https://cdn.jsdelivr.net/npm/@typopro/dtp-${pkg}@3.7.5/TypoPRO-${file}.ttf`

export const LIBERATION_SANS_URL = `${LIB}-LiberationSans-Regular.ttf`

// Node has no synchronous URL load, so the OpenSCAD copy of the default font ships in data/.
const LIBERATION_SANS_SOURCE =
  typeof XMLHttpRequest !== 'undefined'
    ? LIBERATION_SANS_URL
    : new URL('./data/LiberationSans-Regular.ttf', import.meta.url).pathname

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

  // Common proprietary font aliases — mapped to metric-compatible open equivalents
  // Helvetica/Arial → Liberation Sans (same metrics, ensures correct character spacing)
  'Helvetica':                   LIBERATION_SANS_SOURCE,
  'Helvetica:style=Bold':        `${LIB}-LiberationSans-Bold.ttf`,
  'Helvetica:style=Italic':      `${LIB}-LiberationSans-Italic.ttf`,
  'Helvetica:style=Bold Italic': `${LIB}-LiberationSans-BoldItalic.ttf`,
  'Arial':                       LIBERATION_SANS_SOURCE,
  'Arial:style=Bold':            `${LIB}-LiberationSans-Bold.ttf`,
  'Arial:style=Italic':          `${LIB}-LiberationSans-Italic.ttf`,
  'Arial:style=Bold Italic':     `${LIB}-LiberationSans-BoldItalic.ttf`,
  // Arial Black — heavy-weight sans-serif; OpenSCAD's fontconfig on most Linux systems
  // resolves this to Liberation Sans Regular (verified: identical STL output on CI)
  'Arial Black':                 LIBERATION_SANS_SOURCE,
  // Other common Windows sans-serif fonts not present on minimal Linux installs
  'Tahoma':                      LIBERATION_SANS_SOURCE,
  'Tahoma:style=Bold':           `${LIB}-LiberationSans-Bold.ttf`,
  'Verdana':                     LIBERATION_SANS_SOURCE,
  'Verdana:style=Bold':          `${LIB}-LiberationSans-Bold.ttf`,
  'Verdana:style=Italic':        `${LIB}-LiberationSans-Italic.ttf`,
  'Trebuchet MS':                LIBERATION_SANS_SOURCE,
  'Trebuchet MS:style=Bold':     `${LIB}-LiberationSans-Bold.ttf`,
  'Trebuchet MS:style=Italic':   `${LIB}-LiberationSans-Italic.ttf`,
  'Calibri':                     LIBERATION_SANS_SOURCE,
  'Calibri:style=Bold':          `${LIB}-LiberationSans-Bold.ttf`,
  'Calibri:style=Italic':        `${LIB}-LiberationSans-Italic.ttf`,
  'Impact':                      `${LIB}-LiberationSans-Bold.ttf`,
  // Windows serif fonts → Liberation Serif
  'Georgia':                     `${LIB}-LiberationSerif-Regular.ttf`,
  'Georgia:style=Bold':          `${LIB}-LiberationSerif-Bold.ttf`,
  'Georgia:style=Italic':        `${LIB}-LiberationSerif-Italic.ttf`,
  'Palatino Linotype':           `${LIB}-LiberationSerif-Regular.ttf`,
  'Palatino Linotype:style=Bold': `${LIB}-LiberationSerif-Bold.ttf`,
  'Times New Roman':                 `${LIB}-LiberationSerif-Regular.ttf`,
  'Times New Roman:style=Bold':      `${LIB}-LiberationSerif-Bold.ttf`,
  'Times New Roman:style=Italic':    `${LIB}-LiberationSerif-Italic.ttf`,
  'Times New Roman:style=Bold Italic': `${LIB}-LiberationSerif-BoldItalic.ttf`,
  'Times':                       `${LIB}-LiberationSerif-Regular.ttf`,
  'Times:style=Bold':            `${LIB}-LiberationSerif-Bold.ttf`,
  'Times:style=Italic':          `${LIB}-LiberationSerif-Italic.ttf`,
  'Times:style=Bold Italic':     `${LIB}-LiberationSerif-BoldItalic.ttf`,
  'Courier':                     `${LIB}-LiberationMono-Regular.ttf`,
  'Courier:style=Bold':          `${LIB}-LiberationMono-Bold.ttf`,
  'Courier:style=Italic':        `${LIB}-LiberationMono-Italic.ttf`,
  'Courier:style=Bold Italic':   `${LIB}-LiberationMono-BoldItalic.ttf`,
  'Courier New':                 `${LIB}-LiberationMono-Regular.ttf`,
  'Courier New:style=Bold':      `${LIB}-LiberationMono-Bold.ttf`,
  'Courier New:style=Italic':    `${LIB}-LiberationMono-Italic.ttf`,
  'Courier New:style=Bold Italic': `${LIB}-LiberationMono-BoldItalic.ttf`,

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
  'Noto Sans':                   typopro('noto', 'NotoSans-Regular'),
  'Noto Sans:style=Bold':        typopro('noto', 'NotoSans-Bold'),
  'Noto Sans:style=Italic':      typopro('noto', 'NotoSans-Italic'),
  'Noto Sans:style=Bold Italic': typopro('noto', 'NotoSans-BoldItalic'),

  // Common Google Fonts
  'Roboto':              typopro('roboto', 'Roboto-Regular'),
  'Roboto:style=Bold':   typopro('roboto', 'Roboto-Bold'),
  'Roboto:style=Italic': typopro('roboto', 'Roboto-Italic'),

  'Open Sans':              typopro('open-sans', 'OpenSans-Regular'),
  'Open Sans:style=Bold':   typopro('open-sans', 'OpenSans-Bold'),
  'Open Sans:style=Italic': typopro('open-sans', 'OpenSans-Italic'),

  'Lato':              typopro('lato', 'Lato-Regular'),
  'Lato:style=Bold':   typopro('lato', 'Lato-Bold'),
  'Lato:style=Italic': typopro('lato', 'Lato-Italic'),

  'Montserrat':              typopro('montserrat', 'Montserrat-Regular'),
  'Montserrat:style=Bold':   typopro('montserrat', 'Montserrat-Bold'),
  'Montserrat:style=Italic': typopro('montserrat', 'Montserrat-Italic'),

  'Oswald':              typopro('oswald', 'Oswald-Regular'),
  'Oswald:style=Bold':   typopro('oswald', 'Oswald-Bold'),

  'Source Code Pro':            typopro('source-code-pro', 'SourceCodePro-Regular'),
  'Source Code Pro:style=Bold': typopro('source-code-pro', 'SourceCodePro-Bold'),

  'Ubuntu':              typopro('ubuntu', 'Ubuntu-Regular'),
  'Ubuntu:style=Bold':   typopro('ubuntu', 'Ubuntu-Bold'),
  'Ubuntu:style=Italic': typopro('ubuntu', 'Ubuntu-Italic'),

  'Inconsolata':            typopro('inconsolata', 'Inconsolata-Regular'),
  'Inconsolata:style=Bold': typopro('inconsolata', 'Inconsolata-Bold'),
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
 * Populated by ensureLiberationFonts() or registerInstalledFonts() from fontCache.js.
 * Allows synchronous TTF loading in Node.js without bundling font files.
 *
 * @type {Map<string, string>}
 */
const nodeFontCache = new Map()

/**
 * Register a local file path as a cached version of a CDN URL.
 * Called by fontCache.js once it has a local copy of the URL's file.
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

  // Look up in the combined runtime map (static entries + system fonts from loadSystemFonts)
  if (runtimeMap.has(nameOrUrl)) {
    const source = runtimeMap.get(nameOrUrl)
    // In Node.js, redirect CDN URLs to local cache when available
    if (typeof XMLHttpRequest === 'undefined' && typeof source === 'string' && nodeFontCache.has(source)) {
      return nodeFontCache.get(source)
    }
    return source
  }

  throw new Error(
    `Font "${nameOrUrl}" not found. Available font families, with their styles ` +
    `(write a style as "Liberation Sans:style=Bold"): ${fontList([...runtimeMap.keys()])}`
  )
}

/**
 * Describe font map names as their families, each with its styles.
 *
 * @param {string[]} names - map keys: `Family` and `Family:style=Style`
 * @returns {string} e.g. `Lato (Bold, Italic), Oswald`
 */
export function fontList(names) {
  const families = new Map()
  for (const name of names) {
    const [family, style] = name.split(':style=')
    if (!families.has(family)) families.set(family, [])
    if (style) families.get(family).push(style)
  }
  return [...families.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((family) => (families.get(family).length ? `${family} (${families.get(family).join(', ')})` : family))
    .join(', ')
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
 * Parse a font file and register it under its own family and style names,
 * replacing any existing entry of the same name. The parsed font is stored
 * in the map, so later text2d calls reuse it without parsing again.
 *
 * @param {Uint8Array | ArrayBuffer} bytes - TTF/OTF file contents
 * @returns {string[]} the registered keys: `Family` and `Family:style=Style`
 */
export function registerFontFile(bytes) {
  const font = defaultLoader.loadSync(bytes)
  const names = font._font.names
  const family = (names.preferredFamily ?? names.fontFamily)?.en
  const style = (names.preferredSubfamily ?? names.fontSubfamily)?.en
  if (!family) throw new Error('registerFontFile: font has no English family name')
  const keys = style ? [family, `${family}:style=${style}`] : [family]
  for (const key of keys) runtimeMap.set(key, font)
  return keys
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
 * Registers all installed system fonts so they are available by family name.
 * Uninstalled font aliases (e.g. "Arial Black") fall through to the static map.
 */
async function _loadNodeFonts() {
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    // Phase 1: enumerate installed fonts via fc-list
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

      // Store bare path (no file:// prefix) — TTFLoader.js uses opentype.loadSync() for paths
      const fontPath = file

      for (const family of families) {
        // Always override static map: fontconfig is the authority in Node.js, matching OpenSCAD.
        runtimeMap.set(family, fontPath)

        // Qualified key e.g. "DejaVu Sans:style=Bold"
        if (style !== 'Regular') {
          const styleKey = `${family}:style=${style}`
          runtimeMap.set(styleKey, fontPath)
        }
      }
    }

  } catch {
    // fc-list not installed or failed - silently ignore
  }
}
