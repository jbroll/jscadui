// jscad-web inference provider config: the free models we serve on
// server-held keys, validated at load. Their conversations are shared back for
// improvements. Plain JS + JSDoc like policy.js, so production `node` loads it
// and tsc (allowJs/checkJs) type-checks and emits it into dist/.
import { readFileSync } from 'node:fs'

export const DEFAULT_INFERENCE_PATH = '/etc/jscad-relay/jscad-inference.json'
// Phase 1 defaults: $5 per calendar month across all free models, $0.10 per
// day per IP group. The operator's file overrides both.
export const DEFAULT_MONTHLY_USD = 5
export const DEFAULT_PER_IP_DAILY_USD = 0.1

/** @typedef {{ id: string, kind: string, path: string, model: string, key: string, maxTokens: number, inputUsdPerMTok: number, outputUsdPerMTok: number }} InferenceOption */
/** @typedef {{ monthlyUsd: number, perIpDailyUsd: number, options: InferenceOption[] }} InferenceConfig */

// Mirrors RESPONSES_MODELS / MESSAGES_MODELS in
// packages/agent-loop/src/providers.js; inference.test.ts pins the copies equal,
// so a routing change cannot silently drift the endpoint a free option may use.
// MESSAGES_MODELS is mirrored only to refuse those models: the inference relay
// injects a bearer key and cannot serve the messages protocol (see
// expectedPathFor).
export const RESPONSES_MODELS = new Set([
  'grok-4.6',
  'gpt-5.6-luna',
  'muse-spark-1.3-contributor',
  'muse-spark-1.2-contributor',
  'muse-spark-1.3',
])
export const MESSAGES_MODELS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
])

// These kinds' chat-completions and responses endpoints take
// `authorization: Bearer`, which is the only credential the relay injects; a
// free option's key is used nowhere else, so nothing else may appear in the
// operator's file.
export const INFERENCE_KINDS = new Set(['opencode-go', 'meta'])

/**
 * The one endpoint a kind and model use in agent-loop, or null for a kind that
 * cannot serve a free option and for the messages protocol, which needs
 * `x-api-key` + `anthropic-version` and a body the relay does not rewrite.
 * @param {string} kind
 * @param {string} model
 * @returns {string | null}
 */
export const expectedPathFor = (kind, model) => {
  if (!INFERENCE_KINDS.has(kind)) return null
  if (MESSAGES_MODELS.has(model)) return null
  if (RESPONSES_MODELS.has(model)) return 'v1/responses'
  return 'v1/chat/completions'
}

/**
 * @param {string} label names the file in errors
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
const budget = (label, value, name) => {
  if (value === undefined) return name === 'monthlyUsd' ? DEFAULT_MONTHLY_USD : DEFAULT_PER_IP_DAILY_USD
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`relay: inference config ${label} '${name}' must be a number >= 0`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {string} where
 * @returns {string}
 */
const requireString = (value, name, where) => {
  if (typeof value !== 'string' || value === '') throw new Error(`relay: inference ${where} '${name}' must be a non-empty string`)
  return value
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {string} where
 * @returns {number}
 */
const requirePrice = (value, name, where) => {
  // Zero is a real price: a free model charges nothing. Null, missing,
  // negative and non-numeric stay refused, so an unfilled template cannot
  // silently forward.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`relay: inference ${where} '${name}' must be a non-negative per-million-token price`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {number}
 */
const requireMaxTokens = (value, where) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`relay: inference ${where} 'maxTokens' must be a positive integer`)
  }
  return value
}

/**
 * Parses one model entry inside a provider. The model slug is the entry's
 * whole identity: it names the route, the pinned upstream model, and the menu
 * row. The endpoint path is derived from kind and model via expectedPathFor,
 * never taken from the file, so the operator cannot pin an endpoint the model
 * does not use.
 * @param {unknown} value
 * @param {string} where
 * @param {Set<string>} seen
 * @param {string} kind
 * @param {string} key
 * @returns {InferenceOption}
 */
