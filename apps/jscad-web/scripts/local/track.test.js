// apps/jscad-web/scripts/local/track.test.js
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BOOTSTRAP, refreshSteps, trackUpstream } from './track.js'

const HEAD = 'aaa111'
const TIP = 'bbb222'

const setup = ({ track = 'origin/main', git = {}, failing = [] } = {}) => {
  const outputs = {
    'fetch --quiet origin main': '',
    'rev-parse HEAD': `${HEAD}\n`,
    'rev-parse origin/main': `${TIP}\n`,
    [`merge-base --is-ancestor ${HEAD} ${TIP}`]: '',
    'status --porcelain --untracked-files=no': '',
    [`diff --name-only ${HEAD} ${TIP}`]: 'apps/jscad-web/src/main.js\n',
    [`checkout --quiet --detach ${TIP}`]: '',
    ...git,
  }
  const calls = []
  const logged = []
  const run = (cmd, args, opts = {}) => {
    const line = cmd === 'git' ? args.slice(2).join(' ') : [cmd, ...args].join(' ')
    calls.push({ line, cwd: opts.cwd })
    if (failing.includes(line)) return { status: 1, stdout: '' }
    if (cmd !== 'git') return { status: 0, stdout: '' }
    const out = outputs[line]
    return out === undefined ? { status: 1, stdout: '' } : { status: 0, stdout: out }
  }
  const readTrack = () => track
  const log = (msg) => logged.push(msg)
  return { calls, logged, lines: () => calls.map((c) => c.line), opts: { root: '/r', run, readTrack, log } }
}

describe('trackUpstream', () => {
  it('leaves a checkout without .jscad-track alone', () => {
    const s = setup({ track: null })
    expect(trackUpstream(s.opts)).toEqual({ tracked: false, moved: false })
    expect(s.calls).toEqual([])
  })
  it('rejects a .jscad-track that names no remote', () => {
    const s = setup({ track: 'main' })
    expect(() => trackUpstream(s.opts)).toThrow(/like origin\/main/)
  })
  it('launches what it has when the fetch fails', () => {
    const s = setup({ failing: ['fetch --quiet origin main'] })
    expect(trackUpstream(s.opts)).toEqual({ tracked: true, moved: false })
    expect(s.logged.join('\n')).toMatch(/could not fetch origin main/)
    expect(s.lines()).not.toContain(`checkout --quiet --detach ${TIP}`)
  })
  it('does nothing more when HEAD is already at the tip', () => {
    const s = setup({ git: { 'rev-parse origin/main': `${HEAD}\n` } })
    expect(trackUpstream(s.opts)).toEqual({ tracked: true, moved: false })
    expect(s.lines()).not.toContain('status --porcelain --untracked-files=no')
  })
  it('stays on commits the tip does not have', () => {
    const s = setup({ failing: [`merge-base --is-ancestor ${HEAD} ${TIP}`] })
    expect(trackUpstream(s.opts)).toEqual({ tracked: true, moved: false })
    expect(s.logged.join('\n')).toMatch(/not on origin\/main/)
    expect(s.lines()).not.toContain(`checkout --quiet --detach ${TIP}`)
  })
  it('refuses to move a dirty tree and says why', () => {
    const s = setup({ git: { 'status --porcelain --untracked-files=no': ' M package.json\n' } })
    expect(trackUpstream(s.opts)).toEqual({ tracked: true, moved: false })
    expect(s.logged.join('\n')).toMatch(/uncommitted changes/)
    expect(s.lines()).not.toContain(`checkout --quiet --detach ${TIP}`)
  })
  it('moves to the tip and refreshes generated state without reinstalling', () => {
    const s = setup()
    expect(trackUpstream(s.opts)).toEqual({ tracked: true, moved: true })
    expect(s.lines()).toContain(`checkout --quiet --detach ${TIP}`)
    expect(s.lines().at(-1)).toBe(`bash ${BOOTSTRAP} sources deps grids examples openscad`)
    expect(s.calls.at(-1).cwd).toBe('/r')
  })
  it('reinstalls when the lockfile changed', () => {
    const s = setup({ git: { [`diff --name-only ${HEAD} ${TIP}`]: 'package-lock.json\n' } })
    trackUpstream(s.opts)
    expect(s.lines().at(-1)).toBe(`bash ${BOOTSTRAP} sources ci deps grids examples openscad`)
  })
  it('reinstalls when a workspace package.json changed', () => {
    const s = setup({ git: { [`diff --name-only ${HEAD} ${TIP}`]: 'packages/scene/package.json\n' } })
    trackUpstream(s.opts)
    expect(s.lines().at(-1).split(' ')).toContain('ci')
  })
  it('throws when the refresh fails', () => {
    const s = setup({ failing: [`bash ${BOOTSTRAP} sources deps grids examples openscad`] })
    expect(() => trackUpstream(s.opts)).toThrow(/bootstrap/)
  })
})

describe('refresh steps through the real bootstrap helper', () => {
  it('fetches sources before npm ci and npm ci before fetch-deps', () => {
    const root = fileURLToPath(new URL('../../../..', import.meta.url))
    const r = spawnSync('bash', [BOOTSTRAP, '--dry-run', ...refreshSteps(['package-lock.json'])], { cwd: root, encoding: 'utf-8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim().split('\n')).toEqual([
      'bootstrap: node scripts/fetch-sources.js',
      'bootstrap: npm ci',
      'bootstrap: node scripts/fetch-deps.js --if-missing',
      'bootstrap: node packages/openscad/bin/generate-all-files.js --no-rename',
      'bootstrap: (apps/jscad-web) npm run sync-examples',
      'bootstrap: (packages/openscad) npm run build',
    ])
  })
})
