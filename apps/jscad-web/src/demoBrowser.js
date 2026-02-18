/**
 * demoBrowser - dynamic demo browser dialog.
 *
 * Reads Apache mod_autoindex directory listings to build a navigable tree.
 * Each directory node lazy-loads its contents on first expand.
 *
 * Tree structure per directory:
 *   [ALL (N files)]   ← only shown when there are immediate file children
 *   ▶ subdir/
 *   ▶ subdir2/
 *   ─────────────────
 *   file1.js
 *   file2.scad
 *
 * Interactions:
 *   Click file        → close dialog, call loadFile(url)
 *   Click [ALL]       → close dialog, call loadAll(fileUrls)
 *   Click dir arrow   → expand/collapse (lazy-fetch on first open)
 *   Click ×           → close dialog
 *   Escape            → close dialog
 */

import { fetchDirectoryListing } from './directoryParser.js'
import { buildAllScript } from './gridLayout.js'

// ──────────────────────────────────────────────────────────────────
// CSS
// ──────────────────────────────────────────────────────────────────

export const demoBrowserStyles = `
.demo-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 5vh;
}

.demo-dialog {
  background: var(--bg, #1e1e2e);
  color: var(--fg, #cdd6f4);
  border: 1px solid var(--border, #45475a);
  border-radius: 8px;
  width: min(520px, 95vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,.4);
  font-family: inherit;
  font-size: 14px;
}

.demo-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #45475a);
  flex-shrink: 0;
}

.demo-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.demo-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: .7;
}
.demo-close-btn:hover { opacity: 1; background: rgba(255,255,255,.1); }

.demo-tree {
  overflow-y: auto;
  flex: 1;
  padding: 8px 0;
}

/* ── directory node ── */
.demo-dir {
  user-select: none;
}

.demo-dir-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 6px;
}
.demo-dir-header:hover { background: rgba(255,255,255,.07); }

.demo-dir-arrow {
  display: inline-block;
  width: 14px;
  text-align: center;
  transition: transform .15s;
  font-size: 11px;
  opacity: .7;
}
.demo-dir.open > .demo-dir-header .demo-dir-arrow { transform: rotate(90deg); }

.demo-dir-name {
  font-weight: 500;
  opacity: .85;
}

/* ── children container ── */
.demo-dir-children {
  padding-left: 18px;
  display: none;
}
.demo-dir.open > .demo-dir-children { display: block; }

/* ── loading spinner ── */
.demo-loading {
  padding: 6px 12px;
  opacity: .5;
  font-style: italic;
  font-size: 12px;
}

/* ── ALL entry ── */
.demo-all-btn {
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
  border-radius: 4px;
  margin: 1px 6px;
  font-weight: 600;
  font-size: 13px;
  color: var(--accent, #89b4fa);
}
.demo-all-btn:hover { background: rgba(137,180,250,.12); }

.demo-divider {
  border: none;
  border-top: 1px solid var(--border, #45475a);
  margin: 4px 12px;
}

/* ── file entry ── */
.demo-file-btn {
  display: block;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 3px 12px;
  border-radius: 4px;
  margin: 1px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.demo-file-btn:hover { background: rgba(255,255,255,.07); }
.demo-file-btn.scad { opacity: .85; }

/* ── error message ── */
.demo-error {
  padding: 12px 16px;
  color: var(--error, #f38ba8);
  font-size: 13px;
}

/* ── status bar ── */
.demo-status {
  padding: 6px 16px;
  font-size: 12px;
  opacity: .6;
  border-top: 1px solid var(--border, #45475a);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`

// ──────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────

/** @type {Map<string, {dirs: string[], files: string[]}>} */
const listingCache = new Map()

// ──────────────────────────────────────────────────────────────────
// Directory listing (with cache)
// ──────────────────────────────────────────────────────────────────

/**
 * @param {string} url - directory URL (e.g. '/examples/')
 */
