// Account panel: session (Google sign-in/out), model selection, and provider
// key custody. Non-secret selection lives in localStorage; the key itself
// lives in @jscadui/key-store and attaches per request. Nothing here sends
// the key anywhere but the API request body.
import { createKeyStore } from '@jscadui/key-store'

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
  const { kind = 'anthropic', model = '', baseUrl = '' } = getSelection()
  const apiKey = keyStore.get()
  if (!apiKey || !model) return null
  return { kind, model, ...(baseUrl ? { baseUrl } : {}), apiKey }
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

/**
 * @param {HTMLElement} container
 */
export const initAccount = (container) => {
  container.append(el('h3', 'ai-section-title', 'Account'))
  const sessionLine = el('div', 'ai-session', 'Checking session...')
  const signIn = el('button', 'ai-button', 'Sign in with Google')
  signIn.type = 'button'
  const signOut = el('button', 'ai-button', 'Sign out')
  signOut.type = 'button'
  signOut.style.display = 'none'
  container.append(sessionLine, signIn, signOut)

  const refreshSession = async () => {
    const user = await getSession()
    if (user) {
      sessionLine.textContent = `Signed in as ${user.email ?? user.name ?? 'user'}`
      signIn.style.display = 'none'
      signOut.style.display = ''
    } else {
      sessionLine.textContent = 'Not signed in — chat turns need an account.'
      signIn.style.display = ''
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

  container.append(el('h3', 'ai-section-title', 'Model'))
  const modelPlaceholders = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o', 'opencode-go': 'deepseek-v4-flash' }
  const selection = getSelection()
  const kind = el('select', 'ai-input')
  for (const value of ['anthropic', 'openai', 'opencode-go']) {
    const option = el('option', '', value)
    option.value = value
    kind.append(option)
  }
  kind.value = selection.kind ?? 'anthropic'
  const model = textInput(selection.model ?? '', modelPlaceholders[selection.kind] ?? 'claude-sonnet-4-5')
  kind.addEventListener('change', () => {
    model.placeholder = modelPlaceholders[kind.value] ?? ''
  })
  const baseUrl = textInput(selection.baseUrl ?? '', 'base URL (openai-compatible only)')
  container.append(field('Provider', kind), field('Model', model), field('Base URL', baseUrl))

  container.append(el('h3', 'ai-section-title', 'API key'))
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
  container.append(field('Key', key), field('Keep', mode), field('Passphrase', passphrase), saveKey, clearKey, keyLine)

  const persistSelection = () => setSelection({ kind: kind.value, model: model.value.trim(), baseUrl: baseUrl.value.trim() })
  kind.addEventListener('change', persistSelection)
  model.addEventListener('change', persistSelection)
  baseUrl.addEventListener('change', persistSelection)

  saveKey.addEventListener('click', async () => {
    try {
      if (!key.value) {
        // No new key typed: unlock a stored synced key instead.
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

  refreshSession()
}
