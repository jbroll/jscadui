// Routes an agent tool request to the part of jscad-web that can serve it:
// the local worker, the live viewer, or the editor. Every path answers with
// a JSON result; a failure is a result, never a throw, so the chat panel always
// has something to POST back to the server.
const DEFAULT_ENTRY = 'main.js'

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

/**
 * @param {string} name
 * @param {object} [input]
 * @param {{evaluate:Function,setParams:Function,measure:Function,check:Function,exportModel:Function,view:Function,save:Function}} deps
 */
export const handleToolRequest = async (name, input, deps) => {
  try {
    const args = input ?? {}
    if (name === 'eval') return await deps.evaluate(args.source, args.entry ?? DEFAULT_ENTRY)
    if (name === 'params') return await deps.setParams(args.values ?? {})
    if (name === 'measure') return await deps.measure(args)
    if (name === 'check') return await deps.check(args)
    if (name === 'export') return await deps.exportModel(args)
    if (name === 'view') return await deps.view(args)
    if (name === 'writeModel') {
      const entry = args.entry ?? DEFAULT_ENTRY
      await deps.save(args.source, entry)
      return { ok: true, entry }
    }
    return errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` })
  } catch (error) {
    return errorResult(error)
  }
}
