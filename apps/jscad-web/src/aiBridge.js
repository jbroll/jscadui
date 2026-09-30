// Routes an agent tool request to the part of jscad-web that can serve it:
// the project tools (aiDeps.js), the live viewer, or the docs index. Every path
// answers with a result; a failure is a result, never a throw, so the loop
// always has something to hand back to the model.
const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

/**
 * @param {string} name
 * @param {object} [input]
 * @param {{list:Function,read:Function,write:Function,edit:Function,run:Function,measure:Function,check:Function,exportModel:Function,view:Function,docs:Function}} deps
 */
export const handleToolRequest = async (name, input, deps) => {
  try {
    const args = input ?? {}
    if (name === 'list') return await deps.list()
    if (name === 'read') return await deps.read(args)
    if (name === 'write') return await deps.write(args)
    if (name === 'edit') return await deps.edit(args)
    if (name === 'run') return await deps.run(args.source)
    if (name === 'measure') return await deps.measure(args)
    if (name === 'check') return await deps.check(args)
    if (name === 'export') return await deps.exportModel(args)
    if (name === 'view') return await deps.view(args)
    if (name === 'docs') return await deps.docs(args.query)
    return errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` })
  } catch (error) {
    return errorResult(error)
  }
}
