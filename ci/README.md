# CI

Two ways to run the OpenSCAD comparison suite on the GPU host. Both end up in
the simple-ci queue (`ci/gpu-test`).

| | simple-ci (`sci push jscadui/test`) | gpu-poll (`ci/gpu-poll.mjs`) |
|---|---|---|
| Source tree | rsync of your working tree, including uncommitted changes and generated examples | clean checkout of a PR's head commit, built by the server from `~/ci-workspace/jscadui` |
| Triggered by | you, from the dev machine | opening or pushing to a PR on GitHub; `/gpu-retest` comment |
| Results | streamed to your terminal | `openscad-gpu` commit status + a PR comment with the log tail |
| Host needs | simple-ci | simple-ci + a GitHub token for the poller |

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

PRs are only the CI channel. Merging stays fast-forward only (root `CLAUDE.md`);
when a PR's commits reach `main`, GitHub marks the PR merged.

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
   sudo mkdir -p /etc/sv/gpu-poll/log
   sudo cp ci/runit/gpu-poll/run /etc/sv/gpu-poll/run
   sudo cp ci/runit/gpu-poll/log/run /etc/sv/gpu-poll/log/run
   sudo chmod 700 /etc/sv/gpu-poll/run
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
on `PATH` (`/home/john/bin`), GNU `patch`, and the `openscad-parser` fork at
`/home/john/src/openscad-parser`. Reference STLs are cached in the service
user's `~/.cache/jscadui/openscad-stl/`.

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
