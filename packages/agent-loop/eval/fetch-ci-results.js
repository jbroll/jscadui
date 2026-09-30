// Usage: node eval/fetch-ci-results.js JOB-ID
// Fetches ci/eval's result files (eval-results/index.txt), and a complex pass's renders, into the local results dir.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evalResultsDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// sci lives beside the repo checkout (ci/README.md, test:ci in packages/openscad/package.json); SCI overrides it.
export const sciPath = (env = process.env, repoRoot = REPO_ROOT) => env.SCI || join(repoRoot, '..', 'simple-ci', 'sci')

export const parseIndex = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

// Result files pass 1 MB (execFileSync's default buffer) once a suite has ~18 fixtures.
const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const defaultRunBytes = (sci, args) => execFileSync(sci, args, { maxBuffer: 256 * 1024 * 1024 })

const RENDER_PATH = /^[\w.-]+\.renders\/[\w.-]+\/[\w-]+\.png$/

// A complex result file's views, which sit beside it in the job's eval-results/.
export const renderViews = (text) => {
  let file
  try {
    file = JSON.parse(text)
  } catch {
    return []
  }
  if (file?.suite !== 'complex' || !Array.isArray(file.results)) return []
  return file.results
    .flatMap((r) => r?.render?.views ?? [])
    .filter((v) => typeof v?.path === 'string' && RENDER_PATH.test(v.path) && !v.path.split('/').includes('..') && typeof v.sha256 === 'string')
}

// The evals repo keeps only the newest complex pass's renders; git history keeps the rest.
const pruneRenders = (dataDir, keep, { fs, log }) => {
  for (const name of fs.readdirSync(dataDir)) {
    if (!name.endsWith('.renders') || keep.includes(name)) continue
    fs.rmSync(join(dataDir, name), { recursive: true, force: true })
    log(`fetch-ci-results: removed ${name}, an older complex pass's renders`)
  }
}

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
export function fetchCiResults(
  jobId,
  {
    sci,
    dataDir,
    run = defaultRun,
    runBytes = defaultRunBytes,
    fs = { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync },
    log = () => {},
  },
) {
  let index
  try {
    index = run(sci, ['artifact', jobId, 'eval-results/index.txt'])
  } catch {
    return noIndexFallback(jobId, { sci, run, log })
  }
  const files = parseIndex(index)
  fs.mkdirSync(dataDir, { recursive: true })
  const fetched = []
  const renders = { fetched: 0, mismatched: [] }
  // Every complex file's renders dir, whether fetched now or already on disk, so
  // pruneRenders below never deletes a pass that's merely being resumed.
  const kept = []
  for (const file of files) {
    const dest = join(dataDir, file)
    let text
    if (fs.existsSync(dest)) {
      log(`fetch-ci-results: ${file} already exists, skipping`)
      text = fs.readFileSync(dest, 'utf8')
    } else {
      text = run(sci, ['artifact', jobId, `eval-results/${file}`])
      fs.writeFileSync(dest, text)
      fetched.push(file)
      log(`fetch-ci-results: wrote ${dest}`)
    }
    const views = renderViews(text)
    if (views.length) kept.push(`${basename(file, '.json')}.renders`)
    for (const view of views) {
      const target = join(dataDir, view.path)
      if (fs.existsSync(target)) continue
      const bytes = runBytes(sci, ['artifact', jobId, `eval-results/${view.path}`])
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== view.sha256) {
        renders.mismatched.push(view.path)
        log(
          `fetch-ci-results: ${view.path} did not match its sha256 (expected ${view.sha256}, got ${actual}); ` +
            `sci artifact may not pass binary files through — copy it with scp from the job's eval-results/`,
        )
        continue
      }
      fs.mkdirSync(dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes)
      renders.fetched += 1
    }
  }
  if (kept.length) pruneRenders(dataDir, kept, { fs, log })
  if (renders.mismatched.length) {
    log(`fetch-ci-results: ${renders.mismatched.length} renders did not match their sha256 (sci artifact may not pass binary files through); copy them with scp from the job's eval-results/`)
  }
  return { files, fetched, renders }
}

// The CLI's exit code for a fetchCiResults() outcome: non-zero when the caller must act
// (no index and no listing, or a render that failed its sha256 check).
export const exitCode = ({ fallback, renders }) => (fallback === 'scp' || renders?.mismatched?.length > 0 ? 1 : 0)

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
  const outcome = fetchCiResults(jobId, { sci: sciPath(env), dataDir, log: console.log })
  if (exitCode(outcome)) process.exit(1)
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
