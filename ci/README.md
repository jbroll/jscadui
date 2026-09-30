# CI

Two ways to run the OpenSCAD comparison suite on the GPU host. Both end up in
the simple-ci queue (`ci/gpu-test`).

Pull requests are the CI channel **only for cloud sessions** that cannot
reach simple-ci. Local terminal sessions verify with `sci push jscadui/test`
(or `npm test`) and merge fast-forward into `main`, never through GitHub.

| | simple-ci (`sci push jscadui/test`) | gpu-poll (`ci/gpu-poll.mjs`) |
|---|---|---|
| Source tree | rsync of your working tree, including uncommitted changes and generated examples | clean checkout of a PR's head commit, built by the server from `~/ci-workspace/jscadui` |
| Triggered by | you, from the dev machine | opening or pushing to a PR on GitHub; `/gpu-retest` comment |
| Results | streamed to your terminal | `openscad-gpu` commit status + a PR comment with the log tail |
| Host needs | simple-ci | simple-ci + a GitHub token for the poller |

## Live model eval (`ci/eval`)

`sci push jscadui/eval` runs the agent-loop eval suite (`packages/agent-loop/eval/`)
against live models on the CI host, one process per model in `ci/eval.conf`'s
`EVAL_MODELS` × API style in `EVAL_APIS` (`fluent modeling`) pair. Every pair
is its own lane, all running concurrently, so at most (models × APIs) ×
`EVAL_CONCURRENCY` conversations run at once (16 with the shipped conf: 2
models × 2 APIs × 4 — the host has 43G available and each sandbox is capped
at 2G). Each model and style writes its own result file, named with both. The
default suite, the ungrouped fixtures plus the `harder` group, is 25
fixtures under fluent and 24 under modeling (`fluent-chain` is fluent-only),
so at 3 runs and 2 models a job is (25 + 24) × 3 × 2 = 294 conversations;
running every model × API pair
concurrently instead of one model's styles after another roughly halves the
wall time per model. Edit the conf file in the working tree before pushing —
`sci push` carries no arguments of its own, so the conf file is the only
knob: `EVAL_MODELS` (space-separated `provider:model` pairs), `EVAL_APIS`,
`EVAL_FIXTURES`, `EVAL_RUNS`, `EVAL_CONCURRENCY`.

Provider keys come from the job user's `$HOME/.config/jscad-chat/keys.json`
(`{ "<provider>": "<key>" }`, mode 600) — place it there once, by hand; the
job never receives or copies it. On the host, the CI server runs as `s-ci`
under the `/data/crt` layout, so that file is `/data/ci/.config/jscad-chat/keys.json`.
A model whose provider has no key there fails on its own, without blocking
the others.

Results land in the job's worktree at `eval-results/`: `index.txt` lists the
result files and is rewritten after every lane finishes (not only at the
end), so a killed job still leaves an index of whatever completed.
`eval-live.log` holds the live conversation log. Both are readable with `sci
artifact JOB PATH` while the job runs; `sci log JOB` streams the job's own
stdout, which carries each model's summary tables and speed line. Fetch the
result files into the local evals data dir with:

```bash
node packages/agent-loop/eval/fetch-ci-results.js JOB-ID
```

It reads `eval-results/index.txt` via `sci artifact`, then copies each listed
file into `$JSCAD_CHAT_DATA/results` (default `~/src/jscad-chat-evals/results`),
skipping any file already there. `SCI` overrides the `sci` binary path
(default: beside this checkout, `../simple-ci/sci`). If a job left no
`index.txt` (killed before its first lane finished), it falls back to a
directory listing over `sci artifact`; `sci artifact` only ever serves a
single file, so that fails too, and the script instead prints an `scp`
command built from `sci path JOB-ID`'s worktree path for you to run by hand.

The job exits non-zero only when a model's eval process failed outright (a
crash, or a missing/unset key) — provider errors inside individual runs are
recorded in the result file, not job failures. A failed lane does not stop
any other model × API lane.

### Host setup for `ci/eval`

