// Keeps a checkout that holds a .jscad-track file (e.g. `origin/main`) on the
// tip of that ref: fetch, fast-forward a clean detached HEAD, then refresh the
// gitignored state the build needs with ci/lib/bootstrap.sh. Other checkouts
// are left alone.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const TRACK_FILE = '.jscad-track'

const defaultReadTrack = (root) => {
  try {
    return readFileSync(join(root, TRACK_FILE), 'utf-8').trim() || null
  } catch {
    return null
  }
}

const defaultRun = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf-8', ...opts })

const needsInstall = (changed) => changed.some((f) => f === 'package-lock.json' || f.endsWith('/package.json') || f === 'package.json')

export const BOOTSTRAP = 'ci/lib/bootstrap.sh'

export const refreshSteps = (changed) => ['sources', ...(needsInstall(changed) ? ['ci'] : []), 'deps', 'grids', 'examples', 'openscad']

export const trackUpstream = ({ root, run = defaultRun, readTrack = defaultReadTrack, log = console.log }) => {
  const ref = readTrack(root)
  if (!ref) return { tracked: false, moved: false }
  const slash = ref.indexOf('/')
  if (slash < 1) throw new Error(`jscad: ${join(root, TRACK_FILE)} must name a remote branch like origin/main, not "${ref}"`)
  const remote = ref.slice(0, slash)
  const branch = ref.slice(slash + 1)
  const git = (...args) => run('git', ['-C', root, ...args])
  const out = (...args) => {
    const r = git(...args)
    if (r.status !== 0) throw new Error(`jscad: git ${args.join(' ')} failed`)
    return r.stdout.trim()
  }

  if (git('fetch', '--quiet', remote, branch).status !== 0) {
    log(`jscad: could not fetch ${remote} ${branch}; launching ${out('rev-parse', 'HEAD').slice(0, 8)} as is`)
    return { tracked: true, moved: false }
  }
  const head = out('rev-parse', 'HEAD')
  const tip = out('rev-parse', ref)
  if (head === tip) return { tracked: true, moved: false }
  if (git('merge-base', '--is-ancestor', head, tip).status !== 0) {
    log(`jscad: ${root} is at ${head.slice(0, 8)}, which is not on ${ref}; staying there (check out ${ref} to resume tracking)`)
    return { tracked: true, moved: false }
  }
  if (out('status', '--porcelain', '--untracked-files=no')) {
    log(`jscad: ${root} has uncommitted changes; staying at ${head.slice(0, 8)} instead of moving to ${ref}`)
    return { tracked: true, moved: false }
  }

  const changed = out('diff', '--name-only', head, tip).split('\n').filter(Boolean)
  log(`jscad: moving ${root} from ${head.slice(0, 8)} to ${ref} ${tip.slice(0, 8)}`)
  out('checkout', '--quiet', '--detach', tip)
  // The tip's own helper, so steps it adds or reorders apply to this refresh.
  const args = [BOOTSTRAP, ...refreshSteps(changed)]
  if (run('bash', args, { cwd: root, stdio: 'inherit' }).status !== 0) throw new Error(`jscad: bash ${args.join(' ')} failed in ${root}`)
  return { tracked: true, moved: true }
}
