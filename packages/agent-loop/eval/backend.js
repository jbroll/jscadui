import { createRequire } from 'node:module'
import { check } from '@jscadui/model-tools'
import { measure } from '@jscadui/model-tools'

const fluentRequire = createRequire(import.meta.url)

const errorResult = (error) => ({
  ok: false,
  error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
})

const runSource = (source) => {
  const module = { exports: {} }
  const require = (name) => {
    if (name === '@jbroll/jscad-fluent') return fluentRequire('@jbroll/jscad-fluent')
    throw new Error(`cannot require ${name}`)
  }
  const fn = new Function('require', 'module', 'exports', source)
  fn(require, module, module.exports)
  const main = module.exports.main ?? module.exports
  if (typeof main !== 'function') throw new Error('model exports no main()')
  const out = main({})
  return Array.isArray(out) ? out : [out]
}

export function createEvalBackend() {
  let geometry = null
  const project = new Map()

  const requestTool = async (name, input) => {
    try {
      const args = input ?? {}
      if (name === 'eval') {
        geometry = runSource(args.source)
        return JSON.stringify({ ok: true, params: [], entities: geometry.length })
      }
      if (name === 'measure') {
        if (!geometry) return JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })
        return JSON.stringify({ ok: true, ...measure(geometry, args) })
      }
      if (name === 'check') {
        if (!geometry) return JSON.stringify({ ok: false, error: { name: 'NoGeometryError', message: 'no geometry: eval a model first' } })
        return JSON.stringify({ ok: true, ...check(geometry, args) })
      }
      if (name === 'params') return JSON.stringify({ ok: true, params: [] })
      if (name === 'writeModel') {
        const entry = args.entry ?? 'main.js'
        project.set(entry, { source: args.source, message: args.message ?? '' })
        geometry = runSource(args.source)
        return JSON.stringify({ ok: true, entry })
      }
      if (name === 'view' || name === 'export') {
        return JSON.stringify({ ok: false, error: { name: 'UnavailableError', message: `${name} is unavailable in the eval harness` } })
      }
      return JSON.stringify(errorResult({ name: 'UnknownToolError', message: `unknown tool ${name}` }))
    } catch (error) {
      return JSON.stringify(errorResult(error))
    }
  }

  const reset = () => {
    geometry = null
    project.clear()
  }

  return { requestTool, reset, project }
}
