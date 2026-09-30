// Usage: node eval/fetch-ci-results.js JOB-ID
// Fetches ci/eval's result files, listed in the job's eval-results/index.txt,
// from a simple-ci job's worktree into the local jscad-chat-evals results dir.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evalResultsDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// sci lives beside the repo checkout (ci/README.md, packages/openscad/bin/test-ci.sh); SCI overrides it.
export const sciPath = (env = process.env, repoRoot = REPO_ROOT) => env.SCI || join(repoRoot, '..', 'simple-ci', 'sci')

export const parseIndex = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

// Result files pass 1 MB (execFileSync's default buffer) once a suite has ~18 fixtures.
const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

// index.txt is missing — a job killed before its first lane finished (ci/eval
// writes it as each lane completes, not only at the end) leaves none. `sci
// artifact` serves only a single file (the server's path confinement requires
// `file isfile`), so a directory listing is tried first in case that ever
// changes, and failing that the user is told to scp the directory themselves.
function noIndexFallback(jobId, { sci, run, log }) {
  try {
    const listing = run(sci, ['artifact', jobId, 'eval-results'])
    return { files: parseIndex(listing), fetched: [], fallback: 'listed' }
  } catch {
    // fall through to the scp message
  }
  let worktree = ''
  try {
    worktree = run(sci, ['path', jobId]).trim()
  } catch {
    // sci path failed too; the message below still names what's missing
  }
  const where = worktree ? `${worktree}/eval-results/` : `the job ${jobId}'s worktree (see: sci path ${jobId})/eval-results/`
  log(
    `fetch-ci-results: job ${jobId} has no eval-results/index.txt, and sci artifact cannot list a directory. ` +
      `Copy the result files yourself: scp <ci-host>:${where}*.json <dest>/`,
  )
  return { files: [], fetched: [], fallback: 'scp', worktree }
}

// `run(sci, args)` returns the text `sci` prints (an artifact's content); a fake in tests, never sci itself.
export function fetchCiResults(jobId, { sci, dataDir, run = defaultRun, fs = { existsSync, mkdirSync, writeFileSync }, log = () => {} }) {
  let index
  try {
    index = run(sci, ['artifact', jobId, 'eval-results/index.txt'])
  } catch {
    return noIndexFallback(jobId, { sci, run, log })
  }
  const files = parseIndex(index)
  fs.mkdirSync(dataDir, { recursive: true })
  const fetched = []
  for (const file of files) {
    const dest = join(dataDir, file)
    if (fs.existsSync(dest)) {
      log(`fetch-ci-results: ${file} already exists, skipping`)
      continue
    }
    fs.writeFileSync(dest, run(sci, ['artifact', jobId, `eval-results/${file}`]))
    fetched.push(file)
    log(`fetch-ci-results: wrote ${dest}`)
  }
  return { files, fetched }
}

const main = async (argv, env) => {
  const jobId = argv[0]
  if (!jobId) {
    console.error('Usage: node eval/fetch-ci-results.js JOB-ID')
    process.exit(1)
  }
  const dataDir = evalResultsDir(env)
  if (!dataDir) {
    console.error('fetch-ci-results: no results dir: clone jbroll/jscad-chat-evals to ~/src/jscad-chat-evals or set EVAL_RESULTS_DIR')
    process.exit(1)
  }
  const { fallback } = fetchCiResults(jobId, { sci: sciPath(env), dataDir, log: console.log })
  if (fallback === 'scp') process.exit(1)
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
