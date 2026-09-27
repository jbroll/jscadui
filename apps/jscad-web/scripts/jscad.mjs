#!/usr/bin/env node
// jscad: single-script local startup. Run from a model folder:
//   jscad [dir|file] [--port N] [--build|--no-build]
// Serves the app on :7377, the compute frame on :7378, the model dir at
// /models/, and a same-origin /api/relay so AI Chat works with your own key.
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEntry } from './local/resolveEntry.js'
import { scaffoldStarter } from './local/scaffold.js'
import { createRelayHandler, defaultAllowlist, loadAllowlist } from './local/relay.js'
import { startLocal } from './local/server.js'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = process.env.JSCADUI_WEB_DIR ?? resolve(here, '..')
const args = process.argv.slice(2)
const portFlag = args.indexOf('--port')
const port = portFlag === -1 ? Number(process.env.JSCAD_PORT) || 7377 : Number(args[portFlag + 1])
const flagValues = portFlag === -1 ? [] : [args[portFlag + 1]]
const targetArg = args.find((a) => !a.startsWith('--') && !flagValues.includes(a))
const target = resolve(targetArg ?? '.')
const st = await stat(target).catch(() => null)
if (!st) { console.error(`jscad: no such file or directory: ${target}`); process.exit(1) }
const modelDir = st.isDirectory() ? target : dirname(target)
const explicitFile = st.isDirectory() ? undefined : basename(target)

const pick = ['build', 'build_dev'].map((d) => join(webDir, d)).find((d) => existsSync(join(d, 'index.html')))
let out = pick
if (!out || args.includes('--build')) {
  if (args.includes('--no-build')) { console.error('jscad: no build output; run `npm run build` in apps/jscad-web or pass --build'); process.exit(1) }
  console.log('jscad: building web bundles…')
  const r = spawnSync('node', ['build.js', '--skipDocs'], { cwd: webDir, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
  out = join(webDir, existsSync(join(webDir, 'build', 'index.html')) ? 'build' : 'build_dev')
}
let entry
try {
  entry = await resolveEntry(modelDir, explicitFile ? { explicitFile } : {})
} catch (e) {
  if (explicitFile) { console.error(e.message); process.exit(1) }
  const scaffolded = scaffoldStarter(modelDir)
  if (!scaffolded) { console.error(e.message); process.exit(1) }
  console.log(`jscad: empty directory — created ${scaffolded.entryFile}`)
  entry = await resolveEntry(modelDir, {})
}
const { urlPath } = entry
const allowlist = process.env.RELAY_ALLOWLIST && existsSync(process.env.RELAY_ALLOWLIST)
  ? loadAllowlist(process.env.RELAY_ALLOWLIST)
  : defaultAllowlist()
const origin = `http://localhost:${port}`
const relayHandler = createRelayHandler({ allowlist, trustedOrigins: [origin] })
const { url } = await startLocal({ appDir: out, frameDir: join(out, 'frame'), modelDir, relayHandler, port })
console.log(`jscad: ${modelDir} → ${url}/#url=${urlPath}  (frame :${port + 1})`)
