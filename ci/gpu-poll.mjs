#!/usr/bin/env node
/**
 * gpu-poll — run ci/test on the GPU host for open pull requests and report back.
 *
 * Polls GitHub for open PRs from this repository (forks are ignored). For each
 * head commit without an `openscad-gpu` commit status it:
 *   1. sets the status to pending,
 *   2. checks the commit out into a fresh worktree,
 *   3. runs scripts/fetch-deps.js and fails if that changes tracked files,
 *   4. runs ci/test (the script simple-ci runs),
 *   5. sets the status to success/failure and comments on the PR with the log tail.
 *
 * A PR comment that is exactly `/gpu-retest`, from someone with write access and
 * newer than the last status, re-runs the head commit.
 *
 * Needs: node >= 18 and git. One job at a time.
 *
 * Environment:
 *   GITHUB_TOKEN        fine-grained token for the repo: Commit statuses RW,
 *                       Pull requests RW, Contents R (required)
 *   CI_REPO             owner/name (default jbroll/jscadui)
 *   CI_WORKDIR          state, mirror, worktree, logs (default ~/.cache/jscadui/gpu-poll)
 *   CI_POLL_SECONDS     poll interval (default 60)
 *   CI_TIMEOUT_MINUTES  per-run limit (default 180)
 *   CI_API              API base (default https://api.github.com)
 *   CI_GIT_URL          clone URL (default https://github.com/$CI_REPO.git)
 *
 * Usage:
 *   node ci/gpu-poll.mjs          # poll forever
 *   node ci/gpu-poll.mjs --once   # one pass, then exit
 */

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONTEXT = 'openscad-gpu'
const MARKER = '<!-- openscad-gpu -->'
const RETEST = '/gpu-retest'
const WRITERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const LOG_TAIL_LINES = 80
const COMMENT_LIMIT = 60000

const env = process.env
const token = env.GITHUB_TOKEN || env.GH_TOKEN
const repo = env.CI_REPO || 'jbroll/jscadui'
const workdir = env.CI_WORKDIR || join(homedir(), '.cache', 'jscadui', 'gpu-poll')
const pollSeconds = Number(env.CI_POLL_SECONDS || 60)
const timeoutMinutes = Number(env.CI_TIMEOUT_MINUTES || 180)
const api = (env.CI_API || 'https://api.github.com').replace(/\/$/, '')
const gitUrl = env.CI_GIT_URL || `https://github.com/${repo}.git`
const once = process.argv.includes('--once')

const mirror = join(workdir, 'mirror.git')
const tree = join(workdir, 'tree')
const depsCache = join(workdir, 'deps-cache')
const logs = join(workdir, 'logs')

const log = (...a) => console.log(new Date().toISOString(), ...a)

