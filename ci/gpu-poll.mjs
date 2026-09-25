#!/usr/bin/env node
/**
 * gpu-poll — run PR heads through the simple-ci queue and report back.
 *
 * Polls GitHub for open PRs from this repository (forks are ignored). For each
 * head commit without an `openscad-gpu` commit status it:
 *   1. checks the author is in CI_TRUSTED_USERS and the diff leaves the
 *      test harness (ci/, scripts/) untouched — otherwise it posts one
 *      explanatory comment and never executes the code,
 *   2. sets the status to pending,
 *   3. fetches the PR head into the simple-ci workspace clone,
 *   4. submits ci/gpu-test for the head commit via POST /job (so the run
 *      shares the simple-ci worker pool, isolation, logging and kill
 *      handling with every other `sci push` job),
 *   5. waits for the job, then sets success/failure and comments on the PR
 *      with the last 80 log lines.
 *
 * A PR comment that is exactly `/gpu-retest`, from someone with write access
 * and newer than the last status (or newer than the head commit when the head
 * touches the harness), re-runs the head commit. Use it after a run was
 * killed (its status stays `pending`), to confirm a suspected flake, or as
 * the explicit "I reviewed the harness diff" approval for PRs that touch
 * ci/ or scripts/.
 *
 * The GitHub token lives only in this process (see ci/README.md — it is read
 * from a root-owned file before privileges drop). It is never passed to jobs.
 * Needs: node >= 18 and git (for the pre-fetch). One poller at a time.
 *
 * Environment:
 *   GITHUB_TOKEN        fine-grained token for the repo: Commit statuses RW,
 *                       Pull requests RW, Contents R (required)
 *   CI_REPO             owner/name (default jbroll/jscadui)
 *   CI_TRUSTED_USERS    comma-separated GitHub logins whose PRs auto-run
 *                       (default: the repo owner)
 *   CI_SCI_REPO         simple-ci workspace dir name (default: repo basename)
 *   CI_SCRIPT           simple-ci script to run (default gpu-test)
 *   CI_WORKSPACE        path to ci-workspace on this host
 *                       (default /home/john/ci-workspace)
 *   CI_SERVER_URL       simple-ci base URL (default http://127.0.0.1:8080)
 *   CI_POLL_SECONDS     GitHub poll interval (default 60)
 *   CI_JOB_POLL_SECONDS job status poll interval (default 15)
 *   CI_TIMEOUT_MINUTES  per-run limit, then POST /job/:id/kill (default 180)
 *   CI_API              GitHub API base (default https://api.github.com)
 *
 * Usage:
 *   node ci/gpu-poll.mjs          # poll forever
 *   node ci/gpu-poll.mjs --once   # one pass, then exit
 */

import { spawnSync } from 'node:child_process'

const CONTEXT = 'openscad-gpu'
const MARKER = '<!-- openscad-gpu -->'
const RETEST = '/gpu-retest'
const WRITERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
// Paths that define how a run executes. A head commit touching these is never
// executed on author trust alone — it needs an explicit owner /gpu-retest.
const HARNESS_PREFIXES = ['ci/', 'scripts/']
const LOG_TAIL_LINES = 80
const COMMENT_LIMIT = 60000