Model code from the models runs only in a crt container with no network, no
home directory, no provider key and a 2G memory limit
(`packages/agent-loop/docs/architecture.md`, Sandbox). The job runs
`scripts/eval-sandbox-setup.sh --check` with `EVAL_REQUIRE_MEMORY_LIMIT=1`
after the build and fails before any provider call when crt, the rootfs, its
stored config or cgroup delegation is missing. The host uses the `/data/crt`
layout: `/data/crt/bin/crt`, `/usr/local/bin/crt` symlinked to it, and a
per-user home at `/data/crt/home/<user>`. Once, as root:

1. Install crt and delegate the `s-ci` job user's cgroup:
   ```sh
   sudo crt install
   sudo crt setup s-ci
   ```
2. Check the install and cgroup delegation:
   ```sh
   crt doctor --limits
   ```
3. Start the CI server itself under crt's cgroup so the memory limits it
   delegates apply to the server's children (its runit `run` script):
   ```sh
   exec /usr/local/bin/crt cgroup-exec s-ci --leaf ci-server -- chpst -u s-ci ...
   ```
4. As `s-ci`, create the rootfs (`ci/jscad-eval.crt`: Void, `nodejs`) and
   check that an executor starts in it and that the memory limit is in force
   inside it. `CRT_HOME` resolves on its own ($CRT_HOME, else
   `/data/crt/home/s-ci`, else `/home/crt`), so it needs no override on this
   layout:
   ```sh
   EVAL_REQUIRE_MEMORY_LIMIT=1 scripts/eval-sandbox-setup.sh
   ```

`scripts/eval-sandbox-setup.sh --check` repeats the check at any time; it
prints `eval sandbox: ready` or what is missing. The rootfs is part of the
trusted base: never run it writable or install into it (crt then refuses its
hardened runs). Its stored config must equal `ci/jscad-eval.crt`, so a change
to that file, like any change or upgrade, means `crt rm jscad-eval` and
running `scripts/eval-sandbox-setup.sh` again.

Each executor holds up to 2G. `ci/eval` passes the lane count (models × APIs)
as `EVAL_PROCESSES`, and each `run-eval` lowers its `EVAL_CONCURRENCY` so that
lanes × concurrency × 2G fits in three quarters of the host's memory.

## gpu-poll

The GPU host polls GitHub (outbound HTTPS only; no runner, no inbound ports).
For each open PR from this repository (forks are ignored) whose head commit has
no `openscad-gpu` status, it:

1. checks the trust gates (below) and skips with an explanatory PR comment if
   they fail — skipped code is never executed,
2. sets the status to `pending`,
3. fetches the PR head into the simple-ci workspace clone
   (`git fetch origin +refs/pull/N/head:refs/ci/pr-N`),
4. submits `ci/gpu-test` for the head commit with `POST /job`, so the run
   shares the worker pool, isolation, logging and kill handling with every
   other `sci push` job,
5. waits for the job (killing it past `CI_TIMEOUT_MINUTES`),
6. sets `success`/`failure` and comments on the PR with the last 80 log lines
   (full log stays in `~/ci-logs/<job>.log` on the host).

`ci/gpu-test` runs `node scripts/fetch-deps.js`, fails if that changes a
tracked file, then `exec ci/test` — the same script `sci push` runs.

Runs are serial. A PR comment that is exactly `/gpu-retest`, from the owner, a
member or a collaborator, re-runs the head commit. Use it after a run was
killed (its status stays `pending`) or to confirm a suspected flake.

PRs are only the CI channel for cloud sessions. Merging stays fast-forward only (root `CLAUDE.md`);
when a PR's commits reach `main`, GitHub marks the PR merged. Local sessions
never open PRs: verify, fast-forward, push.

### Trust gates

PR code executes on the GPU host as `s-ci`, which owns the CI workspace. Two
gates fail closed (any error establishing trust means no run):

- **Author allowlist.** Only logins in `CI_TRUSTED_USERS` (default: the repo
  owner) auto-run. Other authors get one `⏭️ skipped` comment per head commit.
- **Harness pin.** A head commit touching `ci/` or `scripts/` never runs on
  author trust alone — those paths define how a run executes. An owner
  `/gpu-retest` posted *after* the head commit approves the harness diff and
  runs it. Re-runs of an already-evaluated commit likewise need `/gpu-retest`.

### Setup on the GPU host (Void Linux / runit)

