import { describe, expect, it, vi } from 'vitest'
import { resolveCredentials } from './credentials.js'

describe('resolveCredentials', () => {
  it('uses EVAL_API_KEY without reading the auth file', () => {
    const readAuth = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta', EVAL_API_KEY: 'k', EVAL_BASE_URL: 'https://b' }, readAuth)).toEqual({ apiKey: 'k', baseUrl: 'https://b' })
    expect(readAuth).not.toHaveBeenCalled()
  })

  it('reads the meta key and base URL from the muse auth file, without its /v1', () => {
    const readAuth = () => ({ providers: { meta: { api_key: 'secret', api_base_url: 'https://api.meta.ai/v1' } } })
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta' }, readAuth)).toEqual({ apiKey: 'secret', baseUrl: 'https://api.meta.ai' })
  })

  it('leaves the key unset when the auth file is missing', () => {
    const readAuth = () => {
      throw new Error('ENOENT')
    }
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta' }, readAuth).apiKey).toBeUndefined()
  })

  it('never reads the auth file for other providers', () => {
    const readAuth = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'openai' }, readAuth).apiKey).toBeUndefined()
    expect(readAuth).not.toHaveBeenCalled()
  })

  it('reads the opencode-go key from the opencode auth file', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' }, meta: { type: 'api', key: 'meta-secret' } })
    const readKeys = () => ({})
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys)).toEqual({ apiKey: 'oc-secret', baseUrl: undefined })
  })

  it('uses EVAL_API_KEY for opencode-go without reading the auth file', () => {
    const readAuth = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go', EVAL_API_KEY: 'k' }, readAuth)).toEqual({ apiKey: 'k', baseUrl: undefined })
    expect(readAuth).not.toHaveBeenCalled()
  })

  it('leaves the opencode-go key unset when its auth file is missing', () => {
    const readAuth = () => {
      throw new Error('ENOENT')
    }
    const readKeys = () => ({})
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys).apiKey).toBeUndefined()
  })

  it('lets EVAL_BASE_URL override the opencode-go default base', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' } })
    const readKeys = () => ({})
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go', EVAL_BASE_URL: 'https://b' }, readAuth, readKeys)).toEqual({ apiKey: 'oc-secret', baseUrl: 'https://b' })
  })

  it('prefers the keys.json key over the opencode auth file', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' } })
    const readKeys = () => ({ 'opencode-go': 'jscad-chat-secret' })
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys).apiKey).toBe('jscad-chat-secret')
  })

  it('prefers the meta keys.json key over the muse auth file', () => {
    const readAuth = () => ({ providers: { meta: { api_key: 'secret', api_base_url: 'https://api.meta.ai/v1' } } })
    const readKeys = () => ({ meta: 'jscad-chat-meta-secret' })
    expect(resolveCredentials({ EVAL_PROVIDER: 'meta' }, readAuth, readKeys)).toEqual({ apiKey: 'jscad-chat-meta-secret', baseUrl: 'https://api.meta.ai' })
  })

  it('falls through silently when keys.json is missing or unreadable', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' } })
    const readKeys = () => {
      throw new Error('ENOENT')
    }
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys).apiKey).toBe('oc-secret')
  })

  it('falls through silently when keys.json has no entry for the provider', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' } })
    const readKeys = () => ({ meta: 'unrelated' })
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys).apiKey).toBe('oc-secret')
  })

  it('EVAL_API_KEY still wins over keys.json', () => {
    const readAuth = vi.fn()
    const readKeys = vi.fn()
    expect(resolveCredentials({ EVAL_PROVIDER: 'opencode-go', EVAL_API_KEY: 'k' }, readAuth, readKeys)).toEqual({ apiKey: 'k', baseUrl: undefined })
    expect(readAuth).not.toHaveBeenCalled()
    expect(readKeys).not.toHaveBeenCalled()
  })

  it('warns on stderr when opencode-go falls back to the opencode auth file', () => {
    const readAuth = () => ({ 'opencode-go': { type: 'api', key: 'oc-secret' } })
    const readKeys = () => ({})
    const warn = vi.fn()
    resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys, warn)
    expect(warn).toHaveBeenCalledWith('run-eval: using the opencode auth.json key; put the jscad-chat key in ~/.config/jscad-chat/keys.json')
  })

  it('does not warn when the opencode-go key comes from keys.json', () => {
    const readAuth = vi.fn()
    const readKeys = () => ({ 'opencode-go': 'jscad-chat-secret' })
    const warn = vi.fn()
    resolveCredentials({ EVAL_PROVIDER: 'opencode-go' }, readAuth, readKeys, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(readAuth).not.toHaveBeenCalled()
  })

  it('does not warn when EVAL_API_KEY is set', () => {
    const warn = vi.fn()
    resolveCredentials({ EVAL_PROVIDER: 'opencode-go', EVAL_API_KEY: 'k' }, vi.fn(), vi.fn(), warn)
    expect(warn).not.toHaveBeenCalled()
  })
})
