import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const chatDataDir = (env = process.env, home = homedir(), exists = existsSync) => {
  if (env.JSCAD_CHAT_DATA) return env.JSCAD_CHAT_DATA
  const fallback = join(home, 'src', 'jscad-chat-evals')
  return exists(fallback) ? fallback : null
}

export const chatStateDir = (env = process.env, home = homedir()) =>
  join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'jscad-chat')

export const chatLogDir = (env = process.env, home = homedir(), exists = existsSync) => {
  const setting = env.JSCAD_CHAT_LOG
  if (setting === '0') return null
  if (setting) return setting
  const data = chatDataDir(env, home, exists)
  if (data) return join(data, 'logs')
  return join(chatStateDir(env, home), 'logs')
}

export const evalResultsDir = (env = process.env, home = homedir(), exists = existsSync) => {
  if (env.EVAL_RESULTS_DIR) return env.EVAL_RESULTS_DIR
  const data = chatDataDir(env, home, exists)
  return data ? join(data, 'results') : null
}
