// Vision flags from data, never from a hardcoded table: the models.dev public
// catalog carries per-provider per-model input modalities, and a manual
// per-model override wins over everything. The catalog is pruned to
// `{provider: {model: hasImage}}` and cached with a timestamp; a failed or
// stale read resolves unknown (null), never text-only, so a lookup miss can
// never silently deny a vision model its `view` tool.

// models.dev serves one bulk document; there is no filtered endpoint, so the
// client prunes what it needs and keeps the prune, not the dump.
export const VISION_CATALOG_URL = 'https://models.dev/api.json'
// localStorage holds the prune, not the 6MB dump: a few KB for the providers
// the app actually serves.
export const VISION_CACHE_KEY = 'jscad-ai.vision-catalog'
export const VISION_OVERRIDE_KEY = 'jscad-ai.vision-overrides'
// A week: model vision flags change on release cadence, not hourly, and every
// refresh is a multi-megabyte download.
export const VISION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const hasImageInput = (entry) => {
  const input = entry && entry.modalities && entry.modalities.input
  return Array.isArray(input) && input.includes('image')
}

// The pruned answer for one provider and model id: true/false when the
// catalog names it, null when it does not (unknown, not text-only).
export const resolveCatalogVision = (catalog, provider, model) => {
  const flagged = catalog && catalog[provider] && catalog[provider][model]
  return typeof flagged === 'boolean' ? flagged : null
}

export const readVisionCache = (storage, now = Date.now()) => {
  try {
    const raw = storage.getItem(VISION_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'number' || !parsed.providers) return null
    if (now - parsed.at > VISION_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

const pruneCatalog = (dump) => {
  const providers = {}
  for (const [provider, entry] of Object.entries(dump ?? {})) {
    const models = entry && entry.models
    if (!models || typeof models !== 'object') continue
    const flagged = {}
    for (const [id, model] of Object.entries(models)) flagged[id] = hasImageInput(model)
    providers[provider] = flagged
  }
  return providers
}

// Refresh the prune from models.dev. Resolves the pruned map, or null when
// the fetch or parse fails — failure is unknown, never text-only.
export const refreshVisionCache = async ({ fetchImpl = fetch, storage = globalThis.localStorage, now = Date.now } = {}) => {
  let dump
  try {
    const res = await fetchImpl(VISION_CATALOG_URL, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    dump = await res.json()
  } catch {
    return null
  }
  const providers = pruneCatalog(dump)
  try {
    storage.setItem(VISION_CACHE_KEY, JSON.stringify({ at: now(), providers }))
  } catch {
    // A full or unavailable store keeps the answer in memory only.
  }
  return providers
}

// A manual per-model force-vision flag: true wins over every other source,
// null/absent leaves the decision to metadata. Only `true` is stored — there
// is no force-text-only, since silent denial is the failure being fixed.
export const readOverride = (storage, model) => {
  try {
    const raw = storage.getItem(VISION_OVERRIDE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed[model] === true ? true : null
  } catch {
    return null
  }
}

export const writeOverride = (storage, model, value) => {
  let parsed = {}
  try {
    parsed = JSON.parse(storage.getItem(VISION_OVERRIDE_KEY) ?? '{}') ?? {}
  } catch {
    parsed = {}
  }
  if (value === true) parsed[model] = true
  else delete parsed[model]
  try {
    if (Object.keys(parsed).length === 0 && storage.removeItem) storage.removeItem(VISION_OVERRIDE_KEY)
    else storage.setItem(VISION_OVERRIDE_KEY, JSON.stringify(parsed))
  } catch {
    // Unavailable store: the override lives for this page only.
  }
}
