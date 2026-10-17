export const toolError = (name, message) => ({ ok: false, error: { name, message } })

import { TOOLS } from './tools.js'

const SCHEMAS = new Map(TOOLS.map((t) => [t.name, t.inputSchema]))

const checkType = (value, type) => {
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return true
}

// Validates the call shape against the hand-written JSON-Schema subset in
// tools.js. `anyOf` properties (measure/check unions) skip deep checks, and
// `enum` membership is left to handlers: they own domain knowledge the schema
// does not repeat (export aliases, format lists) and answer instructive
// errors. A violation is a result the model can retry, never a throw.
const validateInput = (name, input) => {
  const schema = SCHEMAS.get(name)
  if (!schema || typeof input !== 'object' || input === null) return null
  for (const key of schema.required ?? []) {
    if (input[key] === undefined) return `missing required property '${key}'`
  }
  if (schema.additionalProperties === false) {
    const known = new Set(Object.keys(schema.properties ?? {}))
    const extra = Object.keys(input).find((k) => !known.has(k))
    if (extra) return `unknown property '${extra}'`
  }
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = input[key]
    if (value === undefined) continue
    if (prop.anyOf) continue
    if (prop.type && !checkType(value, prop.type)) return `property '${key}' should be ${prop.type}`
  }
  return null
}

// The canonical `grep` schema names the file list `include`; a legacy caller
// may still pass the old `paths`. Defensive only — no `search` tool name.
const normalizeGrepArgs = (args) => {
  if (args && args.paths !== undefined && args.include === undefined) {
    const { paths, ...rest } = args
    return { ...rest, include: paths }
  }
  return args
}

// Exposed tool name → `deps.*` handler key. The deps keys are the on-disk
// protocol between the loop, the app and the eval; the exposed names are the
// agent-visible ones. Only `glob`, `grep`, `delete`, `execute`, `export` and
// `question` differ: `list`/`search`/`run` predate the rename, and
// `deleteFile`/`exportModel` keep their suffix so the key is never the
// reserved word. `deps` keys are otherwise stable.
//
//   glob → list            grep → search         delete → deleteFile
//   execute → run(source)  export → exportModel  question → askUser
//
// `read`, `write`, `edit`, `measure`, `check`, `view`, `docs`, `skill`,
// `websearch` and `webfetch` map to a key of the same name.
const ROUTES = {
  glob: (deps, args) => deps.list(args),
  read: (deps, args) => deps.read(args),
  grep: (deps, args) => deps.search(normalizeGrepArgs(args)),
  write: (deps, args) => deps.write(args),
  edit: (deps, args) => deps.edit(args),
  delete: (deps, args) => deps.deleteFile(args),
  execute: (deps, args) => deps.run(args.source),
  measure: (deps, args) => deps.measure(args),
  check: (deps, args) => deps.check(args),
  export: (deps, args) => deps.exportModel(args),
  view: (deps, args) => deps.view(args),
  docs: (deps, args) => deps.docs(args.query),
  skill: (deps, args) => deps.skill(args),
  question: (deps, args) => deps.askUser(args),
  websearch: (deps, args) => deps.websearch(args),
  webfetch: (deps, args) => deps.webfetch(args),
}

/**
 * Routes a tool call to the handler that serves it, in the app and the eval.
 * A failure is a result, never a throw, so the loop always has something to
 * hand back to the model.
 * @param {string} name
 * @param {object} [input]
 * @param {{list:Function,read:Function,search:Function,write:Function,edit:Function,deleteFile:Function,run:Function,measure:Function,check:Function,exportModel:Function,view:Function,docs:Function,skill:Function,askUser:Function,websearch:Function,webfetch:Function}} deps
 *   Handlers keyed by the stable on-disk names (see the table above `ROUTES`).
 */
export const dispatchTool = async (name, input, deps) => {
  if (!Object.hasOwn(ROUTES, name)) return toolError('UnknownToolError', `unknown tool ${name}`)
  const violation = validateInput(name, input ?? {})
  if (violation) return toolError('ValidationError', `${name}: ${violation}`)
  try {
    return await ROUTES[name](deps, input ?? {})
  } catch (error) {
    return toolError(error?.name ?? 'Error', error?.message ?? String(error))
  }
}
