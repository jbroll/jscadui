#!/usr/bin/env node
// jscad: single-script local startup. Run from a model folder:
//   jscad [dir|file] [--port N] [--build|--no-build] [--no-open]
// Serves the app on :7377, the compute frame on :7378, the model dir at
// /models/, and a same-origin /api/relay so AI Chat works with your own key.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEntry } from './local/resolveEntry.js'
import { ensureLocalBuild } from './local/build.js'
import { openBrowser } from './local/openBrowser.js'
import { scaffoldStarter } from './local/scaffold.js'
import { createRelayHandler, defaultAllowlist, loadAllowlist } from './local/relay.js'
import { startLocal } from './local/server.js'
import { chatLogDir } from '@jscadui/agent-loop/log/log-dir.js'
import { createChatLog } from './local/chatLog.js'
import { trackUpstream } from './local/track.js'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

if (!process.env.JSCAD_TRACKED) {
  let tracked
  try {
    tracked = trackUpstream({ root: resolve(here, '../../..') })
  } catch (e) { console.error(e.message); process.exit(1) }
  // This process loaded the old code; run the checked-out version instead.
  if (tracked.moved) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit', env: { ...process.env, JSCAD_TRACKED: '1' } })
    process.exit(r.status ?? 1)
  }
}

const webDir = process.env.JSCADUI_WEB_DIR ?? resolve(here, '..')
const portFlag = args.indexOf('--port')
const port = portFlag === -1 ? Number(process.env.JSCAD_PORT) || 7377 : Number(args[portFlag + 1])
const flagValues = portFlag === -1 ? [] : [args[portFlag + 1]]
const targetArg = args.find((a) => !a.startsWith('--') && !flagValues.includes(a))
const target = resolve(targetArg ?? '.')
const st = await stat(target).catch(() => null)
if (!st) { console.error(`jscad: no such file or directory: ${target}`); process.exit(1) }
const modelDir = st.isDirectory() ? target : dirname(target)
const explicitFile = st.isDirectory() ? undefined : basename(target)

const out = await ensureLocalBuild({
  webDir,
  port,
  force: args.includes('--build'),
  noBuild: args.includes('--no-build'),
}).catch((e) => { console.error(e.message); process.exit(1) })
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
const logDir = chatLogDir()
const relayHandler = createRelayHandler({ allowlist, trustedOrigins: [origin], log: logDir ? createChatLog(logDir) : null })
const { url } = await startLocal({ appDir: out, frameDir: join(out, 'frame'), modelDir, relayHandler, port })
const page = `${url}/#${urlPath}`
console.log(`jscad: ${modelDir} → ${page}  (frame :${port + 1})`)
console.log(logDir ? `jscad: chat log → ${logDir}` : 'jscad: chat log off (JSCAD_CHAT_LOG=0)')
if (!args.includes('--no-open') && !process.env.JSCAD_NO_OPEN) await openBrowser(page)
