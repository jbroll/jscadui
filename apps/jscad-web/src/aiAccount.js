// Account panel: gear-gated chat config. The drawer shows one header row
// (sign-in for project sync on the left, gear on the right) plus a
// provider · model summary; every setting lives in the gear dialog.
// Non-secret selection lives in localStorage; the key itself lives in
// @jscadui/key-store and attaches per request.
import { createKeyStore } from '@jscadui/key-store'
import { relayBaseUrl } from './aiChat.js'
import { effortOptionsForModel } from './aiEffort.js'

const SELECTION_KEY = 'jscad-ai.selection'

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

// The provider config the chat POSTs per turn, or null when incomplete.
// Fail-closed: no key, no model, no turn.
export const getProviderConfig = () => {
  const { kind = 'anthropic', model = '', baseUrl = '', effort = '' } = getSelection()
  const apiKey = keyStore.get()
  if (!apiKey || !model) return null
  return { kind, model, ...(baseUrl ? { baseUrl } : {}), ...(effort ? { effort } : {}), apiKey }
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

const modelPlaceholders = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o', 'opencode-go': 'deepseek-v4-flash', meta: 'muse-spark-1.3' }
const KINDS = ['anthropic', 'openai', 'opencode-go', 'meta']

const authHeaders = (kind, apiKey) =>
  kind === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }

const modelsUrl = (kind, baseUrl) =>
  baseUrl ? `${baseUrl.replace(/\/+$/, '')}/v1/models` : `${relayBaseUrl(kind)}/v1/models`

/**
 * @param {HTMLElement} container
 */
export const initAccount = (container) => {
  const selection = getSelection()
  const state = {
    kind: selection.kind ?? 'anthropic',
    model: selection.model ?? '',
    baseUrl: selection.baseUrl ?? '',
    effort: selection.effort ?? '',
    capabilities: new Map(),
  }
  const persistSelection = () => setSelection({ kind: state.kind, model: state.model, baseUrl: state.baseUrl, ...(state.effort ? { effort: state.effort } : {}) })

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
      sessionLine.textContent = 'Sync is off — chat works with your key.'
      signOut.style.display = 'none'
    }
  }

  signIn.addEventListener('click', async () => {
    const res = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: window.location.origin }),
    })
    const body = await res.json().catch(() => ({}))
    if (body?.url) window.location.assign(body.url)
    else sessionLine.textContent = `Sign-in failed: ${body?.error ?? res.status}`
  })

  signOut.addEventListener('click', async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' }).catch(() => {})
    refreshSession()
  })

  const summary = el('div', 'ai-session ai-summary')
  const refreshSummary = () => {
    summary.textContent = state.model ? `${state.kind} · ${state.model}` : `${state.kind} · no model set`
  }
  container.append(summary)

  const dialog = document.createElement('dialog')
  dialog.className = 'ai-settings'

  const kind = el('select', 'ai-input ai-provider-select')
  for (const value of KINDS) {
    const option = el('option', '', value)
    option.value = value
    kind.append(option)
  }
  kind.value = state.kind

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
  const closeBtn = el('button', 'ai-button', 'Close')
  closeBtn.type = 'button'
  const footer = el('div', 'ai-dialog-footer')
  footer.append(closeBtn)

  dialog.append(
    el('h2', 'ai-dialog-title', 'Chat settings'),
    field('Provider', kind),
    field('API key', key),
    field('Keep', mode),
    field('Passphrase', passphrase),
    keyActions,
    field('Model', modelSelect),
    modelStatus,
    field('Custom model id', modelInput),
    effortWrap,
    advanced,
    footer,
  )
  container.append(dialog)

  let modelsRequest = 0
  const loadModels = async () => {
    const request = ++modelsRequest
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
  gear.addEventListener('click', () => {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    loadModels()
  })
  closeBtn.addEventListener('click', closeDialog)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog()
  })

  kind.addEventListener('change', () => {
    state.kind = kind.value
    state.model = ''
    modelInput.value = ''
    modelInput.placeholder = modelPlaceholders[state.kind] ?? ''
    modelSelect.innerHTML = ''
    state.capabilities = new Map()
    refreshEffort()
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

  refreshEffort()
  refreshSession()
}
