import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const readMuseAuth = () => JSON.parse(readFileSync(join(homedir(), '.config', 'muse', 'auth.json'), 'utf8'))
const readOpencodeAuth = () => JSON.parse(readFileSync(join(homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf8'))
const readJscadChatKeys = () =>
  JSON.parse(readFileSync(process.env.JSCAD_CHAT_KEYS || join(homedir(), '.config', 'jscad-chat', 'keys.json'), 'utf8'))

const defaultReadAuth = (env) => (env.EVAL_PROVIDER === 'opencode-go' ? readOpencodeAuth() : readMuseAuth())

const defaultWarn = (message) => console.error(message)

const keyFromKeysFile = (env, readKeys) => {
  try {
    return readKeys()?.[env.EVAL_PROVIDER]
  } catch {
    // missing or unreadable keys.json: fall through to the provider auth file
    return undefined
  }
}

// Muse's api_base_url ends in /v1, which the provider adapters append themselves.
export const resolveCredentials = (env, readAuth = () => defaultReadAuth(env), readKeys = readJscadChatKeys, warn = defaultWarn) => {
  if (env.EVAL_API_KEY || (env.EVAL_PROVIDER !== 'meta' && env.EVAL_PROVIDER !== 'opencode-go')) {
    return { apiKey: env.EVAL_API_KEY, baseUrl: env.EVAL_BASE_URL }
  }
  const keysFileKey = keyFromKeysFile(env, readKeys)
  if (env.EVAL_PROVIDER === 'opencode-go') {
    if (keysFileKey) return { apiKey: keysFileKey, baseUrl: env.EVAL_BASE_URL }
    let key
    try {
      key = readAuth()?.['opencode-go']?.key
    } catch {
      // no auth file: the caller reports the missing key
    }
    if (key) warn('run-eval: using the opencode auth.json key; put the jscad-chat key in ~/.config/jscad-chat/keys.json')
    return { apiKey: key, baseUrl: env.EVAL_BASE_URL }
  }
  let meta = {}
  try {
    meta = readAuth()?.providers?.meta ?? {}
  } catch {
    // no auth file: the caller reports the missing key
  }
  return { apiKey: keysFileKey ?? meta.api_key, baseUrl: env.EVAL_BASE_URL ?? meta.api_base_url?.replace(/\/v1\/?$/, '') }
}
