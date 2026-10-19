// Runs a batch of synthetic chat sessions through the real app: one lane per
// builder model (lanes concurrent, sessions within a lane sequential), each
// session on a fresh launcher and model directory. See "Synthetic sessions" in
// packages/agent-loop/docs/user-manual.md.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { chatLogDir } from '@jscadui/agent-loop/log/log-dir.js'
import { readConversations } from '@jscadui/agent-loop/log/read-log.js'
import { countStumbles } from '@jscadui/agent-loop/log/stumbles.js'
import { createGoClient } from '@jscadui/agent-loop/synth/goClient.js'
import { addSession, createManifest, sessionEntry, writeManifest } from '@jscadui/agent-loop/synth/manifest.js'
import { probeModels } from '@jscadui/agent-loop/synth/modelProbe.js'
import { assertFree, ROLES } from '@jscadui/agent-loop/synth/roles.js'
import { loadScenarios } from '@jscadui/agent-loop/synth/scenarios/index.js'
import { runSession } from '@jscadui/agent-loop/synth/session.js'
import { createSimUser } from '@jscadui/agent-loop/synth/simUser.js'
import { ensureLocalBuild, sourceStamp } from '../scripts/local/build.js'
import { productionDefaultFiles, seedModelDir } from './defaultFiles.js'
import { laneBuildName, startLauncher } from './launcher.js'
import { openSession } from './pageDriver.js'

// The settings dialog defaults an unset effort to its first option, `none`,
// which beam-free refuses; beam-free and longcat both accept `medium`.
const BUILDER_EFFORT = 'medium'

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(webDir, '../..')
const env = process.env

const fail = (message) => {
  console.error(`synth: ${message}`)
  process.exit(1)
}

const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null)

// A parse error can quote the file, so it is never passed on.
const readKey = () => {
  const path = env.JSCAD_CHAT_KEYS || join(homedir(), '.config', 'jscad-chat', 'keys.json')
  let keys
  try {
    keys = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`cannot read the keys file ${path}`)
  }
  if (!keys?.['opencode-go']) fail(`no opencode-go key in ${path}`)
  return keys['opencode-go']
}

const gitOut = (...args) => {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() || null : null
}

const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f !== 'index.txt' && statSync(join(dir, f)).isFile())
    .sort()

const dataUrlBytes = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')

const errorResult = (e) => ({ userTurns: 0, accepted: false, timedOut: false, error: e?.message ?? String(e), checks: null, simUserCalls: [], views: [] })

const out = env.SYNTH_OUT || (chatLogDir() ? join(chatLogDir(), 'synthetic') : fail('JSCAD_CHAT_LOG=0 and no SYNTH_OUT'))
const runs = Number(env.SYNTH_RUNS ?? 2)
const deadlineS = Number(env.SYNTH_DEADLINE_S ?? 6600)
const turnTimeoutMs = Number(env.SYNTH_TURN_TIMEOUT_MS ?? 900_000)
const basePort = Number(env.SYNTH_PORT ?? 5170)
if (![runs, deadlineS, turnTimeoutMs, basePort].every((n) => Number.isFinite(n) && n > 0)) fail('SYNTH_RUNS, SYNTH_DEADLINE_S, SYNTH_TURN_TIMEOUT_MS and SYNTH_PORT must be positive numbers')

const builderNames = list(env.SYNTH_BUILDERS) ?? ROLES.map((r) => r.builder)
const roles = builderNames.map((name) => ROLES.find((r) => r.builder === name) ?? fail(`unknown builder ${name}`))

const allScenarios = await loadScenarios()
const scenarioNames = list(env.SYNTH_SCENARIOS)
const scenarios = scenarioNames
  ? scenarioNames.map((name) => allScenarios.find((s) => s.name === name) ?? fail(`unknown scenario ${name}`))
  : allScenarios

const startedAt = Date.now()
const batch = new Date(startedAt).toISOString().replace(/:/g, '-')
const batchDir = join(out, batch)
const key = readKey()

const probeClient = createGoClient({ apiKey: key, session: randomUUID() })
const probe = await probeModels(probeClient, [...new Set(roles.flatMap((r) => [r.builder, r.simUser]))])
for (const [model, p] of Object.entries(probe)) {
  console.log(`synth: probe ${model} available=${p.available} vision=${p.vision}${p.error ? ` (${p.error})` : ''}`)
}
const lanes = roles.filter((r) => probe[r.builder].available && probe[r.simUser].available)
try {
  assertFree([...new Set(lanes.flatMap((r) => [r.builder, r.simUser]))], probe)
} catch (e) {
  fail(e.message)
}

mkdirSync(batchDir, { recursive: true })
writeFileSync(join(out, 'latest'), `${batch}\n`)
const manifest = createManifest({
  batch,
  jscaduiCommit: sourceStamp(repoRoot),
  scenarioSetCommit: gitOut('log', '-1', '--format=%H', '--', 'packages/agent-loop/synth/scenarios'),
  probe,
})