const env = process.env
const token = env.GITHUB_TOKEN || env.GH_TOKEN
const repo = env.CI_REPO || 'jbroll/jscadui'
const owner = repo.split('/')[0]
const trusted = new Set(
  (env.CI_TRUSTED_USERS || owner).split(',').map(s => s.trim()).filter(Boolean),
)
const sciRepo = env.CI_SCI_REPO || repo.split('/')[1]
const script = env.CI_SCRIPT || 'gpu-test'
const workspace = env.CI_WORKSPACE || '/home/john/ci-workspace'
const server = (env.CI_SERVER_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
const pollSeconds = Number(env.CI_POLL_SECONDS || 60)
const jobPollSeconds = Number(env.CI_JOB_POLL_SECONDS || 15)
const timeoutMinutes = Number(env.CI_TIMEOUT_MINUTES || 180)
const api = (env.CI_API || 'https://api.github.com').replace(/\/$/, '')
const once = process.argv.includes('--once')

const log = (...a) => console.log(new Date().toISOString(), ...a)
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

/** simple-ci API. No auth — the server trusts CI_ALLOWED_NETS (localhost). */
async function sci(method, path, body) {
  const res = await fetch(`${server}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
  const type = res.headers.get('content-type') || ''
  return type.includes('json') ? JSON.parse(text) : text
}

async function lastStatus(sha) {
  const { statuses } = await gh('GET', `/repos/${repo}/commits/${sha}/status?per_page=100`)
  return statuses.find(s => s.context === CONTEXT) // newest first
}

async function prComments(pr) {
  return gh('GET', `/repos/${repo}/issues/${pr.number}/comments?per_page=100`)
}

async function retestSince(pr, since) {
  const comments = await prComments(pr)
  return comments.some(
    c => c.body.trim() === RETEST && WRITERS.has(c.author_association) && c.created_at > since,
  )
}

async function retestRequested(pr, since) {
  return retestSince(pr, since)
}

async function alreadyCommented(pr) {
  const comments = await prComments(pr)
  return comments.some(c => c.body.includes(MARKER))
}

/**
 * When this poller last reported a result for `sha` in a PR comment. A run is
 * recorded there as well as in the commit status, so a commit whose status
 * could not be written (e.g. a token without Commit statuses permission) still
 * counts as evaluated and does not re-run on every poll.
 */
async function lastResultAt(pr, sha) {
  const tag = `\`${sha.slice(0, 12)}\``
  const results = (await prComments(pr))
    .filter(c => c.body.includes(MARKER) && c.body.includes(tag) && !c.body.includes('⏭️'))
    .map(c => c.created_at)
    .sort()
  return results.at(-1)
}

async function setStatus(sha, state, description) {
  await gh('POST', `/repos/${repo}/statuses/${sha}`, { state, context: CONTEXT, description: description.slice(0, 140) })
}

/** Diff of base...head: which files changed, and the head commit date. */
async function compareHeads(pr) {
  const cmp = await gh('GET', `/repos/${repo}/compare/${pr.base.sha}...${pr.head.sha}`)
  const files = (cmp.files || []).map(f => f.filename || '')
  const commits = cmp.commits || []
  const headDate = commits.length
    ? commits[commits.length - 1].commit.author.date
    : pr.updated_at
  return { files, headDate }
}

/**
 * Decide whether a head commit may execute. Fail closed: any API error while
 * establishing trust means no run.
 */
async function approval(pr, sha) {
  const login = pr.user.login
  const status = await lastStatus(sha)
  const evaluatedAt = status?.updated_at ?? await lastResultAt(pr, sha)
  if (evaluatedAt) {
    // Already evaluated: only an explicit owner re-run re-executes.
    if (!(await retestRequested(pr, evaluatedAt))) return { run: false }
    return { run: true, forced: true }
  }
  let cmp
  try {
    cmp = await compareHeads(pr)
  } catch (e) {
    return { run: false, reason: `could not compare head against base (${e.message}); refusing to run` }
  }
  const harnessTouched = cmp.files.some(f => HARNESS_PREFIXES.some(p => f.startsWith(p)))
  if (!trusted.has(login)) {
    return { run: false, reason: `author @${login} is not in CI_TRUSTED_USERS (${[...trusted].join(', ')})` }
  }
  if (harnessTouched) {
    const touched = cmp.files.filter(f => HARNESS_PREFIXES.some(p => f.startsWith(p)))
    if (await retestSince(pr, cmp.headDate)) return { run: true, forced: true }
    return { run: false, reason: `touches the test harness (${touched.slice(0, 5).join(', ')}) — needs an owner \`${RETEST}\` posted after the head commit` }
  }
  return { run: true }
}

async function comment(pr, body) {
  await gh('POST', `/repos/${repo}/issues/${pr.number}/comments`, { body })
}

async function skip(pr, reason) {
  log(`PR #${pr.number}: skip (${reason})`)
  if (await alreadyCommented(pr)) return
  await comment(pr, [
    MARKER,
    `⏭️ **OpenSCAD GPU run skipped** on \`${pr.head.sha.slice(0, 12)}\`: ${reason}.`,
    '',
    'No code from this PR was executed on the GPU host.',
  ].join('\n'))
}

/** Make the head commit resolvable in the workspace clone the server builds from. */
function ensureFetched(pr) {
  const dir = `${workspace}/${sciRepo}`
  const r = spawnSync(
    'git', ['-C', dir, 'fetch', '-q', 'origin', `+refs/pull/${pr.number}/head:refs/ci/pr-${pr.number}`],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error(`git fetch pr-${pr.number}: ${(r.stderr || r.stdout).trim()}`)
}

/** Wait for a simple-ci job; kill it past the deadline. Resolves to the final status. */
async function waitJob(id, deadline) {
  for (;;) {
    const job = await sci('GET', `/job/${id}`)
    if (['pass', 'fail', 'killed', 'stale'].includes(job.status)) return job
    if (Date.now() > deadline) {
      try {
        await sci('POST', `/job/${id}/kill`)
      } catch {}
      const jobAfter = await sci('GET', `/job/${id}`).catch(() => null)
      return { ...jobAfter, status: 'killed', timeout: true }
    }
    await sleep(jobPollSeconds * 1000)
  }
}

async function test(pr) {
  const sha = pr.head.sha
  const started = Date.now()
  const deadline = started + timeoutMinutes * 60_000
  log(`PR #${pr.number} ${sha.slice(0, 8)}: start`)

  let step = 'status'
  let jobId = null
  let ok = false
  let detail = ''
  try {
    await setStatus(sha, 'pending', 'Queued ci/gpu-test on the GPU host')
    step = 'fetch'
    ensureFetched(pr)
    step = 'queue'
    const created = await sci('POST', '/job', { repo: sciRepo, commit: sha, script })
    jobId = created.id
    log(`PR #${pr.number} ${sha.slice(0, 8)}: simple-ci job ${jobId}`)
    step = `ci/${script}`
    const job = await waitJob(jobId, deadline)
    ok = job.status === 'pass'
    if (job.timeout) {
      step = 'timeout'
      detail = ` (killed after ${timeoutMinutes} min)`
    } else if (job.status !== 'pass') {
      detail = ` (job ${job.status})`
    }
  } catch (e) {
    detail = ` (${e.message.slice(0, 120)})`
    if (step === 'status' && /\b403\b/.test(e.message)) {
      detail += ' — the token needs "Commit statuses: Read and write"'
    }
  }

  const minutes = ((Date.now() - started) / 60_000).toFixed(1)
  const result = ok ? 'passed' : `failed at ${step}${detail}`
  log(`PR #${pr.number} ${sha.slice(0, 8)}: ${result} (${minutes} min)`)

  let tail = ''
  if (jobId) {
    try {
      const text = await sci('GET', `/log/${jobId}`)
      tail = text.split('\n').slice(-LOG_TAIL_LINES).join('\n')
    } catch (e) {
      tail = `(log unavailable: ${e.message.slice(0, 120)})`
    }
  }
  const body = [
    MARKER,
    `${ok ? '✅' : '❌'} **OpenSCAD GPU ${result}** on \`${sha.slice(0, 12)}\` in ${minutes} min.`,
    '',
    jobId
      ? `Full log on the GPU host: \`~/ci-logs/${jobId}.log\` (simple-ci job \`${jobId}\`). Comment \`${RETEST}\` to run again.`
      : `The run never reached the queue. Comment \`${RETEST}\` to run again.`,
    '',
    '<details open><summary>Log tail</summary>',
    '',
    '```',
    tail.slice(-COMMENT_LIMIT),
    '```',
    '</details>',
  ].join('\n')
  await comment(pr, body)
  try {
    await setStatus(sha, ok ? 'success' : 'failure', `ci/${script} ${result} (${minutes} min)`)
  } catch (e) {
    // The comment above already records the result (see lastResultAt)
    log(`PR #${pr.number} ${sha.slice(0, 8)}: could not set status (${e.message})`)
  }
}

async function pass() {
  const prs = await gh('GET', `/repos/${repo}/pulls?state=open&per_page=100`)
  for (const pr of prs) {
    if (pr.head.repo?.full_name !== repo) continue // never run fork code
    let decision
    try {
      decision = await approval(pr, pr.head.sha)
    } catch (e) {
      log(`PR #${pr.number}: approval check failed (${e.message}); skipping`)
      continue
    }
    if (!decision.run) {
      if (decision.reason) await skip(pr, decision.reason)
      continue
    }
    await test(pr)
  }
}

if (!token) {
  console.error('gpu-poll: set GITHUB_TOKEN')
  process.exit(2)
}
log(`gpu-poll: ${repo}, queue ${server} (${sciRepo}/${script}), every ${pollSeconds}s`)
for (;;) {
  try {
    await pass()
  } catch (e) {
    log(`poll failed: ${e.message}`)
  }
  if (once) break
  await sleep(pollSeconds * 1000)
}
