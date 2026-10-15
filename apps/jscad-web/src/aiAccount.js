// Account panel: gear-gated chat config. The drawer shows one header row
// (sign-in for project sync on the left, gear on the right) plus a
// provider · model summary; every setting lives in the gear dialog.
// Non-secret selection lives in localStorage; the key itself lives in
// @jscadui/key-store and attaches per request.
import { APIS, DEFAULT_API } from '@jscadui/agent-loop'
import { createKeyStore } from '@jscadui/key-store'
import { SEARCH_PROVIDERS, createSearchStores } from './aiSearch.js'
import { relayBaseUrl, sharedListUrl } from './aiChat.js'
import { effortOptionsForModel } from './aiEffort.js'
import { getRecordOwnChats, isDemoSelection, RECORDING_TEXT, setRecordOwnChats } from './aiConsent.js'

const SELECTION_KEY = 'jscad-ai.selection'

// The one credential the demo provider carries; the relay ignores its value and
// injects the operator's server-held key per shared option.
export const DEMO_API_KEY = 'demo-limited-free'
const DEMO_PREFIX = 'demo:'
// The relay's `available` flag is month-only; an exhausted option stays listed
// so its reason is visible, but cannot be chosen.
const DEMO_LIMIT_REASON = 'monthly limit reached'

// The local backend persists to IndexedDB when available; only without it
// (private mode, the compute frame) does a reload drop work that was never
// synced. `hasLocalWork` is set per account panel; the browser's unload
// prompt is the only warning that survives a full-page navigation.
let warnOnUnload = () => false
// The sign-in redirect reloads the page on purpose and already asked; the
// native prompt would double-ask, so it is suppressed for that navigation.
let suppressUnloadPrompt = false
window.addEventListener('beforeunload', (ev) => {
  if (suppressUnloadPrompt || !warnOnUnload()) return
  ev.preventDefault()
  ev.returnValue = ''
})

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const field = (labelText, control) => {
  const label = el('label', 'ai-field')
  label.append(el('span', 'ai-field-name', labelText), control)
  return label
}

const textInput = (value = '', placeholder = '', type = 'text') => {
  const input = el('input', 'ai-input')
  input.type = type
  input.value = value
  input.placeholder = placeholder
  return input
}

export const keyStore = createKeyStore()

// One search-key store per provider (page memory + origin localStorage, never
// posted to the compute frame, never logged). The dialog below owns the UI.
export const searchStores = createSearchStores(globalThis.localStorage)

// Signup origins derived from the probed MCP endpoints in the websearch spec.
const SEARCH_SIGNUP = { exa: 'https://exa.ai', parallel: 'https://parallel.ai', firecrawl: 'https://firecrawl.dev', tavily: 'https://tavily.com', tinyfish: 'https://tinyfish.ai' }

const DEFAULT_WEBSEARCH = { allow: false, provider: 'random' }

export const getWebsearchSelection = () => ({ ...DEFAULT_WEBSEARCH, ...(getSelection().websearch ?? {}) })

export const getSelection = () => {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY)) ?? {}
  } catch {
    return {}
  }
}

const setSelection = (selection) => {
  localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
}

// The modeling API the chat teaches, read per turn; the settings radio button
// will store it as the selection's `api`.
export const getChatApi = () => {
  const { api } = getSelection()
  return APIS.includes(api) ? api : DEFAULT_API
}

// The provider config the chat POSTs per turn, or null when incomplete.
// Fail-closed: no key, no model, no turn. A demo selection carries the sentinel
// credential instead of a user key and rides the shared relay route.
export const getProviderConfig = () => {
  const selection = getSelection()
  const { kind = 'anthropic', model = '', baseUrl = '', effort = '' } = selection
  if (!model) return null
  if (isDemoSelection(selection)) {
    return { kind, model, ...(effort ? { effort } : {}), apiKey: DEMO_API_KEY, shared: selection.shared, demo: true }
  }
  const apiKey = keyStore.get()
  if (!apiKey) return null
  return { kind, model, ...(baseUrl ? { baseUrl } : {}), ...(effort ? { effort } : {}), apiKey }
}

// The demo options the relay offers, or [] when the list cannot be read. An
// unreadable list hides demo rather than offering a selection that cannot run.
export const loadSharedOptions = async () => {
  try {
    const res = await fetch(sharedListUrl(), { headers: { accept: 'application/json' } })
    if (!res.ok) return []
    const body = await res.json()
    return Array.isArray(body) ? body.filter((opt) => opt && typeof opt.id === 'string') : []
  } catch {
    return []
  }
}

