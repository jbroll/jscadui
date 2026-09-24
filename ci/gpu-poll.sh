#!/bin/sh
# Keep ci/gpu-poll.mjs running (no systemd needed). Reads the token and any
# CI_* overrides from ~/.config/jscadui/gpu-poll.env (chmod 600), e.g.
#   GITHUB_TOKEN=github_pat_...
#   PATH=/home/john/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:/usr/bin:/bin
# Start at boot with cron:  @reboot /path/to/jscadui/ci/gpu-poll.sh >> ~/gpu-poll.log 2>&1
set -a
. "${GPU_POLL_ENV:-$HOME/.config/jscadui/gpu-poll.env}"
set +a
cd "$(dirname "$0")/.." || exit 1
while :; do
  node ci/gpu-poll.mjs
  echo "gpu-poll exited ($?), restarting in 30s"
  sleep 30
done