async function gh(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

function git(args, opts = {}) {
  const auth = token && gitUrl.startsWith('https://')
    ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
    : []
  const r = spawnSync('git', [...auth, ...args], { encoding: 'utf8', ...opts })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

async function lastStatus(sha) {
  const { statuses } = await gh('GET', `/repos/${repo}/commits/${sha}/status?per_page=100`)
  return statuses.find(s => s.context === CONTEXT) // newest first
}

async function retestRequested(pr, since) {
  const comments = await gh('GET', `/repos/${repo}/issues/${pr.number}/comments?since=${encodeURIComponent(since)}&per_page=100`)
  return comments.some(c => c.body.trim() === RETEST && WRITERS.has(c.author_association) && c.created_at > since)
}

async function setStatus(sha, state, description) {
  await gh('POST', `/repos/${repo}/statuses/${sha}`, { state, context: CONTEXT, description: description.slice(0, 140) })
}

/** Run a command, appending output to the log stream; resolves to the exit code. */
function run(cmd, args, cwd, out, deadline) {
  return new Promise(resolve => {
    out.write(`\n$ ${cmd} ${args.join(' ')}\n`)
    const child = spawn(cmd, args, { cwd, detached: true, env: { ...env, GITHUB_TOKEN: '', GH_TOKEN: '' } })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    const timer = setTimeout(() => {
      out.write(`\n[gpu-poll] timed out after ${timeoutMinutes} min\n`)
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }, Math.max(0, deadline - Date.now()))
    child.on('close', code => { clearTimeout(timer); resolve(code ?? 1) })
    child.on('error', e => { clearTimeout(timer); out.write(`\n${e.message}\n`); resolve(1) })
  })
}

async function test(pr) {
  const sha = pr.head.sha
  const started = Date.now()
  const deadline = started + timeoutMinutes * 60_000
  const logPath = join(logs, `${sha}.log`)
  mkdirSync(logs, { recursive: true })
  const out = createWriteStream(logPath)
  log(`PR #${pr.number} ${sha.slice(0, 8)}: start`)
  await setStatus(sha, 'pending', 'Running ci/test on the GPU host')

  let step = 'checkout'
  let ok = false
  try {
    if (!existsSync(mirror)) git(['init', '--bare', '-q', mirror])
    git(['--git-dir', mirror, 'fetch', '-q', '--no-tags', gitUrl, `+refs/pull/${pr.number}/head:refs/ci/pr-${pr.number}`])
    if (existsSync(tree)) {
      spawnSync('git', ['--git-dir', mirror, 'worktree', 'remove', '--force', tree])
      rmSync(tree, { recursive: true, force: true })
    }
    git(['--git-dir', mirror, 'worktree', 'prune'])
    git(['--git-dir', mirror, 'worktree', 'add', '--detach', '-f', tree, sha])
    mkdirSync(depsCache, { recursive: true })
    symlinkSync(depsCache, join(tree, '.deps-cache'))

    step = 'fetch-deps'
    if (await run('node', ['scripts/fetch-deps.js'], tree, out, deadline) === 0) {
      const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: tree, encoding: 'utf8' }).stdout.trim()
      if (dirty) {
        out.write(`\n[gpu-poll] fetch-deps modified tracked files:\n${dirty}\n`)
      } else {
        step = 'ci/test'
        ok = await run('ci/test', [], tree, out, deadline) === 0
      }
    }
  } catch (e) {
    out.write(`\n[gpu-poll] ${e.message}\n`)
  }
  await new Promise(r => out.end(r))

  const minutes = ((Date.now() - started) / 60_000).toFixed(1)
  const result = ok ? 'passed' : `failed at ${step}`
  log(`PR #${pr.number} ${sha.slice(0, 8)}: ${result} (${minutes} min)`)
  const tail = readFileSync(logPath, 'utf8').split('\n').slice(-LOG_TAIL_LINES).join('\n')
  const body = [
    MARKER,
    `${ok ? '✅' : '❌'} **OpenSCAD GPU ${result}** on \`${sha.slice(0, 12)}\` in ${minutes} min.`,
    '',
    `Full log on the GPU host: \`${logPath}\`. Comment \`${RETEST}\` to run again.`,
    '',
    '<details open><summary>Log tail</summary>',
    '',
    '```',
    tail.slice(-COMMENT_LIMIT),
    '```',
    '</details>',
  ].join('\n')
  await gh('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body })
  await setStatus(sha, ok ? 'success' : 'failure', `ci/test ${result} (${minutes} min)`)
}

async function pass() {
  const prs = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=100`)
  for (const pr of prs) {
    if (pr.head.repo?.full_name !== repo) continue // never run fork code
    // Already run (or left pending by a run that was killed): only on /gpu-retest
    const status = await lastStatus(pr.head.sha)
    if (status && !(await retestRequested(pr, status.updated_at))) continue
    await test(pr)
  }
}

if (!token) {
  console.error('gpu-poll: set GITHUB_TOKEN')
  process.exit(2)
}
mkdirSync(workdir, { recursive: true })
log(`gpu-poll: ${repo}, workdir ${workdir}, every ${pollSeconds}s`)
for (;;) {
  try {
    await pass()
  } catch (e) {
    log(`poll failed: ${e.message}`)
  }
  if (once) break
  await new Promise(r => setTimeout(r, pollSeconds * 1000))
}
