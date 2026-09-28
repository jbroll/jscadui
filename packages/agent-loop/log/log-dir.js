import { homedir } from 'node:os'
import { join } from 'node:path'

export const chatLogDir = (env = process.env, home = homedir()) => {
  const setting = env.JSCAD_CHAT_LOG
  if (setting === '0') return null
  if (setting) return setting
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'jscad-chat', 'logs')
}
