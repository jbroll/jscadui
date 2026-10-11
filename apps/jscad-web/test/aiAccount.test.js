// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@jscadui/key-store', () => {
  let mem = null
  return {
    createKeyStore: () => ({
      get: () => mem,
      set: async (k) => { mem = k },
      clear: () => { mem = null },
      unlock: async () => { mem = 'k'; return mem },
    }),
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
    expect(document.querySelector('.ai-model-status').textContent).toMatch(/2 models/)
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
    expect(names).toEqual(['Provider', 'API key', 'Keep', 'Passphrase', 'Model', 'Custom model id', 'Effort', 'Base URL'])
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
