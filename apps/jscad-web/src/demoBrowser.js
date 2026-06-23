/**
 * demoBrowser - non-modal demo browser side panel.
 *
 * Reads Apache mod_autoindex directory listings to build a navigable hierarchy.
 * Shows one directory level at a time with breadcrumb navigation (walking menu).
 *
 * Directories containing only a single index file (index.js / index.scad) and
 * no subdirectories are treated as leaf items (loaded directly, not navigated into).
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

/** @type {Map<string, {dirs: string[], files: string[]}>} */
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

/** @type {Promise<Record<string,{dirs:string[],files:string[]}>|null>|null} */
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
    const { dirs, files } = await loadDirectory(dirUrl)
    if (dirs.length === 0 && files.length === 1) {
      const f = files[0]
      if (f === 'index.js' || f === 'index.scad') {
        return dirUrl + f
      }
    }
  } catch (_) { /* ignore */ }
  return null
}

// ──────────────────────────────────────────────────────────────────
// Breadcrumb builder
// ──────────────────────────────────────────────────────────────────

/**
 * Given rootUrl and currentUrl, build the breadcrumb DOM.
 * Segments between root and current are clickable links.
 * Final segment is plain text (current location).
 */
function buildBreadcrumb(rootU, currentU) {
  const container = el('div', { className: 'demo-breadcrumb' })

  // Strip rootUrl prefix from currentUrl to get relative path segments
  const rel = currentU.startsWith(rootU) ? currentU.slice(rootU.length) : currentU
  const parts = rel ? rel.replace(/\/$/, '').split('/') : []

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
  parts.forEach((part, i) => {
    container.appendChild(el('span', { className: 'demo-crumb-sep' }, '›'))
    const segUrl = rootU + parts.slice(0, i + 1).join('/') + '/'
    if (i === parts.length - 1) {
      // Current (final) segment - plain text
      container.appendChild(el('span', { className: 'demo-crumb-current' }, part + '/'))
    } else {
      const crumb = el('button', {
        className: 'demo-crumb',
        title: segUrl,
        onclick: () => navigate(segUrl),
      }, part + '/')
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
async function navigate(dirUrl) {
  if (!panel) return
  currentUrl = dirUrl

  // Update breadcrumb
  const oldCrumb = panel.querySelector('.demo-breadcrumb')
  const newCrumb = buildBreadcrumb(rootUrl, currentUrl)
  if (oldCrumb) oldCrumb.replaceWith(newCrumb)

  const content = panel.querySelector('.demo-content')
  content.innerHTML = ''
  content.appendChild(el('div', { className: 'demo-loading' }, 'Loading…'))

  try {
    const { dirs, files } = await loadDirectory(dirUrl)
    if (!panel) return
    content.innerHTML = ''

    // Pre-check which dirs are index-only (in parallel)
    const dirIndexUrls = await Promise.all(
      dirs.map(d => getIndexOnlyUrl(dirUrl + d + '/'))
    )
    if (!panel) return

    const indexOnlyDirs = new Set()
    const indexOnlyFileUrls = {}
    dirs.forEach((d, i) => {
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
      ...files.map(f => ({ name: f, url: dirUrl + f, isLeafDir: false })),
    ].sort((a, b) => a.name.localeCompare(b.name))

    // Removed dynamic ALL button – use on-disk ALL.js files instead

    // Regular directory entries (navigable)
    if (regularDirs.length > 0) {
      if (allFiles.length > 0) content.appendChild(el('hr', { className: 'demo-divider' }))
      for (const d of regularDirs) {
        const subUrl = dirUrl + d + '/'
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
  fileCallback = async (fileUrl) => {
    try {
      const res = await fetch(fileUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const script = await res.text()
      onLoad(script, fileUrl)
    } catch (err) {
      console.error('demoBrowser: failed to load file', fileUrl, err)
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

  const breadcrumb = buildBreadcrumb(rootUrl, currentUrl)
  const content = el('div', { className: 'demo-content' })

  panel.appendChild(header)
  panel.appendChild(breadcrumb)
  panel.appendChild(content)
  document.body.appendChild(panel)

  document.addEventListener('keydown', onKey)

  // Load root directory
  navigate(rootUrl)
}