const getSession = async () => {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' })
    if (!res.ok) return null
    const body = await res.json()
    return body?.user ?? null
  } catch {
    return null
  }
}

export { getSession }

const modelPlaceholders = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o', 'opencode-go': 'deepseek-v4.1-flash', meta: 'muse-spark-1.3' }
const KINDS = ['anthropic', 'openai', 'opencode-go', 'meta']

const authHeaders = (kind, apiKey) =>
  kind === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }

const modelsUrl = (kind, baseUrl) =>
  baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/models` : `${relayBaseUrl(kind)}/v1/models`

/**
 * @param {HTMLElement} container
 * @param {{onSignOut?: Function, hasLocalWork?: () => boolean, onWebsearchGrant?: Function, onSelectionChange?: Function}} [options]
 */
export const initAccount = (container, { onSignOut = () => {}, hasLocalWork = () => false, onWebsearchGrant = () => {}, onSelectionChange = () => {} } = {}) => {
  warnOnUnload = hasLocalWork
  suppressUnloadPrompt = false
  const selection = getSelection()
  const websearch = getWebsearchSelection()
  const state = {
    kind: selection.kind ?? 'anthropic',
    model: selection.model ?? '',
    baseUrl: selection.baseUrl ?? '',
    effort: selection.effort ?? '',
    demo: isDemoSelection(selection),
    shared: typeof selection.shared === 'string' ? selection.shared : '',
    api: APIS.includes(selection.api) ? selection.api : DEFAULT_API,
    capabilities: new Map(),
    websearchAllow: websearch.allow,
    websearchProvider: websearch.provider,
  }
  // A demo selection stores `{shared, demo:true}` and never a base URL; switching
  // back to an own-key provider drops both.
  const persistSelection = () => {
    setSelection({
      kind: state.kind,
      model: state.model,
      baseUrl: state.baseUrl,
      api: state.api,
      ...(state.effort ? { effort: state.effort } : {}),
      ...(demoActive() ? { shared: state.shared, demo: true } : {}),
      websearch: { allow: state.websearchAllow, provider: state.websearchProvider },
    })
    onSelectionChange()
  }

  // Header row: sign-in state on the left, gear on the right.
  const header = el('div', 'ai-header-row')
  const signIn = el('button', 'ai-button', 'Sign in to Sync')
  signIn.type = 'button'
  const sessionLine = el('span', 'ai-session', '')
  const signOut = el('button', 'ai-button', 'Sign out')
  signOut.type = 'button'
  signOut.style.display = 'none'
  const gear = el('button', 'ai-gear', '⚙')
  gear.type = 'button'
  gear.title = 'Chat settings'
  gear.setAttribute('aria-label', 'Chat settings')
  header.append(signIn, sessionLine, signOut, gear)
  container.append(header)

  const refreshSession = async () => {
    const user = await getSession()
    if (user) {
      signIn.style.display = 'none'
      sessionLine.textContent = `${user.email ?? user.name ?? 'user'}`
      signOut.style.display = ''
    } else {
      signIn.style.display = ''
      sessionLine.textContent = ''
      signOut.style.display = 'none'
    }
  }

  signIn.addEventListener('click', async () => {
    // The redirect reloads the page; confirm first so local-only work is not
    // dropped silently. The callback is the full current URL so the hash
    // (a #url= model) survives the round trip.
    if (hasLocalWork() && !window.confirm('Signing in reloads the page, and work kept only on this device will be lost. Continue?')) return
    const res = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: window.location.href }),
    })
    const body = await res.json().catch(() => ({}))
    if (body?.url) {
      // The redirect reloads the page after the confirm above; the native
      // unload prompt would ask a second time, so silence it for this
      // navigation (tab close and manual reload still warn).
      suppressUnloadPrompt = true
      window.location.assign(body.url)
    } else {
      sessionLine.textContent = `Sign-in failed: ${body?.error ?? res.status}`
    }
  })

  signOut.addEventListener('click', async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }).catch(() => {})
    await onSignOut()
    refreshSession()
  })

  const summary = el('div', 'ai-session ai-summary')

  // A demo option pins one model on the relay; the dialog shows it as
  // `Demo: <label>` and hides the key, custody, base URL and model controls.
  let sharedOptions = []
  const demoActive = () => state.demo === true && typeof state.shared === 'string' && state.shared !== ''
  const demoOption = () => sharedOptions.find((opt) => opt.id === state.shared) ?? null

  const refreshSummary = () => {
    if (demoActive()) {
      summary.textContent = `Demo: ${demoOption()?.label ?? state.shared}`
      return
    }
    summary.textContent = state.model ? `${state.kind} · ${state.model}` : `${state.kind} · no model set`
  }
  container.append(summary)

  const dialog = document.createElement('dialog')
  dialog.className = 'ai-settings'

  const kind = el('select', 'ai-input ai-provider-select')
  const demoInfo = el('div', 'ai-session ai-demo-info', '')
  demoInfo.style.display = 'none'
  const renderProviderOptions = () => {
    kind.innerHTML = ''
    for (const value of KINDS) {
      const option = el('option', '', value)
      option.value = value
      kind.append(option)
    }
    for (const opt of sharedOptions) {
      const option = el('option')
      option.value = `${DEMO_PREFIX}${opt.id}`
      option.disabled = opt.available === false
      option.textContent = opt.available === false ? `Demo: ${opt.label} (${DEMO_LIMIT_REASON})` : `Demo: ${opt.label}`
      kind.append(option)
    }
    kind.value = demoActive() ? `${DEMO_PREFIX}${state.shared}` : state.kind
    if (!kind.value) kind.value = state.kind
  }

  const modelSelect = el('select', 'ai-input')
  modelSelect.classList.add('ai-model-select')
  const modelStatus = el('div', 'ai-session ai-model-status', '')
  const modelInput = textInput(state.model, modelPlaceholders[state.kind] ?? '')
  modelInput.classList.add('ai-model-input')
  const syncModelControls = (models) => {
    modelSelect.innerHTML = ''
    for (const m of models) {
      const option = el('option', '', m.id ?? m)
      option.value = m.id ?? m
      modelSelect.append(option)
    }
    if (!state.model && modelSelect.options.length) {
      state.model = modelSelect.value
      modelInput.value = state.model
    }
    if ([...modelSelect.options].some((o) => o.value === state.model)) modelSelect.value = state.model
    else modelInput.value = state.model
  }

  const apiStyle = el('div', 'ai-api-radios')
  apiStyle.setAttribute('role', 'radiogroup')
  apiStyle.setAttribute('aria-label', 'API style')
  for (const value of APIS) {
    const label = el('label', 'ai-radio')
    const radio = el('input', 'ai-api-radio')
    radio.type = 'radio'
    radio.name = 'ai-api'
    radio.value = value
    radio.checked = state.api === value
    radio.addEventListener('change', () => {
      state.api = value
      persistSelection()
    })
    label.append(radio, el('span', '', value))
    apiStyle.append(label)
  }

  const apiField = el('div', 'ai-field ai-api-field')
  apiField.append(el('span', 'ai-field-name', 'API style'), apiStyle)

  const effortField = field('Effort', el('select', 'ai-input'))
  const effortSelect = effortField.querySelector('select')
  effortSelect.classList.add('ai-effort-select')
  const effortWrap = effortField
  const refreshEffort = () => {
    const caps = state.capabilities.get(state.model) ?? null
    const options = effortOptionsForModel({ kind: state.kind, modelId: state.model, capabilities: caps })
    effortSelect.innerHTML = ''
    for (const level of options) {
      const option = el('option', '', level)
      option.value = level
      effortSelect.append(option)
    }
    if (!options.length) {
      effortWrap.style.display = 'none'
      state.effort = ''
    } else {
      effortWrap.style.display = ''
      effortSelect.value = options.includes(state.effort) ? state.effort : options[0]
      state.effort = effortSelect.value
    }
    persistSelection()
    refreshSummary()
  }

  const baseUrl = textInput(state.baseUrl, 'base URL (openai-compatible only)')
  baseUrl.classList.add('ai-base-input')
  const advanced = document.createElement('details')
  advanced.className = 'ai-advanced'
  advanced.append(Object.assign(document.createElement('summary'), { textContent: 'Advanced' }), field('Base URL', baseUrl))

  const key = textInput('', 'sk-...', 'password')
  key.classList.add('ai-key-input')
  key.autocomplete = 'off'
  const mode = el('select', 'ai-input')
  for (const value of ['session', 'device', 'synced']) mode.append(Object.assign(el('option'), { value, textContent: value }))
  mode.value = 'session'
  const passphrase = textInput('', 'synced mode only', 'password')
  const saveKey = el('button', 'ai-button ai-save-key', 'Save key')
  saveKey.type = 'button'
  const clearKey = el('button', 'ai-button', 'Forget key')
  clearKey.type = 'button'
  const keyLine = el('span', 'ai-session', keyStore.get() ? 'Key set.' : 'No key set.')
  const keyActions = el('div', 'ai-actions')
  keyActions.append(saveKey, clearKey, keyLine)

  // The recording consent the Send gate also reads; toggling it rewrites both
  // `jscad-ai.tos` and its `jscad-ai.log` mirror (the `.tos` record wins).
  const recordToggle = el('input', 'ai-record-toggle')
  recordToggle.type = 'checkbox'
  recordToggle.checked = getRecordOwnChats()
  const recordField = el('label', 'ai-field ai-record-field')
  recordField.append(el('span', 'ai-field-name', 'Save chats'), recordToggle, el('span', 'ai-field-note', RECORDING_TEXT))
  recordToggle.addEventListener('change', () => {
    setRecordOwnChats(recordToggle.checked)
    onSelectionChange()
  })

  const keyField = field('API key', key)
  const keepField = field('Keep', mode)
  const passphraseField = field('Passphrase', passphrase)
  const modelField = field('Model', modelSelect)
  const modelInputField = field('Custom model id', modelInput)

  // Demo hides everything the relay owns for it: the key, its custody, the
  // custom base URL and the model controls (the option pins one model). The
  // recording box is checked and locked, since demo turns always record.
  const applyDemoState = () => {
    const demo = demoActive()
    for (const node of [keyField, keepField, passphraseField, keyActions, modelField, modelInputField, advanced]) {
      node.style.display = demo ? 'none' : ''
    }
    demoInfo.style.display = demo ? '' : 'none'
    if (demo) {
      demoInfo.textContent = `Demo: ${demoOption()?.label ?? state.shared} · ${state.model}`
      modelStatus.textContent = ''
    }
    recordToggle.checked = demo ? true : getRecordOwnChats()
    recordToggle.disabled = demo
    refreshEffort()
  }

  const closeBtn = el('button', 'ai-button', 'Close')
  closeBtn.type = 'button'
  const footer = el('div', 'ai-dialog-footer')
  footer.append(closeBtn)

  // Web search keys: one password row per provider sharing one custody mode,
  // plus the blanket-grant toggle (global default for new conversations) and
  // the provider pin. Revoking the grant never clears the stored keys.
  const searchMode = el('select', 'ai-input ai-search-mode')
  for (const value of ['session', 'device', 'synced']) searchMode.append(Object.assign(el('option'), { value, textContent: value }))
  searchMode.value = 'session'
  const searchPassphrase = textInput('', 'synced mode only', 'password')
  searchPassphrase.classList.add('ai-search-passphrase')
  const searchRows = el('div', 'ai-search-rows')
  for (const id of SEARCH_PROVIDERS) {
    const store = searchStores[id]
    const row = el('div', 'ai-search-row')
    row.dataset.searchProvider = id
    const link = el('a', 'ai-search-link', id)
    link.href = SEARCH_SIGNUP[id]
    link.target = '_blank'
    link.rel = 'noreferrer'
    const input = textInput('', `${id} key`, 'password')
    input.classList.add('ai-search-key-input')
    input.autocomplete = 'off'
    const status = el('span', 'ai-search-status', store.get() ? 'key set' : 'keyless')
    const save = el('button', 'ai-button ai-search-save', 'Save')
    save.type = 'button'
    const clear = el('button', 'ai-button ai-search-clear', 'Clear')
    clear.type = 'button'
    save.addEventListener('click', async () => {
      try {
        if (!input.value) {
          await store.unlock(searchPassphrase.value)
        } else {
          await store.set(input.value, searchMode.value, searchPassphrase.value || undefined)
          input.value = ''
        }
        status.textContent = 'key set'
      } catch (err) {
        status.textContent = `key failed: ${err.message}`
      }
    })
    clear.addEventListener('click', () => {
      store.clear()
      status.textContent = 'keyless'
    })
    row.append(link, input, save, clear, status)
    searchRows.append(row)
  }
  const websearchAllow = el('input', 'ai-websearch-allow')
  websearchAllow.type = 'checkbox'
  websearchAllow.checked = state.websearchAllow === true
  websearchAllow.addEventListener('change', () => {
    state.websearchAllow = websearchAllow.checked
    persistSelection()
    onWebsearchGrant(websearchAllow.checked)
  })
  const websearchProvider = el('select', 'ai-input ai-websearch-provider')
  for (const value of ['random', ...SEARCH_PROVIDERS, 'off']) {
    websearchProvider.append(Object.assign(el('option'), { value, textContent: value }))
  }
  websearchProvider.value = ['random', ...SEARCH_PROVIDERS, 'off'].includes(state.websearchProvider) ? state.websearchProvider : 'random'
  state.websearchProvider = websearchProvider.value
  websearchProvider.addEventListener('change', () => {
    state.websearchProvider = websearchProvider.value
    persistSelection()
  })

  dialog.append(
    el('h2', 'ai-dialog-title', 'Chat settings'),
    field('Provider', kind),
    demoInfo,
    keyField,
    keepField,
    passphraseField,
    keyActions,
    modelField,
    modelStatus,
    modelInputField,
    apiField,
    effortWrap,
    recordField,
    advanced,
    el('h3', 'ai-dialog-subtitle', 'Web search'),
    searchRows,
    field('Keep search keys', searchMode),
    field('Search passphrase', searchPassphrase),
    field('Allow web search', websearchAllow),
    field('Search provider', websearchProvider),
    footer,
  )
  container.append(dialog)

  let modelsRequest = 0
  const loadModels = async () => {
    const request = ++modelsRequest
    // Demo has no model dropdown: each shared option pins one model, and the
    // "catalog" is the option list itself, so there is nothing to GET.
    if (demoActive()) {
      modelStatus.textContent = ''
      return
    }
    const apiKey = keyStore.get()
    if (!apiKey) {
      modelStatus.textContent = 'Save an API key to load the model list.'
      return
    }
    modelStatus.textContent = 'Loading models…'
    try {
      const res = await fetch(modelsUrl(state.kind, state.baseUrl), { headers: authHeaders(state.kind, apiKey) })
      if (request !== modelsRequest) return
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 160)
        modelStatus.textContent = `Models failed: ${res.status}${detail ? ` ${detail}` : ''}`
        return
      }
      const body = await res.json()
      if (request !== modelsRequest) return
      const models = Array.isArray(body?.data) ? body.data : []
      if (models.length === 0) {
        modelStatus.textContent = 'No models listed. Enter a model id below.'
        return
      }
      state.capabilities = new Map(models.map((m) => [m.id, m.capabilities ?? null]))
      syncModelControls(models)
      modelStatus.textContent = `${models.length} models`
      refreshEffort()
    } catch (err) {
      if (request === modelsRequest) modelStatus.textContent = `Models failed: ${err.message}`
    }
  }

  const closeDialog = () => {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }
  // The shared list is read on dialog open, like the model list; an unreadable
  // list hides demo (no option to pick something that cannot run).
  const refreshSharedOptions = async () => {
    sharedOptions = await loadSharedOptions()
    if (demoActive() && !demoOption()) {
      state.demo = false
      state.shared = ''
    }
    renderProviderOptions()
    applyDemoState()
  }
  gear.addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    loadModels()
    refreshSharedOptions()
  })
  closeBtn.addEventListener('click', closeDialog)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog()
  })

  kind.addEventListener('change', () => {
    const option = kind.value.startsWith(DEMO_PREFIX) ? sharedOptions.find((o) => `${DEMO_PREFIX}${o.id}` === kind.value) : null
    if (option && option.available !== false) {
      state.demo = true
      state.shared = option.id
      state.kind = option.kind
      state.model = option.model
      state.baseUrl = ''
      baseUrl.value = ''
      state.capabilities = new Map()
      applyDemoState()
      return
    }
    state.demo = false
    state.shared = ''
    if (!kind.value.startsWith(DEMO_PREFIX)) state.kind = kind.value
    state.model = ''
    modelInput.value = ''
    modelInput.placeholder = modelPlaceholders[state.kind] ?? ''
    modelSelect.innerHTML = ''
    state.capabilities = new Map()
    applyDemoState()
    loadModels()
  })
  modelSelect.addEventListener('change', () => {
    state.model = modelSelect.value
    modelInput.value = modelSelect.value
    refreshEffort()
  })
  modelInput.addEventListener('change', () => {
    state.model = modelInput.value.trim()
    refreshEffort()
  })
  effortSelect.addEventListener('change', () => {
    state.effort = effortSelect.value
    persistSelection()
  })
  baseUrl.addEventListener('change', () => {
    state.baseUrl = baseUrl.value.trim()
    persistSelection()
    loadModels()
  })

  saveKey.addEventListener('click', async () => {
    try {
      if (!key.value) {
        await keyStore.unlock(passphrase.value)
      } else {
        await keyStore.set(key.value, mode.value, passphrase.value || undefined)
        key.value = ''
      }
      persistSelection()
      keyLine.textContent = 'Key set.'
      loadModels()
    } catch (err) {
      keyLine.textContent = `Key failed: ${err.message}`
    }
  })

  clearKey.addEventListener('click', () => {
    keyStore.clear()
    keyLine.textContent = 'No key set.'
  })

  renderProviderOptions()
  applyDemoState()
  refreshSession()
}
