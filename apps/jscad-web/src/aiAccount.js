// Account panel: gear-gated chat config. The drawer shows one header row
// (sign-in for project sync on the left, gear on the right) plus a
// provider · model summary; every setting lives in the gear dialog.
// Non-secret selection lives in localStorage; the key itself lives in
// @jscadui/key-store and attaches per request.
import { APIS, DEFAULT_API } from '@jscadui/agent-loop'
import { createKeyStore } from '@jscadui/key-store'
import { SEARCH_PROVIDERS, createSearchStores } from './aiSearch.js'
import { relayBaseUrl, inferenceListUrl } from './aiChat.js'
import { defaultEffort, effortOptionsForModel } from './aiEffort.js'
import { getRecordOwnChats, isFreeSelection, RECORDING_TEXT, setRecordOwnChats } from './aiConsent.js'
import { readOverride, readVisionCache, refreshVisionCache, writeOverride } from './modelVision.js'
import { mountSyncEntry } from './syncEntry.js'

const SELECTION_KEY = 'jscad-ai.selection'

// The one credential the free provider carries; the relay ignores its value and
// injects the operator's server-held key per free option.
export const FREE_API_KEY = 'jscad-web-free'
// The relay's `available` flag is month-only; an exhausted model stays listed
// so its reason is visible, but cannot be chosen.
const FREE_LIMIT_REASON = 'monthly limit reached'

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

// A stored key reads back as its first 8 characters plus an ellipsis: enough
// to tell which key is on the device without revealing it in the dialog.
const keyFingerprint = (key) => (typeof key === 'string' && key ? ` (${key.slice(0, 8)}…)` : '')
const keyLineText = () => {
  const key = keyStore.get()
  return key ? `Key set${keyFingerprint(key)}.` : 'No key set.'
}
const searchStatusText = (store) => {
  const key = store.get()
  return key ? `key set${keyFingerprint(key)}` : 'keyless'
}

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

// The provider's own metadata for the models the dialog last listed, keyed by
// model id. Catalog data, not a user setting: it is never persisted, and
// `getProviderConfig` reads it so the chat can offer the image tool to a model
// its provider reports as vision-capable even when the id is in no known-vision
// table (`src/aiChat.js`). Empty until a model list loads, which leaves the
// table as the answer.
const modelCapabilities = new Map()

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
// Fail-closed: no key, no model, no turn. A free selection carries the sentinel
// credential instead of a user key and rides the jscad-web relay route.
export const getProviderConfig = () => {
  const selection = getSelection()
  const { kind = 'anthropic', model = '', baseUrl = '', effort = '' } = selection
  if (!model) return null
  // The provider's own metadata for the chosen model rides with the config: the
  // chat reads `capabilities.vision` for the image tool (adapters ignore the
  // field). A manual per-model override wins over metadata: some providers
  // (notably opencode-go) serve no capability fields at all, so the settings
  // toggle is the only source that can name such a model vision-capable.
  const capabilities = modelCapabilities.get(model)
  const overridden = readOverride(globalThis.localStorage, model) === true
  const effective = overridden ? { ...(capabilities ?? {}), vision: true } : capabilities
  const withCapabilities = (config) => (effective ? { ...config, capabilities: effective } : config)
  if (isFreeSelection(selection)) {
    const inference = selection.inference ?? ''
    if (!inference) return null
    return withCapabilities({ kind, model, ...(effort ? { effort } : {}), apiKey: FREE_API_KEY, inference, free: true })
  }
  const apiKey = keyStore.get()
  if (!apiKey) return null
  return withCapabilities({ kind, model, ...(baseUrl ? { baseUrl } : {}), ...(effort ? { effort } : {}), apiKey })
}

const modelPlaceholders = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o', 'opencode-go': 'deepseek-v4.1-flash', meta: 'muse-spark-1.3', 'jscad-web': 'deepseek-v4.1-flash' }
// `jscad-web` rides the same provider list as every other kind: one row, with
// its models in the shared model menu. The relay owns its key and model list.
const KINDS = ['jscad-web', 'anthropic', 'openai', 'opencode-go', 'meta']

const authHeaders = (kind, apiKey) =>
  kind === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }

