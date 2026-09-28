import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const readMuseAuth = () => JSON.parse(readFileSync(join(homedir(), '.config', 'muse', 'auth.json'), 'utf8'))

// Muse's api_base_url ends in /v1, which the provider adapters append themselves.
export const resolveCredentials = (env, readAuth = readMuseAuth) => {
  if (env.EVAL_API_KEY || env.EVAL_PROVIDER !== 'meta') return { apiKey: env.EVAL_API_KEY, baseUrl: env.EVAL_BASE_URL }
  let meta = {}
  try {
    meta = readAuth()?.providers?.meta ?? {}
  } catch {
    // no auth file: the caller reports the missing key
  }
  return { apiKey: meta.api_key, baseUrl: env.EVAL_BASE_URL ?? meta.api_base_url?.replace(/\/v1\/?$/, '') }
}
