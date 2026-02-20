/**
 * directoryParser - fetch and parse directory listings from static servers.
 *
 * Supports two common href formats:
 *   - Apache mod_autoindex: relative hrefs with trailing slash for dirs
 *     e.g. href="balloons.example.js"  href="bosl/"
 *   - serve-index / live-server: absolute hrefs, dirs without trailing slash
 *     e.g. href="/examples/balloons.example.js"  href="/examples/bosl"
 *
 * Only .js and .scad files are returned; all other extensions are ignored.
 */

const EXECUTABLE_EXTENSIONS = ['.js', '.scad']

/**
 * Return true if a filename has an executable extension.
 * @param {string} name
 * @returns {boolean}
 */
export function isExecutable(name) {
  return EXECUTABLE_EXTENSIONS.some(ext => name.endsWith(ext))
}

/**
 * Fetch and parse an Apache directory listing.
 *
 * @param {string} url - Directory URL (must end with '/')
 * @returns {Promise<{dirs: string[], files: string[]}>}
 *   dirs  - subdirectory names (no trailing slash)
 *   files - executable file names (.js / .scad)
 * @throws if the fetch fails or returns a non-OK status
 */
export async function fetchDirectoryListing(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Directory listing failed: ${res.status} ${url}`)

  const html = await res.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Base path for stripping absolute hrefs (e.g. '/examples/')
  const basePath = new URL(url, location.href).pathname

  const dirs = []
  const files = []

  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')
    if (!href) continue

    // Skip query-string sort links and links to other origins
    if (href.startsWith('?') || href.includes('://')) continue

    // Normalise to a name relative to this directory
    let name
    if (href.startsWith('/')) {
      // Absolute path (serve-index / live-server format)
      if (!href.startsWith(basePath)) continue
      name = decodeURIComponent(href.slice(basePath.length))
    } else {
      // Relative path (Apache mod_autoindex format)
      if (href === '../') continue
      name = decodeURIComponent(href)
    }

    // Apache uses trailing slash for dirs; serve-index does not
    const hasTrailingSlash = name.endsWith('/')
    const clean = hasTrailingSlash ? name.slice(0, -1) : name

    // Skip empty names or names that still contain slashes (nested paths)
    if (!clean || clean.includes('/')) continue

    // Skip library directories (lib) - they're dependencies, not examples
    if (clean === 'lib') continue

    if (hasTrailingSlash) {
      dirs.push(clean)
    } else if (isExecutable(clean)) {
      files.push(clean)
    } else if (!clean.includes('.')) {
      // serve-index: extensionless entries are directories
      dirs.push(clean)
    }
    // Other file types (images, stl, amf, …) are skipped
  }

  return { dirs, files }
}
