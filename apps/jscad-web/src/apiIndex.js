import { docsTool } from '@jscadui/agent-loop'
import { escapeCloses } from './panelEscape.js'

// api/index.json is about 260 KB and only the chat reads it, so build.js
// bundles it on its own and hashes this name; a page that never chats never
// downloads it.
export const API_INDEX_BUNDLE = 'build/bundle.api-index.js'

// A computed specifier, so esbuild leaves the import to the browser.
const importBundle = () => import(new URL(API_INDEX_BUNDLE, document.baseURI).href).then((m) => m.default)

/**
 * The index, loaded on the first call and shared after; a failed load is tried again next call.
 * @param {() => Promise<Array<object>>} [load]
 */
export const createIndexLoader = (load = importBundle) => {
  let pending = null
  return () =>
    (pending ??= load().catch((error) => {
      pending = null
      throw error
    }))
}

/**
 * The chat's docs tool.
 * @param {() => Promise<Array<object>>} loadIndex
 * @param {() => string} getApi the chat's API style
 */
export const createDocs = (loadIndex, getApi) => async (query) => docsTool(await loadIndex(), query, { api: getApi() })

export const apiHelpStyles = `
.api-help-panel {
  position: fixed;
  top: 44px;
  left: 300px;
  z-index: 2500;
  background: #f8f8f8;
  color: #111;
  border: 1px solid #888;
  box-shadow: 2px 4px 12px rgba(0,0,0,.25);
  width: 460px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  font-family: inherit;
  font-size: 14px;
  border-radius: 0 4px 4px 0;
}
.api-help-panel:focus { outline: none; }
.dark .api-help-panel {
  background: #444;
  color: #ddd;
  border-color: #555;
  box-shadow: 2px 4px 12px rgba(0,0,0,.5);
}

.api-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid #888;
  flex-shrink: 0;
}
.dark .api-help-header { border-bottom-color: #555; }

.api-help-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.api-help-close-btn {
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
.api-help-close-btn:hover { opacity: 1; background: rgba(128,128,128,.15); }

.api-help-form {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
}
.dark .api-help-form { border-bottom-color: #555; }

.api-help-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  padding: 4px 6px;
  border: 1px solid #888;
  border-radius: 3px;
}

.api-help-submit {
  font: inherit;
  padding: 4px 12px;
  cursor: pointer;
  border: 1px solid #888;
  border-radius: 3px;
  background: #08d;
  color: #fff;
}
.api-help-submit:hover { opacity: .9; }
.dark .api-help-submit { border-color: #555; }

.api-help-results {
  overflow: auto;
  flex: 1;
  padding: 8px 10px;
}

.api-help-hint,
.api-help-loading {
  margin: 0;
  font-size: 12px;
  font-style: italic;
  opacity: .7;
}

.api-help-error {
  margin: 0;
  font-size: 12px;
  color: #c00;
}
.dark .api-help-error { color: #f88; }

.api-help-answer {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 640px) {
  .api-help-panel { left: 10px; right: 10px; width: auto; }
}
`

const el = (tag, attrs = {}, ...children) => {
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

// docsTool answers a miss as JSON and a hit as text; return the miss's message.
const errorMessage = (answer) => {
  try {
    const parsed = JSON.parse(answer)
    return parsed?.ok === false ? parsed.error?.message ?? answer : null
  } catch {
    return null
  }
}

/** @type {HTMLElement|null} */
let helpPanel = null

function closeHelp() {
  if (!helpPanel) return
  helpPanel.remove()
  helpPanel = null
  document.removeEventListener('keydown', onHelpKey)
}

function onHelpKey(e) {
  if (escapeCloses(e, helpPanel, '.parts-panel')) closeHelp()
}

/**
 * Show the API help panel, or close it when open. It answers through the same
 * docs tool and API style the chat uses, reading the current style per lookup.
 * @param {object} opts
 * @param {() => Promise<Array<object>>} opts.loadIndex
 * @param {() => string} opts.getApi the chat's API style
 */
export function showApiHelp({ loadIndex, getApi }) {
  if (helpPanel) {
    closeHelp()
    return
  }

  const docs = createDocs(loadIndex, getApi)
  const results = el('div', { className: 'api-help-results' },
    el('p', { className: 'api-help-hint' }, 'Type a function, class or namespace name.'))

  const render = (answer) => {
    if (!helpPanel) return
    results.innerHTML = ''
    const message = errorMessage(answer)
    results.appendChild(message
      ? el('p', { className: 'api-help-error' }, message)
      : el('pre', { className: 'api-help-answer' }, answer))
  }

  const input = el('input', {
    className: 'api-help-input',
    type: 'search',
    placeholder: 'e.g. roundedCuboid, jf.polygon, primitives',
    'aria-label': 'API name',
  })

  const form = el('form', { className: 'api-help-form' },
    input,
    el('button', { className: 'api-help-submit', type: 'submit' }, 'Look up'),
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const query = input.value.trim()
    if (!query) return
    results.innerHTML = ''
    results.appendChild(el('p', { className: 'api-help-loading' }, 'Looking up…'))
    const answer = await docs(query).catch((err) => `lookup failed: ${err.message}`)
    render(answer)
  })

  const closeBtn = el('button', { className: 'api-help-close-btn', title: 'Close', 'aria-label': 'Close' }, '×')
  closeBtn.addEventListener('click', closeHelp)

  helpPanel = el('div', { className: 'api-help-panel', tabindex: '-1' },
    el('div', { className: 'api-help-header' }, el('h3', {}, 'API Help'), closeBtn),
    form,
    results,
  )
  document.body.appendChild(helpPanel)
  document.addEventListener('keydown', onHelpKey)
  input.focus()
}
