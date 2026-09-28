import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const readMuseAuth = () => JSON.parse(readFileSync(join(homedir(), '.config', 'muse', 'auth.json'), 'utf8'))
const readOpencodeAuth = () => JSON.parse(readFileSync(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))

const defaultReadAuth = (env) => (env.EVAL_PROVIDER === 'opencode-go' ? readOpencodeAuth() : readMuseAuth())

// Muse's api_base_url ends in /v1, which the provider adapters append themselves.
export const resolveCredentials = (env, readAuth = () => defaultReadAuth(env)) => {
  if (env.EVAL_API_KEY || (env.EVAL_PROVIDER !== 'meta' && env.EVAL_PROVIDER !== 'opencode-go')) {
    return { apiKey: env.EVAL_API_KEY, baseUrl: env.EVAL_BASE_URL }
  }
  if (env.EVAL_PROVIDER === 'opencode-go') {
    let key
    try {
      key = readAuth()?.['opencode-go']?.key
    } catch {
      // no auth file: the caller reports the missing key
    }
    return { apiKey: key, baseUrl: env.EVAL_BASE_URL }
  }
  let meta = {}
  try {
    meta = readAuth()?.providers?.meta ?? {}
  } catch {
    // no auth file: the caller reports the missing key
  }
  return { apiKey: meta.api_key, baseUrl: env.EVAL_BASE_URL ?? meta.api_base_url?.replace(/\/v1\/?$/, '') }
}
