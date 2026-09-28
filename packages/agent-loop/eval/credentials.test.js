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
})