const record = (entry) => {
  addSession(manifest, entry)
  writeManifest(batchDir, manifest)
  writeFileSync(join(batchDir, 'index.txt'), `${filesUnder(batchDir).join('\n')}\n`)
}

const skipped = (role, scenario, run) => ({ scenario: scenario.name, builder: role.builder, simUser: role.simUser, run, skipped: true })

for (const role of roles.filter((r) => !lanes.includes(r))) {
  console.log(`synth: skipping ${role.builder}: builder or simulated user unavailable`)
  for (const scenario of scenarios) for (let run = 1; run <= runs; run++) record(skipped(role, scenario, run))
}
if (lanes.length === 0) fail('no builder lane can run')

const live = new Set()
const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })

const shutdown = async (signal) => {
  console.error(`synth: ${signal}, stopping`)
  await Promise.allSettled([...live].map((l) => l.stop()))
  await browser.close().catch(() => {})
  process.exit(1)
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

async function runOne(role, scenario, run, port) {
  const modelDir = mkdtempSync(join(tmpdir(), 'synth-model-'))
  let launcher
  let driver
  let result
  try {
    seedModelDir(modelDir, scenario.files ?? productionDefaultFiles(webDir))
    launcher = await startLauncher({ modelDir, port, logDir: batchDir, webDir })
    live.add(launcher)
    driver = await openSession(browser, {
      url: launcher.url,
      key,
      model: role.builder,
      vision: role.vision && probe[role.builder].vision,
      effort: BUILDER_EFFORT,
    })
    const label = `${role.builder} ${scenario.name}#${run}`
    // runSession treats a failed view as no images; say so, or the critique is silently blind.
    const view = driver.view
    driver.view = (spec) => view(spec).catch((e) => {
      console.error(`synth: ${label}: view failed: ${e.message}`)
      throw e
    })
    const simUser = createSimUser({
      client: createGoClient({ apiKey: key, session: randomUUID() }),
      model: role.simUser,
      maxTokens: role.simUserMaxTokens,
      vision: probe[role.simUser].vision,
      scenario,
    })
    result = await runSession({ driver, scenario, simUser, turnTimeoutMs })
  } catch (e) {
    result = errorResult(e)
  } finally {
    await driver?.close().catch(() => {})
    // Stopped before reading the log, so the relay has written every record.
    if (launcher) {
      await launcher.stop().catch(() => {})
      live.delete(launcher)
    }
    rmSync(modelDir, { recursive: true, force: true })
  }

  const ids = driver?.chatIds() ?? []
  const chatId = ids.length === 1 ? ids[0] : null
  if (!chatId && !result.error) result.error = ids.length === 0 ? 'no chat id seen' : `${ids.length} chat ids seen`
  let stumbles = null
  if (chatId) {
    const conversation = (await readConversations(batchDir)).find((c) => c.chatId === chatId)
    if (conversation) stumbles = countStumbles(conversation)
    mkdirSync(join(batchDir, 'views'), { recursive: true })
    for (const v of result.views) writeFileSync(join(batchDir, 'views', `${chatId}-t${v.turn}-${v.name}.png`), dataUrlBytes(v.dataUrl))
  }
  record(sessionEntry({ chatId, scenario, builder: role.builder, simUser: role.simUser, run, rounds: driver?.rounds() ?? 0, result, stumbles }))
  return result
}

async function runLane(role, port) {
  try {
    // Built here, outside the launcher's start timeout.
    await ensureLocalBuild({ webDir, port, outName: laneBuildName(port) })
  } catch (e) {
    console.error(`synth: ${role.builder}: ${e.message}`)
    return false
  }
  let ran = 0
  let clean = 0
  for (const scenario of scenarios) {
    for (let run = 1; run <= runs; run++) {
      if (Date.now() - startedAt > deadlineS * 1000) {
        record(skipped(role, scenario, run))
        continue
      }
      console.log(`synth: ${role.builder} ${scenario.name}#${run} start`)
      const r = await runOne(role, scenario, run, port)
      ran++
      if (!r.error) clean++
      console.log(`synth: ${role.builder} ${scenario.name}#${run} turns=${r.userTurns} accepted=${r.accepted} timedOut=${r.timedOut}${r.error ? ` error=${r.error}` : ''}`)
    }
  }
  return ran === 0 || clean > 0
}

// The builds run one at a time: ensureLocalBuild blocks on its build process.
const outcomes = []
for (const [i, role] of lanes.entries()) outcomes.push(runLane(role, basePort + 2 * i))
const ok = await Promise.all(outcomes)
await browser.close()
console.log(`synth: batch ${batch} → ${batchDir}`)
process.exit(ok.some(Boolean) ? 0 : 1)
