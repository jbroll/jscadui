// Ensures a local app+frame bundle pair whose baked origins match the ports
// we serve on and whose source matches the checkout. Reuses build_local/ when
// its marker matches, else runs a production-mode build (no watch, no servers)
// into build_local/ with FRAME_*_ORIGIN set. Never touches build/ (deploy
// artifact) or build_dev/.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const MARKER = '.jscad-local.json'

const defaultReadMarker = (out) => {
  try {
    return JSON.parse(readFileSync(join(out, MARKER), 'utf-8'))
  } catch {
    return null
  }
}

const defaultRun = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 })

// HEAD, plus a hash of uncommitted edits and new files when the tree is dirty;
// null outside git.
export const sourceStamp = (dir, run = defaultRun) => {
  const git = (...args) => {
    const r = run('git', ['-C', dir, ...args])
    if (r.status !== 0) throw new Error(`git ${args[0]} failed`)
    return r.stdout
  }
  try {
    const head = git('rev-parse', 'HEAD').trim()
    const dirt = git('diff', 'HEAD') + git('ls-files', '--others', '--exclude-standard')
    return dirt ? `${head}+${createHash('sha256').update(dirt).digest('hex').slice(0, 12)}` : head
  } catch {
    return null
  }
}

export const ensureLocalBuild = async ({ webDir, port, force = false, noBuild = false, sourceStamp: stampFn = sourceStamp, existsFn = existsSync, readMarker = defaultReadMarker, writeMarker = (out, m) => writeFileSync(join(out, MARKER), JSON.stringify(m)), spawnFn = (cmd, args, opts) => spawnSync(cmd, args, opts).status }) => {
  const out = join(webDir, 'build_local')
  const appOrigin = `http://localhost:${port}`
  const runOrigin = `http://localhost:${port + 1}`
  const source = stampFn(webDir)
  if (!force) {
    const marker = readMarker(out)
    const matches = marker?.appOrigin === appOrigin && marker?.runOrigin === runOrigin && marker?.source === source
    if (matches && existsFn(join(out, 'index.html'))) return out
  }
  if (noBuild) throw new Error(`jscad: no matching local build for ${appOrigin} at this source; run without --no-build once to build it`)
  console.log(`jscad: building local bundles for ${appOrigin}…`)
  const status = spawnFn('node', ['build.js', '--skipDocs'], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, JSCAD_OUT_DIR: 'build_local', FRAME_APP_ORIGIN: appOrigin, FRAME_RUN_ORIGIN: runOrigin, JSCAD_LOCAL_FS: '1' },
  })
  if (status !== 0) throw new Error('jscad: web build failed')
  writeMarker(out, { appOrigin, runOrigin, source })
  return out
}
