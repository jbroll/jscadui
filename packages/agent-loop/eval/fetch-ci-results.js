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

const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8' })

// `run(sci, args)` returns the text `sci` prints (an artifact's content); a fake in tests, never sci itself.
export function fetchCiResults(jobId, { sci, dataDir, run = defaultRun, fs = { existsSync, mkdirSync, writeFileSync }, log = () => {} }) {
  const index = run(sci, ['artifact', jobId, 'eval-results/index.txt'])
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
  fetchCiResults(jobId, { sci: sciPath(env), dataDir, log: console.log })
}

if (isMainModule(process.argv[1], import.meta.url)) {
  await main(process.argv.slice(2), process.env)
}
