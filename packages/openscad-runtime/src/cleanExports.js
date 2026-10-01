export const RESERVED = new Set(['main', 'getParameterDefinitions', 'fn', 'vars', '$meta', '$scad'])

const isNamedArgs = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

const splitArgs = (args) => (isNamedArgs(args.at(-1)) ? [args.slice(0, -1), args.at(-1)] : [args, {}])

const byName = (positional, params) => {
  const named = {}
  positional.forEach((v, i) => { if (i < params.length) named[params[i].name] = v })
  return named
}

const thunks = (children) => (Array.isArray(children) ? children : [children]).map((g) => () => g)

const put = (target, name, descriptor) =>
  Object.defineProperty(target, name, { ...descriptor, enumerable: true, configurable: true })

const moduleWrapper = (mod, params) => (...args) => {
  const [positional, named] = splitArgs(args)
  const { children = [], ...rest } = named
  return mod({ ...byName(positional, params), ...rest })(thunks(children))
}

const functionWrapper = (rt, f, fObj, params) => (...args) => {
  const [positional, named] = splitArgs(args)
  const specials = {}
  const plain = {}
  for (const [k, v] of Object.entries(named)) (k.startsWith('$') ? specials : plain)[k] = v
  const call = Object.keys(plain).length === 0 || !fObj
    ? () => f(...positional)
    : () => fObj({ ...byName(positional, params), ...plain })
  return Object.keys(specials).length ? rt.withScope(specials, call) : call()
}

export function exportClean(rt, exports, raw, meta) {
  const latest = new Map()
  for (const entry of meta) latest.set(`${entry.kind}:${entry.name}`, entry)
  const entries = [...latest.values()]
  const of = (kind) => entries.filter((e) => e.kind === kind)
  const fn = {}
  const vars = {}
  for (const e of of('variable')) {
    if (!(e.name in raw)) continue
    const value = raw[e.name]
    put(vars, e.name, e.lazy ? { get: () => value() } : { value, writable: true })
  }
  for (const e of of('function')) {
    const f = raw[`${e.name}_$f`]
    if (typeof f === 'function') put(fn, e.name, { value: functionWrapper(rt, f, raw[`${e.name}_$f$obj`], e.params ?? []), writable: true })
  }
  const bare = (name) => !RESERVED.has(name)
  for (const name of Object.keys(vars)) if (bare(name)) put(exports, name, Object.getOwnPropertyDescriptor(vars, name))
  for (const name of Object.keys(fn)) if (bare(name)) put(exports, name, { value: fn[name], writable: true })
  for (const e of of('module')) {
    const mod = raw[`${e.name}_$m`]
    if (bare(e.name) && typeof mod === 'function') put(exports, e.name, { value: moduleWrapper(mod, e.params ?? []), writable: true })
  }
  put(exports, 'fn', { value: fn, writable: true })
  put(exports, 'vars', { value: vars, writable: true })
  put(exports, '$meta', { value: meta, writable: true })
}
