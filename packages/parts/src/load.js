import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { initScadRuntime, requireScadSync } from '@jscadui/openscad/run'
import { writeShims } from './shims.js'

export const LIBS_DIR = process.env.JSCAD_LIBS_DIR ?? fileURLToPath(new URL('../../../apps/jscad-web/libs/', import.meta.url))

const resolveArg = (exports, arg) => (typeof arg === 'string' && arg in exports.vars ? exports.vars[arg] : arg)

export const entryPath = (record, libsDir) => join(libsDir, record.prelude ? `_catalog/${record.file}` : record.file)

export async function loadEntry(record, { libsDir = LIBS_DIR } = {}) {
  // check.js/render.js load a record straight from the catalog; a prior
  // `npm run catalog` isn't guaranteed, so write the shim here too.
  if (record.prelude) writeShims([record], libsDir)
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
