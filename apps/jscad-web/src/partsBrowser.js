import { escapeCloses } from './panelEscape.js'
import { planInsert } from './partsInsert.js'

export const partsBrowserStyles = `
.parts-panel {
  position: fixed;
  top: 44px;
  left: 300px;
  z-index: 2500;
  background: #f8f8f8;
  color: #111;
  border: 1px solid #888;
  box-shadow: 2px 4px 12px rgba(0,0,0,.25);
  width: 320px;
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  font-family: inherit;
  font-size: 14px;
  border-radius: 0 4px 4px 0;
}
.parts-panel:focus { outline: none; }
.dark .parts-panel {
  background: #444;
  color: #ddd;
  border-color: #555;
  box-shadow: 2px 4px 12px rgba(0,0,0,.5);
}

.parts-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid #888;
  flex-shrink: 0;
}
.dark .parts-panel-header { border-bottom-color: #555; }

.parts-panel-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.parts-close-btn {
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
.parts-close-btn:hover { opacity: 1; background: rgba(128,128,128,.15); }

.parts-content {
  overflow-y: auto;
  flex: 1;
  padding: 6px 0;
}

.parts-loading,
.parts-error {
  padding: 8px 12px;
  font-size: 12px;
}
.parts-error { color: #c00; }
.dark .parts-error { color: #f88; }

/* ── family list ── */
.parts-family-card {
  padding: 6px 10px 10px;
  border-bottom: 1px solid #ddd;
}
.dark .parts-family-card { border-bottom-color: #555; }

.parts-family-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.parts-thumb {
  width: 40px;
  height: 40px;
  object-fit: contain;
  background: rgba(128,128,128,.1);
  border-radius: 3px;
  flex-shrink: 0;
}

.parts-family-name {
  font-weight: 600;
  font-size: 13px;
  text-transform: capitalize;
}

.parts-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 4px 8px;
  border-radius: 3px;
}
.parts-entry:hover { background: rgba(128,128,128,.12); }

.parts-license {
  font-size: 11px;
  opacity: .7;
  white-space: nowrap;
}

/* ── entry detail ── */
.parts-entry-view { padding: 8px 10px; }

.parts-back {
  background: none;
  border: none;
  cursor: pointer;
  color: #08d;
  font: inherit;
  padding: 2px 0;
  margin-bottom: 6px;
}
.dark .parts-back { color: #4af; }

.parts-summary { margin: 4px 0; }

.parts-signature {
  font-family: monospace;
  font-size: 12px;
  margin: 4px 0;
}

.parts-field-label {
  font-weight: 600;
  font-size: 12px;
  margin-top: 8px;
}

.parts-size-select { font: inherit; margin: 2px 0 8px; width: 100%; }

.parts-options,
.parts-measured {
  margin: 2px 0 8px;
  padding-left: 18px;
  font-size: 12px;
}

.parts-entry-license { font-size: 12px; opacity: .8; margin: 4px 0; }

.parts-example {
  background: rgba(128,128,128,.12);
  padding: 6px 8px;
  border-radius: 3px;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.parts-insert {
  margin-top: 10px;
  padding: 6px 12px;
  cursor: pointer;
  font: inherit;
  border: 1px solid #888;
  border-radius: 3px;
  background: #08d;
  color: #fff;
}
.parts-insert:hover { opacity: .9; }
.parts-insert:disabled { cursor: default; opacity: .5; }
.dark .parts-insert { border-color: #555; }

.parts-not-ready {
  margin: 8px 0 0;
  font-size: 12px;
  font-style: italic;
  opacity: .7;
}

@media (max-width: 640px) {
  .parts-panel { left: 10px; right: 10px; width: auto; }
}
`

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

/** @type {Promise<{entries: object[]}|null>|null} */
let catalogPromise = null

/** @type {string} */
let catalogPromiseUrl = ''

/** @type {HTMLElement|null} */
let panel = null

function getCatalog(catalogUrl) {
  if (!catalogPromise || catalogPromiseUrl !== catalogUrl) {
    catalogPromiseUrl = catalogUrl
    const pending = fetch(catalogUrl)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(catalog => {
        if (!catalog && catalogPromise === pending) catalogPromise = null
        return catalog
      })
    catalogPromise = pending
  }
  return catalogPromise
}

/**
 * Preferred entry first, catalog order otherwise.
 * @param {object[]} entries
 * @returns {Map<string, object[]>}
 */
function familiesOf(entries) {
  const byFamily = new Map()
  for (const entry of entries) {
    if (!byFamily.has(entry.family)) byFamily.set(entry.family, [])
    byFamily.get(entry.family).push(entry)
  }
  for (const list of byFamily.values()) {
    list.sort((a, b) => (a.preferred ? 0 : 1) - (b.preferred ? 0 : 1))
  }
  return byFamily
}

/** Call argument text: `list` and `names` sizes are identifiers, `values` sizes JSON literals. */
const formatSize = (entry, rawSize) => (entry.sizes?.list || entry.sizes?.names ? String(rawSize) : JSON.stringify(rawSize))

const formatArgs = (entry, [size, ...rest]) => [formatSize(entry, size), ...rest.map(a => JSON.stringify(a))].join(', ')

const round2 = (n) => Math.round(n * 100) / 100

const resolveCatalogPath = (path, catalogUrl) => new URL(path, new URL(catalogUrl, location.href)).toString()

