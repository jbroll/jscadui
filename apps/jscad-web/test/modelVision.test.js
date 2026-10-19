// modelVision: resolve whether a model reads images from the models.dev
// catalog (pruned and cached) with a manual per-model override winning.
import { describe, expect, it, vi } from 'vitest'
import { readVisionCache, resolveCatalogVision, refreshVisionCache, readOverride, writeOverride } from '../src/modelVision.js'

const entry = (input) => ({ modalities: { input, output: ['text'] } })

const catalog = {
  'opencode-go': {
    'longcat-2.5-preview-free': true,
    'longcat-2.0': false,
  },
}

describe('resolveCatalogVision', () => {
  it('reads image support from a pruned provider catalog', () => {
    expect(resolveCatalogVision(catalog, 'opencode-go', 'longcat-2.5-preview-free')).toBe(true)
    expect(resolveCatalogVision(catalog, 'opencode-go', 'longcat-2.0')).toBe(false)
    expect(resolveCatalogVision(catalog, 'opencode-go', 'no-such-model')).toBeNull()
    expect(resolveCatalogVision(null, 'opencode-go', 'longcat-2.5-preview-free')).toBeNull()
  })
})

describe('vision cache', () => {
  it('prunes a models.dev dump to provider model image flags', async () => {
    const dump = {
      'opencode-go': { models: { 'longcat-2.5-preview-free': entry(['text', 'image']), 'longcat-2.0': entry(['text']) } },
      'other-provider': { models: { 'x': entry(['text', 'image']) } },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(dump)))
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    const pruned = await refreshVisionCache({ fetchImpl, storage, now: () => 1000 })
    expect(pruned).toEqual({ 'opencode-go': { 'longcat-2.5-preview-free': true, 'longcat-2.0': false }, 'other-provider': { x: true } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(readVisionCache(storage, 1000 + 1).providers).toEqual(pruned)
  })

  it('serves a fresh cache without fetching', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('must not fetch') })
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    await refreshVisionCache({ fetchImpl: async () => new Response(JSON.stringify({})), storage, now: () => 0 })
    expect(readVisionCache(storage, 0).providers).toEqual({})
    void fetchImpl
  })

  it('treats a failed refresh as unknown, never as text-only', async () => {
    const storage = { getItem: () => null, setItem: () => {} }
    await expect(
      refreshVisionCache({ fetchImpl: async () => new Response('nope', { status: 500 }), storage, now: () => 0 }),
    ).resolves.toBeNull()
  })
})

describe('manual override', () => {
  it('persists a per-model force-vision flag', () => {
    const store = new Map()
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }
    expect(readOverride(storage, 'longcat-2.5-preview-free')).toBeNull()
    writeOverride(storage, 'longcat-2.5-preview-free', true)
    expect(readOverride(storage, 'longcat-2.5-preview-free')).toBe(true)
    writeOverride(storage, 'longcat-2.5-preview-free', null)
    expect(readOverride(storage, 'longcat-2.5-preview-free')).toBeNull()
  })
})
