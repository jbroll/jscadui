/**
 * demoBrowser - non-modal demo browser side panel.
 *
 * Reads Apache mod_autoindex directory listings to build a navigable hierarchy.
 * Shows one directory level at a time with breadcrumb navigation (walking menu).
 *
 * Directories containing only a single index file (index.js / index.scad) and
 * no subdirectories are treated as leaf items (loaded directly, not navigated into).
 *
 * A directory with no files and exactly one subdirectory is passed through:
 * the menu opens the subdirectory instead and the breadcrumb folds the two
 * into one crumb. A manifest entry may carry `href` (file name → URL relative
 * to the directory) for files that live elsewhere, as in category folders.
 *
 * Interactions:
 *   Click file        → call loadFile(url), panel stays open
 *   Click dir         → navigate into directory (drill-down)
 *   Click breadcrumb  → navigate back to that level
 *   Click ×           → close panel
 *   Escape            → close panel
 *   Browse Demos (2nd click) → toggle close
 */

import { fetchDirectoryListing } from './directoryParser.js'

// ──────────────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────────────

export const demoBrowserStyles = `
.demo-panel {
  position: fixed;
  top: 44px;
  left: 10px;
  z-index: 2500;
  background: #f8f8f8;
  color: #111;
  border: 1px solid #888;
  box-shadow: 2px 4px 12px rgba(0,0,0,.25);
  width: 280px;
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  font-family: inherit;
  font-size: 14px;
  border-radius: 0 4px 4px 0;
}
.dark .demo-panel {
  background: #444;
  color: #ddd;
  border-color: #555;
  box-shadow: 2px 4px 12px rgba(0,0,0,.5);
}

.demo-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid #888;
  flex-shrink: 0;
}
.dark .demo-panel-header { border-bottom-color: #555; }

.demo-panel-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.demo-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  padding: 1px 5px;
  border-radius: 3px;
  opacity: .7;
}
.demo-close-btn:hover { opacity: 1; background: rgba(128,128,128,.15); }

/* ── breadcrumb ── */
.demo-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: 4px 10px;
  border-bottom: 1px solid #ddd;
  font-size: 12px;
  flex-shrink: 0;
  min-height: 26px;
  gap: 1px;
}
.dark .demo-breadcrumb { border-bottom-color: #555; }

.demo-crumb {
  background: none;
  border: none;
  cursor: pointer;
  color: #08d;
  padding: 1px 3px;
  border-radius: 3px;
  font-size: 12px;
  font: inherit;
  white-space: nowrap;
}
.demo-crumb:hover { text-decoration: underline; }
.dark .demo-crumb { color: #4af; }

.demo-crumb-current {
  padding: 1px 3px;
  font-size: 12px;
  opacity: .7;
  white-space: nowrap;
}

.demo-crumb-sep {
  opacity: .4;
  font-size: 11px;
  flex-shrink: 0;
}

/* ── content list ── */
.demo-content {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.demo-nav-dir,
.demo-nav-file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 4px 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.demo-nav-dir:hover,
.demo-nav-file:hover { background: rgba(128,128,128,.12); }

.demo-nav-dir::before { content: '▶'; font-size: 10px; opacity: .55; flex-shrink: 0; }
.demo-nav-dir { font-weight: 500; }

/* ── ALL entry ── */
.demo-all-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: #08d;
  font: inherit;
  text-align: left;
  padding: 4px 12px;
  font-weight: 600;
  font-size: 13px;
}
.demo-all-btn:hover { background: rgba(128,128,128,.12); }
.dark .demo-all-btn { color: #4af; }

.demo-divider {
  border: none;
  border-top: 1px solid #ddd;
  margin: 4px 0;
}
.dark .demo-divider { border-top-color: #555; }

.demo-loading {
  padding: 8px 12px;
  opacity: .6;
  font-style: italic;
  font-size: 12px;
}

.demo-error {
  padding: 8px 12px;
  color: #c00;
  font-size: 12px;
}
.dark .demo-error { color: #f88; }
`

// ──────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────

/** @typedef {{dirs: string[], files: string[], href?: Record<string,string>}} Listing */

/** @type {Map<string, Listing>} */
const listingCache = new Map()

/** @type {HTMLElement|null} */
let panel = null

/** @type {string} */
let rootUrl = ''

/** @type {string} */
let currentUrl = ''

/** @type {(url:string)=>void} */
let fileCallback = null


// ──────────────────────────────────────────────────────────────────
// Directory listing (with cache)
// ──────────────────────────────────────────────────────────────────

/** @type {Promise<Record<string,Listing>|null>|null} */
let manifestPromise = null

// Prefer the static manifest.json (works on any host); fall back to a live
// directory listing (dev servers with autoindex). Prod Apache has autoindex
// off, so the manifest is what makes Browse Demos work there.
function getManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(rootUrl + 'manifest.json')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return manifestPromise
}

