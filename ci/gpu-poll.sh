#!/bin/sh
# Manual/cron fallback for ci/gpu-poll.mjs. On the GPU host prefer the runit
# service (ci/runit/gpu-poll/, see ci/README.md), which reads the token from a
# root-only file. This script is for hand runs: it reads the token and any
# CI_* overrides from ~/.config/jscadui/gpu-poll.env (chmod 600), e.g.
#   GITHUB_TOKEN=github_pat_...
#   CI_SERVER_URL=http://127.0.0.1:8080
#   CI_WORKSPACE=/home/john/ci-workspace
#   PATH=/home/john/bin:/usr/local/bin:/usr/bin:/bin
set -a
. "${GPU_POLL_ENV:-$HOME/.config/jscadui/gpu-poll.env}"
set +a
cd "$(dirname "$0")/.." || exit 1
while :; do
  node ci/gpu-poll.mjs
  echo "gpu-poll exited ($?), restarting in 30s"
  sleep 30
done
