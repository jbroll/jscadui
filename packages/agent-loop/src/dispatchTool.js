export const toolError = (name, message) => ({ ok: false, error: { name, message } })

const ROUTES = {
  list: (deps) => deps.list(),
  read: (deps, args) => deps.read(args),
  write: (deps, args) => deps.write(args),
  edit: (deps, args) => deps.edit(args),
  run: (deps, args) => deps.run(args.source),
  measure: (deps, args) => deps.measure(args),
  check: (deps, args) => deps.check(args),
  export: (deps, args) => deps.exportModel(args),
  view: (deps, args) => deps.view(args),
  docs: (deps, args) => deps.docs(args.query),
}

/**
 * Routes a tool call to the handler that serves it, in the app and the eval.
 * A failure is a result, never a throw, so the loop always has something to
 * hand back to the model.
 * @param {string} name
 * @param {object} [input]
 * @param {{list:Function,read:Function,write:Function,edit:Function,run:Function,measure:Function,check:Function,exportModel:Function,view:Function,docs:Function}} deps
 */
export const dispatchTool = async (name, input, deps) => {
  if (!Object.hasOwn(ROUTES, name)) return toolError('UnknownToolError', `unknown tool ${name}`)
  try {
    return await ROUTES[name](deps, input ?? {})
  } catch (error) {
    return toolError(error?.name ?? 'Error', error?.message ?? String(error))
  }
}
