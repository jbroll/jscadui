// Account panel: gear-gated chat config. The drawer shows one header row
// (sign-in for project sync on the left, gear on the right) plus a Provider
// row; API key, model, base URL, and effort live in the gear dialog.
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

  // Provider row stays visible; everything else lives behind the gear.
  const providerRow = el('div', 'ai-provider-row')
  const kind = el('select', 'ai-input')
  for (const value of KINDS) {
    const option = el('option', '', value)
    option.value = value
    kind.append(option)
  }
  kind.value = state.kind
  providerRow.append(field('Provider', kind))
  container.append(providerRow)

  const dialog = document.createElement('dialog')
  dialog.className = 'ai-settings'

  const modelSelect = el('select', 'ai-input')
  modelSelect.classList.add('ai-model-select')
  const modelInput = textInput(state.model, modelPlaceholders[state.kind] ?? '')
  modelInput.classList.add('ai-model-input')
  const syncModelControls = (models) => {
    modelSelect.innerHTML = ''
    for (const m of models) {
      const option = el('option', '', m.id ?? m)
      option.value = m.id ?? m
      modelSelect.append(option)
    }
    if (state.model) {
      if ([...modelSelect.options].some((o) => o.value === state.model)) modelSelect.value = state.model
      else modelInput.value = state.model
    }
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
  }

  const baseUrl = textInput(state.baseUrl, 'base URL (openai-compatible only)')
  baseUrl.classList.add('ai-base-input')
  const advanced = document.createElement('details')
  advanced.className = 'ai-advanced'
  advanced.append(Object.assign(document.createElement('summary'), { textContent: 'Advanced' }), field('Base URL', baseUrl))

  const key = textInput('', 'sk-...', 'password')
  key.autocomplete = 'off'
  const mode = el('select', 'ai-input')
  for (const value of ['session', 'device', 'synced']) mode.append(Object.assign(el('option'), { value, textContent: value }))
  mode.value = 'session'
  const passphrase = textInput('', 'passphrase (synced mode)', 'password')
  const saveKey = el('button', 'ai-button', 'Save key')
  saveKey.type = 'button'
  const clearKey = el('button', 'ai-button', 'Forget key')
  clearKey.type = 'button'
  const keyLine = el('div', 'ai-session', keyStore.get() ? 'Key set.' : 'No key set.')
  const closeBtn = el('button', 'ai-button', 'Close')
  closeBtn.type = 'button'

  dialog.append(
    field('Model', modelSelect),
    field('Or model id', modelInput),
    effortWrap,
    advanced,
    field('Key', key),
    field('Keep', mode),
    field('Passphrase', passphrase),
    saveKey, clearKey, keyLine, closeBtn,
  )
  container.append(dialog)

  const openDialog = async () => {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    const apiKey = keyStore.get()
    if (!apiKey) return
    try {
      const res = await fetch(modelsUrl(state.kind, state.baseUrl), { headers: authHeaders(state.kind, apiKey) })
      if (!res.ok) return
      const body = await res.json()
      const models = body?.data ?? []
      if (!Array.isArray(models) || models.length === 0) return
      state.capabilities = new Map(models.map((m) => [m.id, m.capabilities ?? null]))
      syncModelControls(models)
      refreshEffort()
    } catch {
      // Offline or relay failure: free-text input keeps the saved value.
    }
  }

  gear.addEventListener('click', openDialog)
  closeBtn.addEventListener('click', () => {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  })

  kind.addEventListener('change', () => {
    state.kind = kind.value
    modelInput.placeholder = modelPlaceholders[state.kind] ?? ''
    state.capabilities = new Map()
    persistSelection()
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
