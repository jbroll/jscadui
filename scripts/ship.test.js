import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SHIP = resolve(import.meta.dirname, 'ship.sh')

// The same fixed-width layout `sci stat` prints: a queued job has no duration
// or finish time, a running one no finish time.
const pad = (s, n) => s.padEnd(n)
const row = ({ id, status, duration = '', finished = '', base = 'aaaaaaaa', tag, script = 'test' }) =>
  [pad(id, 8), pad(status, 7), pad(duration, 8), pad(finished, 8), pad('jscadui', 20), pad(base, 8), pad(tag, 16), script].join('  ')
const statTable = (jobs) =>
  ['ID        STATUS   DURATION  FINISHED  REPO                  BASE      TAG               SCRIPT', '--------', ...jobs.map(row)].join('\n') + '\n'

const STUB_SCI = `#!/bin/sh
echo "sci $*" >> "$STUB_DIR/calls"
case "$1" in
  stat) cat "$STUB_DIR/stat" ;;
  push) echo pushedjob ;;
  wait) exit 0 ;;
esac
`
// Moves main to LAND_TO, the tree land would leave there after any rebase.
const STUB_LAND = `#!/bin/sh
echo "land $*" >> "$STUB_DIR/calls"
git branch -f main "$LAND_TO"
`

// A git hook exports GIT_DIR and GIT_INDEX_FILE, which would point every
// command here at the real repository instead of the scratch one.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const GIT_OPTS = ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null']

let dir
const git = (...args) => execFileSync('git', [...GIT_OPTS, ...args], { cwd: join(dir, 'repo'), env: cleanEnv, encoding: 'utf8' }).trim()
const commit = (msg) => {
  writeFileSync(join(dir, 'repo', 'f.txt'), msg)
  git('add', 'f.txt')
  git('commit', '-q', '-m', msg)
  return git('rev-parse', 'HEAD')
}
const ship = (landTo) =>
  spawnSync('sh', [SHIP], {
    cwd: join(dir, 'repo'),
    encoding: 'utf8',
    env: { ...cleanEnv, PATH: `${dir}:${process.env.PATH}`, STUB_DIR: dir, LAND_BIN: 'land', LAND_TO: landTo },
  })
const calls = () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')

describe('ship.sh', () => {
  let tip
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ship-test-'))
    writeFileSync(join(dir, 'sci'), STUB_SCI)
    writeFileSync(join(dir, 'land'), STUB_LAND)
    chmodSync(join(dir, 'sci'), 0o755)
    chmodSync(join(dir, 'land'), 0o755)
    execFileSync('git', ['init', '-q', '-b', 'main', join(dir, 'repo')], { env: cleanEnv })
    commit('base')
    git('switch', '-q', '-c', 'feat')
    tip = commit('feat')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("waits on the post-commit job still running for the branch tip's tag", () => {
    writeFileSync(join(dir, 'stat'), statTable([{ id: 'running1', status: 'running', duration: ' 2m10s', tag: `commit-${git('rev-parse', '--short', 'HEAD')}` }]))
    const res = ship(tip)
    expect(res.status, res.stdout + res.stderr).toBe(0)
    expect(calls()).toContain('sci wait running1')
    expect(calls().some((c) => c.startsWith('sci push'))).toBe(false)
  })

  it('waits on a queued job rather than one a later push killed', () => {
    const tag = `commit-${git('rev-parse', '--short', 'HEAD')}`
    writeFileSync(join(dir, 'stat'), statTable([
      { id: 'killed01', status: 'killed', duration: '7s', finished: '07:59:05', tag },
      { id: 'queued01', status: 'queued', tag },
    ]))
    const res = ship(tip)
    expect(res.status, res.stdout + res.stderr).toBe(0)
    expect(calls()).toContain('sci wait queued01')
    expect(calls()).not.toContain('sci wait killed01')
  })

  it('gates a rebased landed tree by job ID, never by its shared tag', () => {
    const tag = `commit-${git('rev-parse', '--short', 'HEAD')}`
    git('switch', '-q', '--detach', 'main')
    const rebased = commit('rebased')
    git('switch', '-q', 'feat')
    writeFileSync(join(dir, 'stat'), statTable([{ id: 'green001', status: 'pass', duration: ' 8m55s', finished: '08:08:01', tag }]))
    const res = ship(rebased)
    expect(res.status, res.stdout + res.stderr).toBe(0)
    const waits = calls().filter((c) => c.startsWith('sci wait'))
    expect(waits).toEqual(['sci wait green001', 'sci wait pushedjob'])
  })
})