async function loadDirectory(url) {
  if (listingCache.has(url)) return listingCache.get(url)
  const manifest = await getManifest()
  let result
  if (manifest) {
    result = manifest[new URL(url, location.href).pathname] || { dirs: [], files: [] }
  } else {
    result = await fetchDirectoryListing(url)
  }
  listingCache.set(url, result)
  return result
}

const fileUrl = (dirUrl, { href }, name) =>
  href?.[name] ? new URL(href[name], dirUrl).href : dirUrl + name

const isPassThrough = ({ dirs, files }) => files.length === 0 && dirs.length === 1

/** The first directory at or below dirUrl that is not a pass-through. */
async function skipPassThrough(dirUrl) {
  for (;;) {
    let listing
    try {
      listing = await loadDirectory(dirUrl)
    } catch {
      return dirUrl
    }
    if (!isPassThrough(listing)) return dirUrl
    dirUrl += listing.dirs[0] + '/'
  }
}

// ──────────────────────────────────────────────────────────────────
// DOM helpers
// ──────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'className') e.className = v
    else e.setAttribute(k, v)
  }
  for (const child of children) {
    if (child == null) continue
    e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return e
}

// ──────────────────────────────────────────────────────────────────
// Index-only directory detection
// ──────────────────────────────────────────────────────────────────

/**
 * Returns the index file URL if the directory is index-only, else null.
 * Index-only = no subdirs, exactly one file named index.js or index.scad.
 *
 * @param {string} dirUrl
 * @returns {Promise<string|null>}
 */
async function getIndexOnlyUrl(dirUrl) {
  try {
    const listing = await loadDirectory(dirUrl)
    const { dirs, files } = listing
    if (dirs.length === 0 && files.length === 1) {
      const f = files[0]
      if (f === 'index.js' || f === 'index.scad') {
        return fileUrl(dirUrl, listing, f)
      }
    }
  } catch (_) { /* ignore */ }
  return null
}

// ──────────────────────────────────────────────────────────────────
// Breadcrumb builder
// ──────────────────────────────────────────────────────────────────

/**
 * Crumbs from root to currentU, each { label, url }. A pass-through directory
 * gets no crumb of its own; its name leads the label of the crumb it opens.
 */
async function crumbSegments(rootU, currentU) {
  const rel = currentU.startsWith(rootU) ? currentU.slice(rootU.length) : currentU
  const names = rel ? rel.replace(/\/$/, '').split('/') : []
  const segments = []
  let label = ''
  let url = rootU
  for (const [i, name] of names.entries()) {
    url += name + '/'
    label += name + '/'
    const last = i === names.length - 1
    if (!last && isPassThrough(await loadDirectory(url).catch(() => ({ dirs: [], files: [] })))) continue
    segments.push({ label, url })
    label = ''
  }
  return segments
}

/**
 * Build the breadcrumb DOM from crumbSegments.
 * Segments between root and current are clickable links.
 * Final segment is plain text (current location).
 */
function buildBreadcrumb(rootU, parts) {
  const container = el('div', { className: 'demo-breadcrumb' })

  // Root crumb
  const rootLabel = rootU.replace(/\/$/, '').split('/').pop() || 'examples'
  if (parts.length === 0) {
    // we are at root - show as plain text
    container.appendChild(el('span', { className: 'demo-crumb-current' }, rootLabel + '/'))
  } else {
    const rootCrumb = el('button', {
      className: 'demo-crumb',
      title: rootU,
      onclick: () => navigate(rootU),
    }, rootLabel + '/')
    container.appendChild(rootCrumb)
  }

  // Intermediate + final segments
  parts.forEach(({ label, url }, i) => {
    container.appendChild(el('span', { className: 'demo-crumb-sep' }, '›'))
    if (i === parts.length - 1) {
      // Current (final) segment - plain text
      container.appendChild(el('span', { className: 'demo-crumb-current' }, label))
    } else {
      const crumb = el('button', {
        className: 'demo-crumb',
        title: url,
        onclick: () => navigate(url),
      }, label)
      container.appendChild(crumb)
    }
  })

  return container
}

// ──────────────────────────────────────────────────────────────────
// Content renderer
// ──────────────────────────────────────────────────────────────────

/**
 * Navigate to dirUrl: fetch contents and update panel content area + breadcrumb.
 */