const modelsUrl = (kind, baseUrl) =>
  baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/models` : `${relayBaseUrl({ kind })}/v1/models`

/**
 * @param {HTMLElement} container
 * @param {{onSignOut?: Function, hasLocalWork?: () => boolean, onWebsearchGrant?: Function, onSelectionChange?: Function}} [options]
 */
export const initAccount = (container, { onSignOut = () => {}, hasLocalWork = () => false, onWebsearchGrant = () => {}, onSelectionChange = () => {} } = {}) => {
  const selection = getSelection()
  const websearch = getWebsearchSelection()
  const state = {
    kind: selection.kind ?? 'anthropic',
    model: selection.model ?? '',
    baseUrl: selection.baseUrl ?? '',
    effort: selection.effort ?? '',
    free: isFreeSelection(selection),
    inference: typeof selection.inference === 'string' ? selection.inference : '',
    api: APIS.includes(selection.api) ? selection.api : DEFAULT_API,
    // Custody modes are selection state like the rest: the Keep selects
    // restore them on load instead of always reopening on session.
    keyMode: ['session', 'device', 'synced'].includes(selection.keyMode) ? selection.keyMode : 'session',
    searchKeyMode: ['session', 'device', 'synced'].includes(selection.searchKeyMode) ? selection.searchKeyMode : 'session',
    websearchAllow: websearch.allow,
    websearchProvider: websearch.provider,
  }
  // A fresh dialog starts with no catalog metadata, exactly as the per-dialog
  // map did before it moved beside `getProviderConfig`.
  modelCapabilities.clear()
  // A free selection stores `{inference, free:true}` and never a base URL;
  // switching back to an own-key provider drops both.
  const persistSelection = () => {
    setSelection({
      kind: state.kind,
      model: state.model,
      baseUrl: state.baseUrl,
      api: state.api,
      keyMode: state.keyMode,
      searchKeyMode: state.searchKeyMode,
      ...(state.effort ? { effort: state.effort } : {}),
      ...(freeActive() ? { inference: state.inference, free: true } : {}),
      websearch: { allow: state.websearchAllow, provider: state.websearchProvider },
    })
    onSelectionChange()
  }

  // Header row: the sign-in control both drawers mount on the left, the gear
  // on the right.
  const { row: header } = mountSyncEntry(container, { hasLocalWork, onSignOut })
  const gear = el('button', 'ai-gear', '⚙')
  gear.type = 'button'
  gear.title = 'Chat settings'
  gear.setAttribute('aria-label', 'Chat settings')
  header.append(gear)

  const summary = el('div', 'ai-session ai-summary')

  // A free selection stores `{inference, free:true}` under the first-class
  // `jscad-web` kind; the model menu lists the catalog. The summary reads the
  // option label like every other `kind · model` line.
  let inferenceOptions = []
  const freeActive = () => state.free === true && state.kind === 'jscad-web'

  const refreshSummary = () => {
    if (freeActive()) {
      summary.textContent = `jscad-web · ${state.model || state.inference}`
      return
    }
    summary.textContent = state.model ? `${state.kind} · ${state.model}` : `${state.kind} · no model set`
  }
  container.append(summary)

  const dialog = document.createElement('dialog')
  dialog.className = 'ai-settings'

  const kind = el('select', 'ai-input ai-provider-select')
  const renderProviderOptions = () => {
    kind.innerHTML = ''
    for (const value of KINDS) {
      const option = el('option', '', value)
      option.value = value
      kind.append(option)
    }
    kind.value = state.kind
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
      // Only the free catalog marks availability; own-key lists have no flag.
      if (m.available === false) {
        option.disabled = true
        option.textContent += ` (${FREE_LIMIT_REASON})`
      }
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
    const caps = modelCapabilities.get(state.model) ?? null
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
      effortSelect.value = options.includes(state.effort) ? state.effort : defaultEffort(options)
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
  // A typed-but-unsaved key draft, held while free shows the fixed sentinel.
  let keyDraft = ''
  const mode = el('select', 'ai-input')
  for (const value of ['session', 'device', 'synced']) mode.append(Object.assign(el('option'), { value, textContent: value }))
  mode.value = state.keyMode
  mode.addEventListener('change', () => {
    state.keyMode = mode.value
    persistSelection()
  })
  const passphrase = textInput('', 'synced mode only', 'password')
  const saveKey = el('button', 'ai-button ai-save-key', 'Save key')
  saveKey.type = 'button'
  const clearKey = el('button', 'ai-button', 'Forget key')
  clearKey.type = 'button'
  const keyLine = el('span', 'ai-session', keyLineText())
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

  // A manual vision override for providers that serve no capability metadata
  // (opencode-go lists bare ids): checked forces the image tool on for the
  // current model, unchecked leaves the decision to provider metadata and the
  // models.dev cache. Persisted per model id in localStorage.
  const visionToggle = el('input', 'ai-input ai-vision-toggle')
  visionToggle.type = 'checkbox'
  const syncVisionToggle = () => {
    visionToggle.checked = readOverride(globalThis.localStorage, state.model) === true
  }
  visionToggle.addEventListener('change', () => {
    writeOverride(globalThis.localStorage, state.model, visionToggle.checked ? true : null)
    syncVisionToggle()
  })
  const visionField = field('Model reads images', visionToggle)

  // Free disables everything the relay owns for it — the key, its custody,
  // the custom base URL and the custom model id — while the provider, model
  // menu and effort work exactly like every other kind. The wrappers stay
  // visible, so the disabled state reads as "the relay owns this" rather than
  // vanishing. The recording box is checked and locked, since free turns
  // always record.
  const relayOwnedControls = [key, mode, passphrase, saveKey, clearKey, modelInput, baseUrl]
  // The model menu holds upstream model ids; the turn route needs the catalog
  // option id behind the chosen model. Prefer an available option so a stale
  // pick fails with the quota line instead of silently switching models.
  const syncInferenceFromModel = () => {
    const match =
      inferenceOptions.find((o) => o.model === state.model && o.available !== false) ??
      inferenceOptions.find((o) => o.model === state.model) ??
      null
    state.inference = match?.id ?? ''
    persistSelection()
  }
  // The menu may not contain the stored model (or only as exhausted): fall
  // back to the first choosable row so the dialog never offers a dead pick.
  const syncFreeModelSelection = () => {
    const enabled = [...modelSelect.options].filter((o) => !o.disabled)
    if (!enabled.some((o) => o.value === state.model)) {
      state.model = enabled.length ? enabled[0].value : ''
      modelInput.value = state.model
      if (enabled.length) modelSelect.value = state.model
    }
    syncInferenceFromModel()
  }
  const applyFreeState = () => {
    const free = freeActive()
    for (const control of relayOwnedControls) control.disabled = free
    if (free) {
      // The fixed sentinel reads in the key box itself, as plain text: it is
      // public (docs, bundle source) and the relay ignores its value anyway.
      if (key.value !== FREE_API_KEY) keyDraft = key.value
      key.value = FREE_API_KEY
      key.type = 'text'
    } else {
      key.type = 'password'
      if (key.value === FREE_API_KEY) key.value = keyDraft
    }
    // The key line always describes the keystore, never the free sentinel:
    // the key box itself shows the fixed key while free is selected.
    keyLine.textContent = keyLineText()
    recordToggle.checked = free ? true : getRecordOwnChats()
    recordToggle.disabled = free
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
  searchMode.value = state.searchKeyMode
  searchMode.addEventListener('change', () => {
    state.searchKeyMode = searchMode.value
    persistSelection()
  })
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
    const status = el('span', 'ai-search-status', searchStatusText(store))
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
        status.textContent = searchStatusText(store)
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
  // The Web Search heading carries the blanket-grant toggle flush right,
  // labeled just "Allow"; the key rows below keep their own custody mode.
  const websearchHeading = el('h3', 'ai-dialog-subtitle ai-websearch-heading')
  const websearchAllowWrap = el('label', 'ai-websearch-allow-wrap')
  websearchAllowWrap.append(el('span', '', 'Allow'), websearchAllow)
  websearchHeading.append(el('span', '', 'Web search'), websearchAllowWrap)
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
    keyField,
    keepField,
    passphraseField,
    keyActions,
    modelField,
    modelStatus,
    modelInputField,
    visionField,
    apiField,
    effortWrap,
    recordField,
    advanced,
    websearchHeading,
    searchRows,
    field('Keep search keys', searchMode),
    field('Search passphrase', searchPassphrase),
    field('Search provider', websearchProvider),
    footer,
  )
  container.append(dialog)

  let modelsRequest = 0
  // Validated catalog items applied to the free menu, the selection and the
  // capabilities the chat gate reads. Shared by the gear-open load (which
  // clears first, replacing one list with another) and the init refresh
  // (which merges into whatever a later gear load replaces).
  const applyFreeCatalog = (catalog) => {
    const items = Array.isArray(catalog)
      ? catalog.filter((opt) => opt && typeof opt.id === 'string' && typeof opt.model === 'string')
      : []
    if (items.length === 0) return false
    inferenceOptions = items
    for (const o of items) {
      // Keyed by both the option id and the upstream model: the selection
      // names the option id, and a future caller may ask by either.
      if (o.id) modelCapabilities.set(o.id, o.capabilities ?? null)
      if (o.model && o.model !== o.id) modelCapabilities.set(o.model, o.capabilities ?? null)
    }
    // An own-key selection keeps its menu and model; only capabilities are recorded.
    if (!freeActive()) return true
    syncModelControls(items.map((o) => ({ id: o.model, available: o.available })))
    syncFreeModelSelection()
    refreshEffort()
    return true
  }

  // The free catalog is keyless, so it loads at init as well as on gear open:
  // the chat gate reads capabilities per turn, and a user who never opens
  // settings would otherwise leave a vision model without its `view` tool.
  // A failed load is silent here; the gear open reports it in the menu.
  const refreshFreeCatalog = async () => {
    try {
      const res = await fetch(inferenceListUrl(), { headers: { accept: 'application/json' } })
      if (!res.ok) return
      applyFreeCatalog(await res.json())
    } catch {
      // Unreadable catalog at boot: the gear open reports it in the menu.
    }
  }

  const loadModels = async () => {
    const request = ++modelsRequest
    // Free reads the same model menu as every other kind, from the relay's
    // free catalog instead of the provider's list endpoint. No key is needed:
    // the catalog carries no secrets and the turn rides the fixed sentinel.
    if (freeActive()) {
      modelStatus.textContent = 'Loading models…'
      try {
        const res = await fetch(inferenceListUrl(), { headers: { accept: 'application/json' } })
        if (request !== modelsRequest) return
        if (!res.ok) {
          modelStatus.textContent = `Models failed: ${res.status}`
          return
        }
        const body = await res.json()
        if (request !== modelsRequest) return
        modelCapabilities.clear()
        if (!applyFreeCatalog(body)) {
          modelStatus.textContent = 'No free models listed. Add your own key to keep chatting.'
          return
        }
        modelStatus.textContent = ''
      } catch (err) {
        if (request === modelsRequest) modelStatus.textContent = `Models failed: ${err.message}`
      }
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
      modelCapabilities.clear()
      for (const m of models) modelCapabilities.set(m.id, m.capabilities ?? null)
      syncModelControls(models)
      modelStatus.textContent = ''
      refreshEffort()
    } catch (err) {
      if (request === modelsRequest) modelStatus.textContent = `Models failed: ${err.message}`
    }
  }

  const closeDialog = () => {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }
  // The free catalog backs the shared model menu; an unreadable catalog
  // leaves the menu to `loadModels`, which reports the failure there. A free
  // selection whose option vanished keeps its state and fails loudly at turn
  // time (404 from the hook) instead of silently switching providers.
  const refreshFreeOptions = async () => {
    renderProviderOptions()
    applyFreeState()
  }
  gear.addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    loadModels()
    refreshFreeOptions()
    syncVisionToggle()
  })
  closeBtn.addEventListener('click', closeDialog)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog()
  })

  kind.addEventListener('change', () => {
    // `jscad-web` is one provider like the others: the model menu fills from
    // its live catalog and the key stays the fixed sentinel. Every other kind
    // is an own-key provider with a keystore key and an optional base URL.
    if (kind.value === 'jscad-web') {
      state.free = true
      state.kind = 'jscad-web'
      state.model = ''
      modelInput.value = ''
      modelInput.placeholder = modelPlaceholders[state.kind] ?? ''
      modelSelect.innerHTML = ''
      state.baseUrl = ''
      baseUrl.value = ''
      modelCapabilities.clear()
      applyFreeState()
      loadModels()
      return
    }
    state.free = false
    state.inference = ''
    state.kind = kind.value
    state.model = ''
    modelInput.value = ''
    modelInput.placeholder = modelPlaceholders[state.kind] ?? ''
    modelSelect.innerHTML = ''
    modelCapabilities.clear()
    applyFreeState()
    loadModels()
  })
  modelSelect.addEventListener('change', () => {
    state.model = modelSelect.value
    modelInput.value = modelSelect.value
    if (freeActive()) syncInferenceFromModel()
    refreshEffort()
    syncVisionToggle()
  })
  modelInput.addEventListener('change', () => {
    state.model = modelInput.value.trim()
    refreshEffort()
    syncVisionToggle()
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
      keyLine.textContent = keyLineText()
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
  applyFreeState()
  // The chat gate reads capabilities per turn, so the keyless free catalog
  // loads here too — not only when the gear opens — or a user who never opens
  // settings leaves a vision model without its `view` tool. The models.dev
  // vision prune warms the same way when its cache is missing or stale, so a
  // provider-silent model resolves without a settings visit.
  refreshFreeCatalog()
  syncVisionToggle()
  if (!readVisionCache(globalThis.localStorage)) refreshVisionCache()
}
