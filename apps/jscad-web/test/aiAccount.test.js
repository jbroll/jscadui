// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvider } from '@jscadui/agent-loop'
import { TOS_VERSION } from '../src/aiConsent.js'
import { relayBaseUrl } from '../src/aiChat.js'

vi.mock('@jscadui/key-store', () => {
  const byKey = new Map()
  const memFor = (key) => ({
    get: () => byKey.get(key) ?? null,
    set: async (k) => {
      byKey.set(key, k)
    },
    clear: () => {
      byKey.set(key, null)
    },
    unlock: async () => {
      byKey.set(key, 'k')
      return 'k'
    },
  })
  return {
    createKeyStore: (opts = {}) => memFor(opts.key ?? 'default'),
  }
})

const loadAccount = async () => import('../src/aiAccount.js')

describe('account header', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 401 }))
  })

  it('shows one header row with sign-in and gear, no account-needed copy', async () => {
    const { initAccount } = await loadAccount()
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/Sign in to Sync/))
    expect(document.querySelector('.ai-gear')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/chat turns need an account/)
  })

  it('returns null provider config without key or model', async () => {
    const { getProviderConfig } = await loadAccount()
    expect(getProviderConfig()).toBeNull()
  })

  it('teaches the fluent API unless the selection names another', async () => {
    const { getChatApi } = await loadAccount()
    expect(getChatApi()).toBe('fluent')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ api: 'modeling' }))
    expect(getChatApi()).toBe('modeling')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ api: 'scad' }))
    expect(getChatApi()).toBe('fluent')
  })

  it('lets the gear dialog choose the API style and stores it in the selection', async () => {
    const { initAccount, getChatApi } = await loadAccount()
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    const fluent = document.querySelector('input[name="ai-api"][value="fluent"]')
    const modeling = document.querySelector('input[name="ai-api"][value="modeling"]')
    expect(fluent.checked).toBe(true)
    expect(modeling.checked).toBe(false)
    modeling.checked = true
    modeling.dispatchEvent(new Event('change'))
    expect(getChatApi()).toBe('modeling')
    expect(JSON.parse(localStorage.getItem('jscad-ai.selection')).api).toBe('modeling')
  })

  it('keeps the chosen API style when another selection field changes', async () => {
    const { initAccount, keyStore } = await loadAccount()
    await keyStore.set('sk-x', 'session')
    globalThis.fetch = modelsFetch({ openai: ['gpt-x'], meta: ['muse-a'] })
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'openai', model: 'gpt-x', api: 'modeling' }))
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    const provider = document.querySelector('.ai-provider-select')
    provider.value = 'meta'
    provider.dispatchEvent(new Event('change'))
    expect(JSON.parse(localStorage.getItem('jscad-ai.selection')).api).toBe('modeling')
  })

  it('does not change the API when the field heading is clicked', async () => {
    const { initAccount, getChatApi } = await loadAccount()
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ api: 'modeling' }))
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    const modeling = document.querySelector('input[name="ai-api"][value="modeling"]')
    expect(modeling.checked).toBe(true)
    const heading = [...document.querySelectorAll('.ai-settings .ai-field-name')].find((n) => n.textContent === 'API style')
    expect(heading).toBeTruthy()
    heading.click()
    expect(modeling.checked).toBe(true)
    expect(getChatApi()).toBe('modeling')
  })

  it('fetches the model list through the relay on dialog open with a key', async () => {
    const { initAccount, keyStore } = await loadAccount()
    await keyStore.set('sk-x', 'session')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'openai', model: 'gpt-x' }))
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/')) return new Response(JSON.stringify({}), { status: 401 })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] }), { headers: { 'content-type': 'application/json' } })
    })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    await vi.waitFor(() => expect(document.querySelector('.ai-model-select').options.length).toBe(2))
    expect(String(globalThis.fetch.mock.calls.find(([u]) => String(u).includes('/v1/models'))[0])).toMatch(/\/api\/relay\/openai\/v1\/models/)
  })

  it('keeps the saved model in free text when the model fetch fails', async () => {
    const { initAccount, keyStore } = await loadAccount()
    await keyStore.set('sk-x', 'session')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'openai', model: 'kept-model' }))
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/')) return new Response(JSON.stringify({}), { status: 401 })
      throw new Error('offline')
    })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    await new Promise((r) => setTimeout(r, 20))
    expect(document.querySelector('.ai-model-input').value).toBe('kept-model')
  })

  const modelsFetch = (byKind) => vi.fn(async (url) => {
    if (String(url).includes('/api/auth/')) return new Response(JSON.stringify({}), { status: 401 })
    const kind = String(url).match(/\/api\/relay\/([^/]+)\//)?.[1]
    const ids = byKind[kind]
    if (!ids) return new Response('nope', { status: 404 })
    return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { headers: { 'content-type': 'application/json' } })
  })

  it('loads the model list as soon as a key is saved', async () => {
    const { initAccount, keyStore } = await loadAccount()
    keyStore.clear()
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'meta' }))
    globalThis.fetch = modelsFetch({ meta: ['muse-spark-1.3', 'muse-spark-1.2'] })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    document.querySelector('.ai-key-input').value = 'sk-meta'
    document.querySelector('.ai-save-key').click()
    await vi.waitFor(() => expect(document.querySelector('.ai-model-select').options.length).toBe(2))
    expect(document.querySelector('.ai-model-status').textContent).toBe('')
  })

  it('reloads the model list when the provider changes', async () => {
    const { initAccount, keyStore } = await loadAccount()
    await keyStore.set('sk-x', 'session')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'openai' }))
    globalThis.fetch = modelsFetch({ openai: ['gpt-x'], meta: ['muse-a', 'muse-b', 'muse-c'] })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    await vi.waitFor(() => expect(document.querySelector('.ai-model-select').options.length).toBe(1))
    const provider = document.querySelector('.ai-provider-select')
    provider.value = 'meta'
    provider.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(document.querySelector('.ai-model-select').options.length).toBe(3))
  })

  it('reports a failed model fetch with its status', async () => {
    const { initAccount, keyStore } = await loadAccount()
    await keyStore.set('sk-x', 'session')
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'meta' }))
    globalThis.fetch = modelsFetch({})
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    await vi.waitFor(() => expect(document.querySelector('.ai-model-status').textContent).toMatch(/404/))
  })

  it('orders the dialog fields provider, key, models, effort', async () => {
    const { initAccount } = await loadAccount()
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    const names = [...document.querySelectorAll('.ai-settings .ai-field-name')].map((n) => n.textContent)
    expect(names).toEqual(['Provider', 'API key', 'Keep', 'Passphrase', 'Model', 'Custom model id', 'API style', 'Effort', 'Save chats', 'Base URL', 'Keep search keys', 'Search passphrase', 'Search provider'])
  })

  it('carries the Allow toggle in the Web Search heading', async () => {
    const { initAccount } = await loadAccount()
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    const heading = document.querySelector('.ai-websearch-heading')
    expect(heading.textContent).toMatch(/Web search/)
    const wrap = heading.querySelector('.ai-websearch-allow-wrap')
    expect(wrap.textContent).toMatch(/Allow/)
    expect(wrap.querySelector('.ai-websearch-allow')).not.toBeNull()
  })

  it('saves and clears search keys per provider with no search network traffic', async () => {
    const { initAccount, searchStores } = await loadAccount()
    for (const store of Object.values(searchStores)) store.clear()
    const calls = []
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push([String(url), init])
      return new Response(JSON.stringify({}), { status: 401 })
    })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    const row = document.querySelector('[data-search-provider="tavily"]')
    expect(row).toBeTruthy()
    expect(row.querySelector('.ai-search-status').textContent).toMatch(/keyless/)
    row.querySelector('.ai-search-key-input').value = 'tvly-x'
    row.querySelector('.ai-search-save').click()
    await vi.waitFor(() => expect(row.querySelector('.ai-search-status').textContent).toMatch(/key set/))
    expect(searchStores.tavily.get()).toBe('tvly-x')
    expect(searchStores.exa.get()).toBeNull()
    expect(calls.filter(([url]) => /exa|parallel|firecrawl|tavily|tinyfish|mcp/i.test(url))).toEqual([])
    row.querySelector('.ai-search-clear').click()
    expect(searchStores.tavily.get()).toBeNull()
    expect(row.querySelector('.ai-search-status').textContent).toMatch(/keyless/)
  })

  it('persists the websearch blanket toggle and notifies the live chat', async () => {
    const { initAccount } = await loadAccount()
    const granted = []
    localStorage.removeItem('jscad-ai.selection')
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { onWebsearchGrant: (on) => granted.push(on) })
    document.querySelector('.ai-gear').click()
    const toggle = document.querySelector('.ai-websearch-allow')
    expect(toggle.checked).toBe(false)
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    expect(JSON.parse(localStorage.getItem('jscad-ai.selection')).websearch.allow).toBe(true)
    expect(granted).toEqual([true])
  })

  it('sends the current URL, hash included, as the sign-in callback', async () => {
    const { initAccount } = await loadAccount()
    window.location.hash = '#gear'
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'))
    const signIn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign in to Sync')
    signIn.click()
    await vi.waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/api/auth/sign-in/social'))).toBe(true))
    const call = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('/api/auth/sign-in/social'))
    expect(JSON.parse(call[1].body).callbackURL).toBe(window.location.href)
    window.location.hash = ''
  })

  it('asks before the sign-in redirect when local work exists, and aborting skips the request', async () => {
    const { initAccount } = await loadAccount()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { hasLocalWork: () => true })
    const signIn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign in to Sync')
    signIn.click()
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/api/auth/sign-in/social'))).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('signs in without asking when no local work is at risk', async () => {
    const { initAccount } = await loadAccount()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { hasLocalWork: () => false })
    const signIn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign in to Sync')
    signIn.click()
    await vi.waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/api/auth/sign-in/social'))).toBe(true))
    expect(confirm).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('warns on unload when local work exists, and stays quiet otherwise', async () => {
    const { initAccount } = await loadAccount()
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { hasLocalWork: () => true })
    const warn = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(warn)
    expect(warn.defaultPrevented).toBe(true)
    initAccount(document.getElementById('a'), { hasLocalWork: () => false })
    const quiet = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(quiet)
    expect(quiet.defaultPrevented).toBe(false)
  })

  it('asks once: the sign-in redirect silences the native unload prompt', async () => {
    const { initAccount } = await loadAccount()
    vi.stubGlobal('confirm', vi.fn(() => true))
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/get-session')) return new Response(JSON.stringify({}), { status: 401 })
      return new Response(JSON.stringify({ url: 'https://accounts.example/continue' }), { status: 200 })
    })
    const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { href: window.location.href, origin: window.location.origin, assign },
      configurable: true,
      writable: true,
    })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { hasLocalWork: () => true })

    const armed = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(armed)
    expect(armed.defaultPrevented).toBe(true)

    const signIn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign in to Sync')
    signIn.click()
    await vi.waitFor(() => expect(assign).toHaveBeenCalled())

    const redirected = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(redirected)
    expect(redirected.defaultPrevented).toBe(false)
    Object.defineProperty(window, 'location', originalLocation)
    vi.unstubAllGlobals()
  })

  it('calls onSignOut after a successful sign-out', async () => {
    const { initAccount } = await loadAccount()
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/get-session')) return new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }), { status: 200 })
      return new Response('{}', { status: 200 })
    })
    document.body.innerHTML = '<div id="a"></div>'
    const onSignOut = vi.fn()
    initAccount(document.getElementById('a'), { onSignOut })
    const signOutBtn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign out')
    await vi.waitFor(() => expect(signOutBtn.style.display).toBe(''))
    signOutBtn.click()
    await vi.waitFor(() => expect(onSignOut).toHaveBeenCalled())
  })

  it('awaits onSignOut before refreshing the session', async () => {
    const { initAccount } = await loadAccount()
    let releaseSignOut
    const onSignOut = vi.fn(() => new Promise((resolve) => { releaseSignOut = resolve }))
    let sessionCalls = 0
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/get-session')) {
        sessionCalls++
        return new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.c' } }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    document.body.innerHTML = '<div id="a"></div>'
    initAccount(document.getElementById('a'), { onSignOut })
    const signOutBtn = [...document.querySelectorAll('.ai-header-row .ai-button')].find((b) => b.textContent === 'Sign out')
    await vi.waitFor(() => expect(signOutBtn.style.display).toBe(''))
    const before = sessionCalls
    signOutBtn.click()
    await vi.waitFor(() => expect(onSignOut).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    // The refresh is a second get-session; it must wait for the teardown.
    expect(sessionCalls).toBe(before)
    releaseSignOut()
    await vi.waitFor(() => expect(sessionCalls).toBeGreaterThan(before))
  })
})

