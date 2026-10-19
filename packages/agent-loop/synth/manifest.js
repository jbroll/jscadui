import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const createManifest = ({ batch, jscaduiCommit, scenarioSetCommit, probe }) => ({
  batch,
  jscaduiCommit,
  scenarioSetCommit,
  probe,
  sessions: [],
})

export const addSession = (manifest, entry) => {
  manifest.sessions.push(entry)
  return manifest
}

// Every simulated-user message after the opening request is a non-ACCEPT critique.
export const sessionEntry = ({ chatId, scenario, builder, simUser, run, rounds, result, stumbles }) => ({
  chatId,
  scenario,
  builder,
  simUser,
  run,
  userTurns: result.userTurns,
  accepted: result.accepted,
  checks: result.checks,
  stumbles: {
    failedCalls: stumbles?.failedCalls ?? null,
    unbuiltTurns: stumbles?.unbuiltTurns ?? null,
    corrections: Math.max(0, result.userTurns - 1),
  },
  simUserCalls: result.simUserCalls,
  rounds,
  timedOut: result.timedOut,
  error: result.error,
})

// Written after every session; the rename keeps a reader from seeing half a file.
export const writeManifest = (dir, manifest) => {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'manifest.json')
  writeFileSync(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
  return path
}
