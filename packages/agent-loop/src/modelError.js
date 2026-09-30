import { DEFAULT_API } from './api.js'
import { errorLocation, memoryMessage, withoutLoaderNote } from './buildReport.js'
import { withErrorHint } from './hints.js'
import { PROJECT_BASE } from './projectUrl.js'

const MAX_MESSAGE = 4000
const MAX_NAME = 200

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PROJECT_FILE = new RegExp(`${escapeRegExp(PROJECT_BASE)}([^\\s:()]+):`)

// Babel's message names the file and ends its first line with (line:column);
// the frame worker's re-parse and the transform's wrapper keep only the message.
const syntaxLoc = (error) => {
  if (error.name !== 'SyntaxError' || error.loc) return error
  const first = String(error.message ?? '').split('\n')[0]
  const at = /\((\d+):(\d+)\)\s*$/.exec(first)
  const file = PROJECT_FILE.exec(first)?.[1]
  return at && file ? { ...error, file, loc: { line: Number(at[1]), column: Number(at[2]) } } : error
}

/**
 * A model error as a build report and `run` carry it, in the app and the
 * eval: the message capped, reworded for memory, with no loader note or
 * frame-worker `jscadMain failed: ` prefix, the hint for `api` added, and the
 * project file, line and column it names.
 * @param {unknown} error
 * @param {{api?:string,index?:Array<object>}} [options] `index` is the API index; without it no hint
 */
export const reportError = (error, { api = DEFAULT_API, index } = {}) => {
  const e = /** @type {{name?:unknown,message?:unknown,stack?:unknown,loc?:unknown,file?:unknown}} */ (error ?? {})
  const name = String(e.name ?? 'Error').slice(0, MAX_NAME)
  const raw = memoryMessage(withoutLoaderNote(String(e.message ?? error).replace(/^jscadMain failed: /, ''))).slice(0, MAX_MESSAGE)
  const located = errorLocation(syntaxLoc({ name, message: raw, stack: e.stack, loc: e.loc, file: e.file }), PROJECT_BASE)
  return { name, message: withErrorHint(raw, { api, index }), ...located }
}
