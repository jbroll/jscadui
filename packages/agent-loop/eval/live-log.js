import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const ROTATE_BYTES = 10 * 1024 * 1024

const defaultPath = () => join(homedir(), '.local', 'state', 'jscad-chat', 'eval-live.log')

// EVAL_LIVE_LOG overrides the path; '0' disables the live log entirely.
export const liveLogPath = (env = process.env) => {
  if (env.EVAL_LIVE_LOG === '0') return null
  return env.EVAL_LIVE_LOG || defaultPath()
}

// Every line of a block gets the model prefix so two models' concurrent runs stay legible.
export const prefixBlock = (model, text) => `${text.split('\n').map((line) => `[${model}] ${line}`).join('\n')}\n`

export const conversationTag = (model, fixture, run) => `${model} ${fixture}#${run}`

export const formatLiveHeader = ({ provider, model, promptSha256, fixtureNames, runs, filePath, now = new Date() }) =>
  `${now.toISOString()} provider=${provider} model=${model} promptSha=${promptSha256.slice(0, 8)} fixtures=${fixtureNames.join(',')} runs=${runs} file=${filePath}`

const defaultFs = { appendFileSync, mkdirSync, renameSync, statSync }

// A no-op log when disabled, so a caller never has to branch on the path itself.
export const createLiveLog = (path, { rotateBytes = ROTATE_BYTES, fs = defaultFs } = {}) => {
  if (!path) return { write: () => {} }
  fs.mkdirSync(dirname(path), { recursive: true })
  return {
    write: (text) => {
      let size = 0
      try {
        size = fs.statSync(path).size
      } catch {
        size = 0
      }
      // O_APPEND keeps a concurrent writer's block whole; renaming under a
      // live tail is fine, `tail -F` reopens the new file by name.
      if (size > rotateBytes) fs.renameSync(path, `${path}.1`)
      fs.appendFileSync(path, text)
    },
  }
}
