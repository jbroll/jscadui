# CI

Two ways to run the OpenSCAD comparison suite on the GPU host. Both run
`ci/test`.

| | simple-ci (`npm test` in `packages/openscad`) | gpu-poll (`ci/gpu-poll.mjs`) |
|---|---|---|
| Source tree | rsync of your working tree, including uncommitted changes and generated examples | clean checkout of a PR's head commit; examples rebuilt with `fetch-deps` |
| Triggered by | you, from the dev machine | opening or pushing to a PR on GitHub; `/gpu-retest` comment |
| Results | streamed to your terminal | `openscad-gpu` commit status + a PR comment with the log tail |
| Host needs | simple-ci | Node ≥ 18, git, a GitHub token |

## gpu-poll

The GPU host polls GitHub (outbound HTTPS only; no runner, no inbound ports).
For each open PR from this repository (forks are ignored) whose head commit has
no `openscad-gpu` status, it:

1. sets the status to `pending`,
2. checks the commit out into a fresh worktree under `CI_WORKDIR`,
3. runs `node scripts/fetch-deps.js` and fails if that changes a tracked file,
4. runs `ci/test`,
5. sets `success`/`failure` and comments on the PR with the last 80 log lines.

Runs are serial. A PR comment that is exactly `/gpu-retest`, from the owner, a
member or a collaborator, re-runs the head commit. Use it after a run was killed
(its status stays `pending`) or to confirm a suspected flake.

PRs are only the CI channel. Merging stays fast-forward only (root `CLAUDE.md`);
when a PR's commits reach `main`, GitHub marks the PR merged.

### Setup on the GPU host

1. Create a fine-grained token (GitHub → Settings → Developer settings →
   Fine-grained tokens) for `jbroll/jscadui` only, with:
   - Commit statuses: Read and write
   - Pull requests: Read and write (for comments)
   - Contents: Read-only
2. Keep a checkout of `main` for the poller itself, e.g. `~/src/jscadui-ci`.
   It doesn't need to match what is being tested; `git pull` it to update the
   poller.
3. Write `~/.config/jscadui/gpu-poll.env` (`chmod 600`):
   ```sh
   GITHUB_TOKEN=github_pat_...
   # PATH as the jobs need it (node/npm from nvm, openscad, patch, git):
   PATH=/home/john/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:/usr/bin:/bin
   ```
4. Start it. `ci/gpu-poll.sh` loads the env file and restarts the poller if it
   exits:
   - at boot via cron: `@reboot $HOME/src/jscadui-ci/ci/gpu-poll.sh >> $HOME/gpu-poll.log 2>&1`
   - or now: `tmux new -d -s gpu-poll ~/src/jscadui-ci/ci/gpu-poll.sh`
5. One pass by hand to check the setup: `node ci/gpu-poll.mjs --once` (with
   the env file sourced).

Host requirements for `ci/test` are the same as for simple-ci: `openscad` on
`PATH`, GNU `patch`, and the `openscad-parser` fork at
`/home/john/src/openscad-parser`. Reference STLs are cached in
`~/.cache/jscadui/openscad-stl/` and shared with simple-ci runs by the same user.

Options (environment): `CI_REPO`, `CI_WORKDIR` (default
`~/.cache/jscadui/gpu-poll`: mirror, worktree, `deps-cache`, `logs/<sha>.log`),
`CI_POLL_SECONDS` (60), `CI_TIMEOUT_MINUTES` (180).

### Security

- Only PRs whose head branch is in this repository run; code from forks never
  runs on the host.
- `/gpu-retest` is honoured only from owner/member/collaborator comments.
- The token is removed from the environment of `fetch-deps` and `ci/test`.
- Scope the token to this repository and the permissions above; nothing else.