function renderError(content) {
  content.innerHTML = ''
  content.appendChild(el('div', { className: 'parts-error' }, 'Parts catalog unavailable.'))
}

function renderList(content, catalogUrl, families, { onSelectEntry }) {
  content.innerHTML = ''
  if (families.size === 0) {
    content.appendChild(el('div', { className: 'parts-loading' }, 'No parts found'))
    return
  }
  for (const [family, entries] of families) {
    const thumb = el('img', {
      className: 'parts-thumb',
      src: resolveCatalogPath(entries[0].thumb, catalogUrl),
      alt: `${family} thumbnail`,
    })
    const card = el('div', { className: 'parts-family-card' },
      el('div', { className: 'parts-family-header' }, thumb, el('span', { className: 'parts-family-name' }, family)),
    )
    for (const entry of entries) {
      card.appendChild(el('button', {
        className: 'parts-entry',
        title: entry.summary,
        onclick: () => onSelectEntry(entry),
      }, el('span', {}, entry.library), el('span', { className: 'parts-license' }, entry.license)))
    }
    content.appendChild(card)
  }
}

function renderEntry(content, entry, { getEditor, onBack }) {
  content.innerHTML = ''

  let selectedSize = entry.sizeNames[0]
  const sizeSelect = el('select', { className: 'parts-size-select' },
    ...entry.sizeNames.map(name => el('option', { value: String(name) }, String(name))),
  )
  sizeSelect.addEventListener('change', () => {
    selectedSize = entry.sizeNames[sizeSelect.selectedIndex]
  })

  const optionsEntries = Object.entries(entry.options || {})
  const measured = entry.measured || []

  // Checked again on click: the editor can become ready, or stop being ready, while this view is open.
  const editorReady = Boolean(getEditor?.())

  const insertBtn = el('button', {
    className: 'parts-insert',
    ...(editorReady ? {} : { disabled: true }),
    onclick: () => {
      const editor = getEditor?.()
      if (!editor) return
      const size = formatSize(entry, selectedSize)
      const plan = planInsert({
        doc: editor.getSource(),
        cursor: editor.getCursor(),
        path: editor.getPath(),
        entry,
        size,
      })
      editor.applyEdit(plan)
    },
  }, 'Insert')

  content.appendChild(el('div', { className: 'parts-entry-view' },
    el('button', { className: 'parts-back', onclick: onBack }, '← Back'),
    el('p', { className: 'parts-summary' }, entry.summary),
    el('div', { className: 'parts-signature' }, `${entry.call}(${(entry.signature?.params || []).map(p => p.name).join(', ')})`),
    el('div', { className: 'parts-field-label' }, 'Size'),
    sizeSelect,
    optionsEntries.length ? el('div', { className: 'parts-field-label' }, 'Options') : null,
    optionsEntries.length
      ? el('ul', { className: 'parts-options' }, ...optionsEntries.map(([name, meaning]) => el('li', {}, `${name}: ${meaning}`)))
      : null,
    measured.length ? el('div', { className: 'parts-field-label' }, 'Measured') : null,
    measured.length
      ? el('ul', { className: 'parts-measured' }, ...measured.map(m => el('li', {}, `${formatArgs(entry, m.args)} → ${m.size.map(round2).join(' × ')} mm`)))
      : null,
    el('p', { className: 'parts-entry-license' }, entry.license),
    el('div', { className: 'parts-field-label' }, 'Example'),
    el('pre', { className: 'parts-example' }, entry.example),
    insertBtn,
    editorReady ? null : el('p', { className: 'parts-not-ready' }, 'Editor not ready yet.'),
  ))
}

function closePanel() {
  if (!panel) return
  panel.remove()
  panel = null
  document.removeEventListener('keydown', onKey)
}

function onKey(e) {
  if (escapeCloses(e, panel, '.demo-panel')) closePanel()
}

/**
 * Show the parts browser panel, or close it when open.
 * @param {object} opts
 * @param {string} opts.catalogUrl - URL of `parts/catalog.json`
 * @param {() => {getSource: Function, getPath: Function, getCursor: Function, applyEdit: Function}|null} opts.getEditor
 *   Returns the editor to insert into, or null when none is available.
 */
export function showPartsBrowser({ catalogUrl, getEditor }) {
  if (panel) {
    closePanel()
    return
  }

  panel = el('div', { className: 'parts-panel', tabindex: '-1' })

  const closeBtn = el('button', { className: 'parts-close-btn', title: 'Close', 'aria-label': 'Close' }, '×')
  closeBtn.addEventListener('click', closePanel)

  const header = el('div', { className: 'parts-panel-header' }, el('h3', {}, 'Parts'), closeBtn)
  const content = el('div', { className: 'parts-content' }, el('div', { className: 'parts-loading' }, 'Loading…'))

  panel.appendChild(header)
  panel.appendChild(content)
  document.body.appendChild(panel)

  document.addEventListener('keydown', onKey)

  getCatalog(catalogUrl).then(catalog => {
    if (!panel) return // closed while loading
    if (!catalog) {
      renderError(content)
      return
    }
    const families = familiesOf(catalog.entries || [])
    // Replacing the content drops focus to body; keep it in the panel so Escape still finds it.
    const refocus = () => panel?.focus({ preventScroll: true })
    const showList = () => renderList(content, catalogUrl, families, {
      onSelectEntry: entry => {
        renderEntry(content, entry, { getEditor, onBack: () => { showList(); refocus() } })
        refocus()
      },
    })
    showList()
  })
}