const parseModel = (value, where, seen, kind, key) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`relay: inference ${where} must be an object`)
  }
  const raw = /** @type {Record<string, unknown>} */ (value)
  const model = requireString(raw.model, 'model', where)
  if (seen.has(model)) throw new Error(`relay: inference ${where} duplicate model '${model}'`)
  seen.add(model)
  const expected = expectedPathFor(kind, model)
  // `kind` is already an inference kind, so a null expectation means the model
  // needs the messages protocol, which a bearer key cannot serve.
  if (expected === null) {
    throw new Error(`relay: inference ${where} cannot serve model '${model}': the inference relay only injects keys for chat-completions and responses models`)
  }
  return {
    id: model,
    kind,
    path: expected,
    model,
    key,
    maxTokens: requireMaxTokens(raw.maxTokens, where),
    inputUsdPerMTok: requirePrice(raw.inputUsdPerMTok, 'inputUsdPerMTok', where),
    outputUsdPerMTok: requirePrice(raw.outputUsdPerMTok, 'outputUsdPerMTok', where),
  }
}

/**
 * Parses one provider: one kind, one server-held key, and the models that
 * key serves. Extra fields are ignored.
 * @param {unknown} value
 * @param {string} where
 * @param {Set<string>} seen models across the whole file: the slug is the
 * route id, so listing one model twice is a duplicate
 * @returns {InferenceOption[]}
 */
const parseProvider = (value, where, seen) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`relay: inference ${where} must be an object`)
  }
  const raw = /** @type {Record<string, unknown>} */ (value)
  const kind = requireString(raw.kind, 'kind', where)
  if (!INFERENCE_KINDS.has(kind)) {
    throw new Error(`relay: inference ${where} kind '${kind}' must be one of ${[...INFERENCE_KINDS].join(', ')}`)
  }
  const key = requireString(raw.key, 'key', where)
  const modelsRaw = raw.models ?? []
  if (!Array.isArray(modelsRaw)) throw new Error(`relay: inference ${where} 'models' must be an array`)
  return modelsRaw.map((m, i) => parseModel(m, `${where} model ${i}`, seen, kind, key))
}

/**
 * Parses an inference config's text. Throws on anything the operator must fix;
 * the route that reads it never forwards on an unparsable file.
 * @param {string} raw
 * @param {string} label
 * @returns {InferenceConfig}
 */
export const parseInferenceConfig = (raw, label) => {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`relay: inference config ${label} is not valid JSON`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`relay: inference config ${label} must be an object`)
  }
  const body = /** @type {Record<string, unknown>} */ (parsed)
  const providersRaw = body.providers ?? []
  if (!Array.isArray(providersRaw)) throw new Error(`relay: inference config ${label} 'providers' must be an array`)
  const seen = new Set()
  return {
    monthlyUsd: budget(label, body.monthlyUsd, 'monthlyUsd'),
    perIpDailyUsd: budget(label, body.perIpDailyUsd, 'perIpDailyUsd'),
    options: providersRaw.flatMap((p, i) => parseProvider(p, `${label} provider ${i}`, seen)),
  }
}

/**
 * Reads the inference config. A missing file means no free options; any other
 * read or parse failure throws, since a bad file must not silently forward.
 * @param {string} path
 * @returns {InferenceConfig}
 */
export const loadInferenceFile = (path) => {
  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    if ((/** @type {NodeJS.ErrnoException} */ (err)).code === 'ENOENT') {
      return { monthlyUsd: DEFAULT_MONTHLY_USD, perIpDailyUsd: DEFAULT_PER_IP_DAILY_USD, options: [] }
    }
    throw new Error(`relay: cannot read inference config ${path}: ${(err instanceof Error && err.message) || String(err)}`)
  }
  return parseInferenceConfig(raw, path)
}