async function loadDirectory(url) {
  if (listingCache.has(url)) return listingCache.get(url)
  const result = await fetchDirectoryListing(url)
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
// Tree builder
// ──────────────────────────────────────────────────────────────────

/**
 * Build the tree node for one directory.
 *
 * @param {string} dirUrl       - full URL for this directory
 * @param {string} label        - display name
 * @param {(url:string)=>void} onFile   - called when user selects a file
 * @param {(urls:string[])=>void} onAll - called when user selects ALL
 * @param {HTMLElement} statusEl - status bar element for path display
 * @param {boolean} [expanded=false]
 * @returns {HTMLElement}
 */
function buildDirNode(dirUrl, label, onFile, onAll, statusEl, expanded = false) {
  const node = el('div', { className: 'demo-dir' + (expanded ? ' open' : '') })

  const arrow = el('span', { className: 'demo-dir-arrow' }, '▶')
  const nameSpan = el('span', { className: 'demo-dir-name' }, label + '/')

  const header = el('div', { className: 'demo-dir-header' }, arrow, nameSpan)
  const children = el('div', { className: 'demo-dir-children' })
  let loaded = false

  const populate = async () => {
    children.innerHTML = ''
    const loading = el('div', { className: 'demo-loading' }, 'Loading…')
    children.appendChild(loading)

    try {
      const { dirs, files } = await loadDirectory(dirUrl)
      children.innerHTML = ''

      // ALL button – only when there are immediate file children
      if (files.length > 0) {
        const allBtn = el('button', {
          className: 'demo-all-btn',
          title: `Load all ${files.length} file${files.length !== 1 ? 's' : ''} in a grid`,
          onclick: () => {
            const urls = files.map(f => dirUrl + f)
            onAll(urls)
          }
        }, `★ ALL (${files.length} file${files.length !== 1 ? 's' : ''})`)
        children.appendChild(allBtn)
      }

      // Subdirectory nodes (dirs first)
      if (dirs.length > 0) {
        if (files.length > 0) children.appendChild(el('hr', { className: 'demo-divider' }))
        for (const d of dirs) {
          const subUrl = dirUrl + d + '/'
          children.appendChild(buildDirNode(subUrl, d, onFile, onAll, statusEl))
        }
      }

      // File entries
      if (files.length > 0) {
        if (dirs.length > 0) children.appendChild(el('hr', { className: 'demo-divider' }))
        for (const f of files) {
          const fileUrl = dirUrl + f
          const ext = f.endsWith('.scad') ? 'scad' : ''
          const btn = el('button', {
            className: 'demo-file-btn' + (ext ? ' ' + ext : ''),
            title: fileUrl,
            onclick: () => onFile(fileUrl),
          }, f)
          children.appendChild(btn)
        }
      }

      if (dirs.length === 0 && files.length === 0) {
        children.appendChild(el('div', { className: 'demo-loading' }, 'No demos found'))
      }
    } catch (err) {
      children.innerHTML = ''
      children.appendChild(el('div', { className: 'demo-error' }, `Error: ${err.message}`))
    }
  }

  header.addEventListener('click', async () => {
    const opening = !node.classList.contains('open')
    node.classList.toggle('open', opening)
    if (opening && !loaded) {
      loaded = true
      await populate()
    }
    statusEl.textContent = dirUrl
  })

  header.addEventListener('mouseenter', () => { statusEl.textContent = dirUrl })

  node.appendChild(header)
  node.appendChild(children)

  // Auto-expand and load root directory immediately
  if (expanded) {
    loaded = true
    populate()
  }

  return node
}

// ──────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────

/**
 * Show the demo browser dialog.
 *
 * @param {object} opts
 * @param {string}   opts.baseUrl  - Root URL for demos, e.g. '/examples/'
 * @param {(script:string, url:string) => void} opts.onLoad
 *   Called with the script text and URL when a single file is selected.
 * @param {(script:string, url:string) => void} opts.onLoadAll
 *   Called with a combined script and synthetic URL when ALL is selected.
 *   Callers may treat this the same as onLoad.
 */
export function showDemoBrowser({ baseUrl, onLoad, onLoadAll }) {
  // Ensure baseUrl ends with /
  const rootUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'

  const overlay = el('div', { className: 'demo-overlay' })
  const dialog = el('div', { className: 'demo-dialog' })

  // ── header ──
  const closeBtn = el('button', { className: 'demo-close-btn', title: 'Close', 'aria-label': 'Close' }, '×')
  const header = el('div', { className: 'demo-dialog-header' },
    el('h3', {}, 'Browse Demos'),
    closeBtn,
  )

  // ── tree ──
  const tree = el('div', { className: 'demo-tree' })

  // ── status bar ──
  const status = el('div', { className: 'demo-status' }, rootUrl)

  dialog.appendChild(header)
  dialog.appendChild(tree)
  dialog.appendChild(status)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  // ── close logic ──
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey) }

  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  const onKey = (e) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)

  // ── callbacks ──
  const onFile = async (fileUrl) => {
    close()
    try {
      const res = await fetch(fileUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const script = await res.text()
      onLoad(script, fileUrl)
    } catch (err) {
      console.error('demoBrowser: failed to load file', fileUrl, err)
    }
  }

  const onAll = async (fileUrls) => {
    close()
    // Fetch each file to warm the browser cache, then build combined script
    // The combined script uses require() which also fetches from cache
    const script = buildAllScript(fileUrls)
    const syntheticUrl = rootUrl + '__all__.js'
    onLoadAll(script, syntheticUrl)
  }

  // ── build initial tree ──
  const rootNode = buildDirNode(rootUrl, rootUrl.replace(/\/$/, '').split('/').pop() || 'examples', onFile, onAll, status, /* expanded= */ true)
  tree.appendChild(rootNode)
}
