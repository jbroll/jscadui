import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { initScadRuntime, requireScadSync } from '../../openscad/bin/run-jscad.js'

export const LIBS_DIR = process.env.JSCAD_LIBS_DIR ?? fileURLToPath(new URL('../../../apps/jscad-web/libs/', import.meta.url))

const resolveArg = (exports, arg) => (typeof arg === 'string' && arg in exports.vars ? exports.vars[arg] : arg)

export const entryPath = (record, libsDir) => join(libsDir, record.prelude ? `_catalog/${record.file}` : record.file)

export async function loadEntry(record, { libsDir = LIBS_DIR } = {}) {
  const ctx = await initScadRuntime()
  const start = performance.now()
  const { exports, j$ } = requireScadSync(entryPath(record, libsDir), ctx, { libPaths: [libsDir] })
  return { exports, j$, ctx, transpileMs: performance.now() - start }
}

export async function buildPart(loaded, record, args) {
  const start = performance.now()
  const geometry = loaded.exports[record.call](...args.map((a) => resolveArg(loaded.exports, a)))
  return { geometry, buildMs: performance.now() - start }
}