1. Create a fine-grained token (GitHub → Settings → Developer settings →
   Fine-grained tokens) for `jbroll/jscadui` only, with:
   - Commit statuses: Read and write
   - Pull requests: Read and write (for comments)
   - Contents: Read-only
2. Keep a checkout of `main` for the poller itself, e.g. `~/src/jscadui-ci`
   (readable by `s-ci`). It doesn't need to match what is being tested;
   `git pull` it to update the poller.
3. Write the token to a root-only file (NOT an `s-ci`-readable env file —
   queued jobs run as `s-ci`, so anything `s-ci` can read, PR code can read):
   ```sh
   sudo install -m 700 -d /etc/gpu-poll
   sudo sh -c 'printf %s "github_pat_..." > /etc/gpu-poll/token'
   sudo chmod 600 /etc/gpu-poll/token
   ```
4. Install the service from the repo (`ci/runit/gpu-poll/`):
   ```sh
   sudo mkdir -p /etc/sv/gpu-poll/log /var/log/gpu-poll  # svlogd needs the log dir to exist
   sudo cp ci/runit/gpu-poll/run /etc/sv/gpu-poll/run
   sudo cp ci/runit/gpu-poll/log/run /etc/sv/gpu-poll/log/run
   sudo chmod 700 /etc/sv/gpu-poll/run     # token is read before chpst; keep unreadable
   sudo chmod +x /etc/sv/gpu-poll/log/run  # plain cp drops the exec bit
   sudo ln -s /etc/sv/gpu-poll /var/service/
   sudo sv status gpu-poll          # logs via svlogd at /var/log/gpu-poll/
   ```
   The `run` script reads the token while still root, then `exec chpst -u
   s-ci`. `ci/gpu-poll.sh` remains as a fallback for hand runs outside runit.
5. One pass by hand to check the setup (as `s-ci`, with the env the service
   sets): `node ci/gpu-poll.mjs --once`.
6. After pulling poller updates: `git -C ~/src/jscadui-ci pull && sudo sv
   restart gpu-poll`.

Host requirements for `ci/gpu-test` are the same as for simple-ci: `openscad`
on `PATH` (`/home/john/bin`), GNU `patch`, `git`, and HTTPS access to GitHub.
`openscad-parser` is a git dependency pinned by commit in
`packages/openscad/package.json`; `npm install` fetches and builds it, so no
host-local parser checkout is needed. `ci/test` runs `scripts/fetch-sources.js`
before `npm install`, which checks out the pinned `@jscad/modeling`,
jscad-fluent and jscad-anchors forks into the worktree's `.deps-cache/`, so no
sibling checkouts of any of them are needed either (`docs/CLOUD_SESSION.md`).
Reference STLs are cached in the service user's `~/.cache/jscadui/openscad-stl/`.

If runs can exceed the server's `CI_JOB_TIMEOUT` (default 3600s), raise it on
the host — the poller's own timeout only kills via the API, it cannot extend
the runner's `timeout`.

Options (environment): `CI_REPO`, `CI_TRUSTED_USERS`, `CI_SCI_REPO` (default
repo basename), `CI_SCRIPT` (default `gpu-test`), `CI_WORKSPACE` (default
`/home/john/ci-workspace`), `CI_SERVER_URL` (default
`http://127.0.0.1:8080`), `CI_POLL_SECONDS` (60), `CI_JOB_POLL_SECONDS`
(15), `CI_TIMEOUT_MINUTES` (180).

### Security

- Only PRs whose head branch is in this repository run; code from forks never
  runs on the host. Same-repo is necessary but not sufficient — the trust
  gates above are the actual boundary.
- The token lives only in the poller process: it is read from a root-only file and
  never exported to job environments. Scope it to this repository and the
  permissions above; nothing else.
- `/gpu-retest` is honoured only from owner/member/collaborator comments, and
  for harness-touching heads only when posted after the head commit.
- Residual risks (accepted, documented): jobs run as `s-ci`, which owns the
  workspace clones — malicious code that passes the gates could tamper with
  base clones, reach the local simple-ci API, or exhaust disk. Author-only
  execution is therefore load-bearing, not defense-in-depth. A separate job
  user with a read-only workspace, egress filtering and disk quotas would
  remove it; that work is not in this PR.
