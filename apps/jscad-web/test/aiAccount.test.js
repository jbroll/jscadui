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
