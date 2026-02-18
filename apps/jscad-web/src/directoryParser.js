/**
 * directoryParser - fetch and parse Apache mod_autoindex directory listings.
 *
 * Apache autoindex produces HTML with predictable <a href> link patterns.
 * We parse those to build a list of directories and files, filtering to
 * only the file types we can execute (.js, .scad).
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

  const dirs = []
  const files = []

  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')

    // Skip navigation links, query-string sort links, and absolute paths
    if (!href || href === '../' || href.startsWith('?') || href.startsWith('/') || href.includes('://')) continue

    // Decode percent-encoded names (Apache may encode spaces etc.)
    const name = decodeURIComponent(href)

    if (name.endsWith('/')) {
      dirs.push(name.slice(0, -1))
    } else if (isExecutable(name)) {
      files.push(name)
    }
  }

  return { dirs, files }
}