describe('free provider', () => {
  // The relay's jscad-web catalog: one usable option and one out of monthly budget.
  const INFERENCE = [
    { id: 'deepseek', label: 'DeepSeek v4 flash', kind: 'opencode-go', model: 'deepseek-v4.1-flash', available: true },
    { id: 'muse', label: 'Muse Spark 1.3', kind: 'meta', model: 'muse-spark-1.3', available: false },
  ]
  const CATALOG_URL = '/api/relay/jscad-web/v1/models'

  const inferenceFetch = (options, models = []) => vi.fn(async (url) => {
    if (String(url).includes('/api/auth/')) return new Response(JSON.stringify({}), { status: 401 })
    if (String(url).includes(CATALOG_URL)) return new Response(JSON.stringify(options), { headers: { 'content-type': 'application/json' } })
    if (String(url).includes('/v1/models')) return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }), { headers: { 'content-type': 'application/json' } })
    return new Response('{}', { status: 404 })
  })

  // Opens the gear dialog and waits for the single jscad-web provider row.
  const openGear = async (fetchImpl) => {
    globalThis.fetch = fetchImpl
    document.body.innerHTML = '<div id="a"></div>'
    const account = await loadAccount()
    account.initAccount(document.getElementById('a'))
    document.querySelector('.ai-gear').click()
    await vi.waitFor(() => {
      expect(document.querySelector('.ai-provider-select option[value="jscad-web"]')).not.toBeNull()
    })
    return account
  }

  // Selects a provider, then waits for the model menu to offer `modelValue`.
  const selectProvider = async (kind, modelValue) => {
    const select = document.querySelector('.ai-provider-select')
    select.value = kind
    select.dispatchEvent(new Event('change'))
    await vi.waitFor(() => {
      expect([...document.querySelectorAll('.ai-model-select option')].some((o) => o.value === modelValue)).toBe(true)
    })
  }

  const selectFree = (modelValue = 'deepseek-v4.1-flash') => selectProvider('jscad-web', modelValue)

  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }))
  })

  it('offers jscad-web as one provider row', async () => {
    await openGear(inferenceFetch(INFERENCE))
    const values = [...document.querySelectorAll('.ai-provider-select option')].map((o) => o.value)
    expect(values.filter((v) => v === 'jscad-web')).toHaveLength(1)
    expect(values.some((v) => v.startsWith('jscad-web:'))).toBe(false)
  })

  it('lists the catalog models in the shared model menu', async () => {
    await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    const rows = [...document.querySelectorAll('.ai-model-select option')]
    expect(rows.map((o) => o.textContent)).toContain('DeepSeek v4 flash')
    const muse = rows.find((o) => o.value === 'muse-spark-1.3')
    expect(muse.disabled).toBe(true)
    expect(muse.textContent).toBe('Muse Spark 1.3 (monthly limit reached)')
  })

  it('persists a free selection and returns the sentinel-key config', async () => {
    const { getProviderConfig } = await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    expect(JSON.parse(localStorage.getItem('jscad-ai.selection'))).toMatchObject({ kind: 'jscad-web', model: 'deepseek-v4.1-flash', inference: 'deepseek', free: true })
    expect(getProviderConfig()).toMatchObject({ kind: 'jscad-web', model: 'deepseek-v4.1-flash', apiKey: 'jscad-web-free', inference: 'deepseek', free: true })
  })

  it('switches free models in the model menu and re-pins the route', async () => {
    const both = INFERENCE.map((o) => ({ ...o, available: true }))
    const { getProviderConfig } = await openGear(inferenceFetch(both))
    await selectFree()
    const menu = document.querySelector('.ai-model-select')
    menu.value = 'muse-spark-1.3'
    menu.dispatchEvent(new Event('change'))
    expect(JSON.parse(localStorage.getItem('jscad-ai.selection'))).toMatchObject({ kind: 'jscad-web', model: 'muse-spark-1.3', inference: 'muse', free: true })
    expect(getProviderConfig()).toMatchObject({ inference: 'muse' })
  })

  it('routes a free turn to the jscad-web free base with the sentinel key', async () => {
    const { getProviderConfig } = await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      window.localStorage.removeItem('jscad-ai.relay')
      const config = getProviderConfig()
      const provider = createProvider({ ...config, baseUrl: relayBaseUrl(config) })
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
      expect(fetchMock.mock.calls[0][0]).toBe('https://jscad.rkroll.com/api/relay/jscad-web/deepseek/v1/chat/completions')
      expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer jscad-web-free')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails closed for a free record with no model', async () => {
    const { getProviderConfig } = await loadAccount()
    localStorage.setItem('jscad-ai.selection', JSON.stringify({ kind: 'jscad-web', free: true, inference: 'deepseek' }))
    expect(getProviderConfig()).toBeNull()
  })

  it('disables the relay-owned controls for free, keeping them visible', async () => {
    await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    const fieldNamed = (name) => [...document.querySelectorAll('.ai-settings .ai-field')].find((f) => f.querySelector('.ai-field-name')?.textContent === name)
    const relayOwned = () => [
      document.querySelector('.ai-key-input'),
      fieldNamed('Keep').querySelector('select'),
      fieldNamed('Passphrase').querySelector('input'),
      document.querySelector('.ai-save-key'),
      fieldNamed('Keep').closest('.ai-settings').querySelector('.ai-actions button:not(.ai-save-key)'),
      document.querySelector('.ai-model-input'),
      document.querySelector('.ai-base-input'),
    ]
    for (const control of relayOwned()) expect(control.disabled).toBe(true)
    // The model menu stays enabled: it lists the live catalog like any kind.
    expect(document.querySelector('.ai-model-select').disabled).toBe(false)
    expect(document.querySelector('.ai-key-input').closest('.ai-field').style.display).toBe('')
    expect(document.querySelector('.ai-model-select').closest('.ai-field').style.display).toBe('')
    expect(document.querySelector('.ai-model-input').closest('.ai-field').style.display).toBe('')
    expect(document.querySelector('.ai-advanced').style.display).toBe('')
    expect(document.querySelector('.ai-free-info')).toBeNull()
  })

  it('shows the fixed sentinel in the key box for free and restores the draft after', async () => {
    await openGear(inferenceFetch(INFERENCE))
    const provider = document.querySelector('.ai-provider-select')
    provider.value = 'openai'
    provider.dispatchEvent(new Event('change'))
    document.querySelector('.ai-key-input').value = 'sk-draft'
    await selectFree()
    const box = document.querySelector('.ai-key-input')
    expect(box.value).toBe('jscad-web-free')
    expect(box.type).toBe('text')
    provider.value = 'openai'
    provider.dispatchEvent(new Event('change'))
    expect(box.value).toBe('sk-draft')
    expect(box.type).toBe('password')
  })

  it('re-enables the relay-owned controls on switching back to an own-key provider', async () => {
    await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    const fieldNamed = (name) => [...document.querySelectorAll('.ai-settings .ai-field')].find((f) => f.querySelector('.ai-field-name')?.textContent === name)
    const relayOwned = () => [
      document.querySelector('.ai-key-input'),
      fieldNamed('Keep').querySelector('select'),
      fieldNamed('Passphrase').querySelector('input'),
      document.querySelector('.ai-save-key'),
      fieldNamed('Keep').closest('.ai-settings').querySelector('.ai-actions button:not(.ai-save-key)'),
      document.querySelector('.ai-model-select'),
      document.querySelector('.ai-model-input'),
      document.querySelector('.ai-base-input'),
    ]
    expect(relayOwned().every((control) => control.disabled)).toBe(false)
    const provider = document.querySelector('.ai-provider-select')
    provider.value = 'jscad-web'
    provider.dispatchEvent(new Event('change'))
    await vi.waitFor(() => {
      expect([...document.querySelectorAll('.ai-model-select option')].some((o) => o.value === 'deepseek-v4.1-flash')).toBe(true)
    })
    expect(document.querySelector('.ai-model-input').disabled).toBe(true)
    expect(document.querySelector('.ai-model-select').disabled).toBe(false)
    provider.value = 'openai'
    provider.dispatchEvent(new Event('change'))
    expect(relayOwned().every((control) => control.disabled)).toBe(false)
  })

  it('reads the provider model list for free from the relay catalog, not a key', async () => {
    const account = await loadAccount()
    await account.keyStore.set('sk-x', 'session')
    await openGear(inferenceFetch(INFERENCE, ['gpt-x']))
    await vi.waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/v1/models'))).toBe(true))
    await selectFree()
    await vi.waitFor(() => expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes(CATALOG_URL))).toBe(true))
    const ownList = ([url]) => String(url).includes('/v1/models') && !String(url).includes(CATALOG_URL)
    expect(globalThis.fetch.mock.calls.filter(ownList)).toHaveLength(1)
  })

  it('mirrors the recording choice into both storage keys', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 1, recordOwnChats: true }))
    await openGear(inferenceFetch(INFERENCE))
    const toggle = document.querySelector('.ai-record-toggle')
    expect(toggle.checked).toBe(true)
    toggle.checked = false
    toggle.dispatchEvent(new Event('change'))
    expect(localStorage.getItem('jscad-ai.log')).toBe('off')
    expect(JSON.parse(localStorage.getItem('jscad-ai.tos')).recordOwnChats).toBe(false)
    toggle.checked = true
    toggle.dispatchEvent(new Event('change'))
    expect(localStorage.getItem('jscad-ai.log')).toBeNull()
    expect(JSON.parse(localStorage.getItem('jscad-ai.tos')).recordOwnChats).toBe(true)
  })

  it('shows the .tos recording choice when a divergent log mirror disagrees', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 1, recordOwnChats: false }))
    localStorage.removeItem('jscad-ai.log')
    await openGear(inferenceFetch(INFERENCE))
    expect(document.querySelector('.ai-record-toggle').checked).toBe(false)
  })

  it('shows the .tos recording choice when the mirror opts out instead', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 1, recordOwnChats: true }))
    localStorage.setItem('jscad-ai.log', 'off')
    await openGear(inferenceFetch(INFERENCE))
    expect(document.querySelector('.ai-record-toggle').checked).toBe(true)
  })

  it('locks the recording checkbox on and checked for free', async () => {
    await openGear(inferenceFetch(INFERENCE))
    await selectFree()
    const toggle = document.querySelector('.ai-record-toggle')
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(true)
  })

  it('keeps the jscad-web row but fails closed when the catalog cannot be read', async () => {
    const failing = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/')) return new Response(JSON.stringify({}), { status: 401 })
      if (String(url).includes(CATALOG_URL)) throw new Error('offline')
      return new Response('{}', { status: 404 })
    })
    const { getProviderConfig } = await openGear(failing)
    expect(document.querySelector('.ai-provider-select option[value="jscad-web"]')).not.toBeNull()
    const provider = document.querySelector('.ai-provider-select')
    provider.value = 'jscad-web'
    provider.dispatchEvent(new Event('change'))
    await vi.waitFor(() => {
      expect(document.querySelector('.ai-model-status').textContent).toMatch(/Models failed/)
    })
    expect(document.querySelectorAll('.ai-model-select option')).toHaveLength(0)
    expect(getProviderConfig()).toBeNull()
  })
})

describe('aiEffort', () => {
  it('drives anthropic options from capabilities and excludes none for muse', async () => {
    const { effortOptionsForModel, OPENAI_STYLE_EFFORTS } = await import('../src/aiEffort.js')
    expect(effortOptionsForModel({
      kind: 'anthropic',
      modelId: 'x',
      capabilities: { effort: { low: { supported: true }, medium: { supported: true }, high: { supported: false }, xhigh: { supported: false }, max: { supported: false } } },
    })).toEqual(['low', 'medium'])
    expect(effortOptionsForModel({ kind: 'openai', modelId: 'gpt-x', capabilities: null })).toEqual(OPENAI_STYLE_EFFORTS)
    expect(effortOptionsForModel({ kind: 'meta', modelId: 'muse-spark-1.3', capabilities: null })).not.toContain('none')
  })
})
