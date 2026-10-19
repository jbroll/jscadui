// Usage: node synth/fetch-batch.js JOB-ID
// Fetches ci/synth's batch (synth-results/<batch>/, listed in its index.txt) into <chat log dir>/synthetic/<batch>/.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sciPath, parseIndex } from '../eval/fetch-ci-results.js'
import { chatLogDir } from '../log/log-dir.js'
import { isMainModule } from '../src/mainModule.js'

const defaultRun = (sci, args) => execFileSync(sci, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const defaultRunBytes = (sci, args) => execFileSync(sci, args, { maxBuffer: 256 * 1024 * 1024 })

// `run` and `runBytes` stand in for sci in tests; every file goes through runBytes so PNGs survive.
export function fetchBatch(jobId, { sci, logDir, run = defaultRun, runBytes = defaultRunBytes, log = () => {} }) {
  const batch = run(sci, ['artifact', jobId, 'synth-results/latest']).trim()
  if (!/^[\w.-]+$/.test(batch) || batch.includes('..')) throw new Error(`fetch-batch: bad batch id ${JSON.stringify(batch)}`)
  const files = parseIndex(run(sci, ['artifact', jobId, `synth-results/${batch}/index.txt`]))
  for (const file of files) {
    if (file.split('/').includes('..') || file.startsWith('/')) throw new Error(`fetch-batch: refusing listed path ${file} (contains ..)`)
  }
  const batchDir = join(logDir, 'synthetic', batch)
  for (const file of files) {
    const dest = join(batchDir, file)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, runBytes(sci, ['artifact', jobId, `synth-results/${batch}/${file}`]))
    log(`fetch-batch: wrote ${dest}`)
  }
  return { batch, files, batchDir }
}

const main = (argv, env) => {
  const jobId = argv[0]
  if (!jobId) {
    console.error('Usage: node synth/fetch-batch.js JOB-ID')
    process.exit(1)
  }
  const logDir = chatLogDir(env)
  if (!logDir) {
    console.error('fetch-batch: no chat log dir (JSCAD_CHAT_LOG=0)')
    process.exit(1)
  }
  const { batch, files, batchDir } = fetchBatch(jobId, { sci: sciPath(env), logDir, log: console.log })
  console.log(`fetch-batch: ${files.length} files in ${batchDir}; read with: npm run read-log -w @jscadui/agent-loop -- --batch ${batch}`)
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2), process.env)
}