async function navigate(requestedUrl) {
  if (!panel) return
  currentUrl = requestedUrl

  const content = panel.querySelector('.demo-content')
  content.innerHTML = ''
  content.appendChild(el('div', { className: 'demo-loading' }, 'Loading…'))

  const dirUrl = await skipPassThrough(requestedUrl)
  const segments = await crumbSegments(rootUrl, dirUrl)
  // A click made while this one was loading wins
  if (!panel || currentUrl !== requestedUrl) return
  currentUrl = dirUrl
  panel.querySelector('.demo-breadcrumb').replaceWith(buildBreadcrumb(rootUrl, segments))

  try {
    const listing = await loadDirectory(dirUrl)
    const { dirs, files } = listing

    // Resolve each subdir's pass-through chain and index-only check (in parallel)
    const targets = await Promise.all(dirs.map(d => skipPassThrough(dirUrl + d + '/')))
    const dirIndexUrls = await Promise.all(targets.map(getIndexOnlyUrl))
    if (!panel || currentUrl !== dirUrl) return
    content.innerHTML = ''

    const indexOnlyDirs = new Set()
    const indexOnlyFileUrls = {}
    const dirTargets = {}
    dirs.forEach((d, i) => {
      dirTargets[d] = targets[i]
      if (dirIndexUrls[i] != null) {
        indexOnlyDirs.add(d)
        indexOnlyFileUrls[d] = dirIndexUrls[i]
      }
    })

    // Separate regular dirs from index-only dirs
    const regularDirs = dirs.filter(d => !indexOnlyDirs.has(d))
    // index-only dirs rendered as files
    const leafDirs = dirs.filter(d => indexOnlyDirs.has(d))
    // All files (real + leaf dirs treated as files), sorted by name for consistent NN- ordering
    const allFiles = [
      ...leafDirs.map(d => ({ name: d, url: indexOnlyFileUrls[d], isLeafDir: true })),
      ...files.map(f => ({ name: f, url: fileUrl(dirUrl, listing, f), isLeafDir: false })),
    ].sort((a, b) => a.name.localeCompare(b.name))

    // Removed dynamic ALL button – use on-disk ALL.js files instead

    // Regular directory entries (navigable)
    if (regularDirs.length > 0) {
      if (allFiles.length > 0) content.appendChild(el('hr', { className: 'demo-divider' }))
      for (const d of regularDirs) {
        const subUrl = dirTargets[d]
        const btn = el('button', {
          className: 'demo-nav-dir',
          title: subUrl,
          onclick: () => navigate(subUrl),
        }, d + '/')
        content.appendChild(btn)
      }
    }

    // File-like entries (real files + leaf dirs)
    if (allFiles.length > 0) {
      if (regularDirs.length > 0) content.appendChild(el('hr', { className: 'demo-divider' }))
      for (const { name, url, isLeafDir } of allFiles) {
        const displayName = isLeafDir ? name + '/' : name
        const btn = el('button', {
          className: 'demo-nav-file',
          title: url,
          onclick: () => fileCallback(url),
        }, displayName)
        content.appendChild(btn)
      }
    }

    if (regularDirs.length === 0 && allFiles.length === 0) {
      content.appendChild(el('div', { className: 'demo-loading' }, 'No demos found'))
    }
  } catch (err) {
    content.innerHTML = ''
    content.appendChild(el('div', { className: 'demo-error' }, `Error: ${err.message}`))
  }
}

// ──────────────────────────────────────────────────────────────────
// Panel lifecycle
// ──────────────────────────────────────────────────────────────────

function closePanel() {
  if (!panel) return
  panel.remove()
  panel = null
  document.removeEventListener('keydown', onKey)
}

function onKey(e) {
  if (e.key === 'Escape') closePanel()
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

/**
 * Show (or toggle) the demo browser panel.
 *
 * @param {object} opts
 * @param {string}   opts.baseUrl  - Root URL for demos, e.g. '/examples/'
 * @param {(script:string, url:string) => void} opts.onLoad
 *   Called with the script text and URL when a single file is selected.
 */
export function showDemoBrowser({ baseUrl, onLoad }) {
  // Toggle: if already open, close it
  if (panel) {
    closePanel()
    return
  }

  rootUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  currentUrl = rootUrl

  // ── file callback ──
  fileCallback = async (url) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const script = await res.text()
      onLoad(script, url)
    } catch (err) {
      console.error('demoBrowser: failed to load file', url, err)
    }
  }


  // ── build panel ──
  panel = el('div', { className: 'demo-panel' })

  const closeBtn = el('button', { className: 'demo-close-btn', title: 'Close', 'aria-label': 'Close' }, '×')
  closeBtn.addEventListener('click', closePanel)

  const header = el('div', { className: 'demo-panel-header' },
    el('h3', {}, 'Browse Demos'),
    closeBtn,
  )

  const breadcrumb = buildBreadcrumb(rootUrl, [])
  const content = el('div', { className: 'demo-content' })

  panel.appendChild(header)
  panel.appendChild(breadcrumb)
  panel.appendChild(content)
  document.body.appendChild(panel)

  document.addEventListener('keydown', onKey)

  // Load root directory
  navigate(rootUrl)
}
