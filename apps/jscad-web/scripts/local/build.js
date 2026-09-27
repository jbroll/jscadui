// Ensures a local app+frame bundle pair whose baked origins match the ports
// we serve on. Reuses build_local/ when its marker matches, else runs a
// production-mode build (no watch, no servers) into build_local/ with
// FRAME_*_ORIGIN set. Never touches build/ (deploy artifact) or build_dev/.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const MARKER = '.jscad-local.json'

const defaultReadMarker = (out) => {
  try {
    return JSON.parse(readFileSync(join(out, MARKER), 'utf-8'))
  } catch {
    return null
  }
}

export const ensureLocalBuild = async ({ webDir, port, force = false, noBuild = false, existsFn = existsSync, readMarker = defaultReadMarker, writeMarker = (out, m) => writeFileSync(join(out, MARKER), JSON.stringify(m)), spawnFn = (cmd, args, opts) => spawnSync(cmd, args, opts).status }) => {
  const out = join(webDir, 'build_local')
  const appOrigin = `http://localhost:${port}`
  const runOrigin = `http://localhost:${port + 1}`
  if (!force) {
    const marker = readMarker(out)
    if (marker?.appOrigin === appOrigin && marker?.runOrigin === runOrigin && existsFn(join(out, 'index.html'))) return out
  }
  if (noBuild) throw new Error(`jscad: no matching local build for ${appOrigin}; run without --no-build once to build it`)
  console.log(`jscad: building local bundles for ${appOrigin}…`)
  const status = spawnFn('node', ['build.js', '--skipDocs'], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, JSCAD_OUT_DIR: 'build_local', FRAME_APP_ORIGIN: appOrigin, FRAME_RUN_ORIGIN: runOrigin },
  })
  if (status !== 0) throw new Error('jscad: web build failed')
  writeMarker(out, { appOrigin, runOrigin })
  return out
}
