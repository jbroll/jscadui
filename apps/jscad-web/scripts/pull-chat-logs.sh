#!/usr/bin/env bash
# Pull the production chat logs into the private jscad-chat-evals clone so the
# chat-review loop can read real sessions (see
# docs/superpowers/specs/2026-10-01-chat-logging-and-shared-keys-design.md,
# "Pulling logs").
#
#   apps/jscad-web/scripts/pull-chat-logs.sh
#
# Destination: <jscad-chat-evals>/logs/prod/, beside the launcher's logs/. The
# clone is $JSCAD_CHAT_DATA, else ~/src/jscad-chat-evals, the same resolution as
# chatDataDir in packages/agent-loop/log/log-dir.js.
#
# Source: the host and remote user come from server/deploy.conf. The remote
# directory is the server's CHAT_LOG_DIR, which defaults to ./data/chat-logs
# relative to the service's working directory (<EXPRESS_APP_BASE_PATH>/<APP_NAME>,
# per the deploy.sh express_app module). Set REMOTE_CHAT_LOG_DIR when the host
# overrides CHAT_LOG_DIR in its secrets env.
#
# Usage:
#   apps/jscad-web/scripts/pull-chat-logs.sh
#   REMOTE_CHAT_LOG_DIR=/srv/chat-logs apps/jscad-web/scripts/pull-chat-logs.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# server/deploy.conf carries the host; it requires APP_PORT (deploy-full.sh sets
# it) even though this script never uses the port, so give it a placeholder.
APP_PORT="${APP_PORT:-0}"
# shellcheck source=/dev/null
. "$here/../server/deploy.conf"

: "${REMOTE_HOST:?server/deploy.conf did not set REMOTE_HOST}"
remote_user="${REMOTE_USER:-$(id -un)}"
app_path="${EXPRESS_APP_BASE_PATH:-/var/lib}/${APP_NAME:-jscad-studio-api}"
remote_log_dir="${REMOTE_CHAT_LOG_DIR:-$app_path/data/chat-logs}"

data_dir="${JSCAD_CHAT_DATA:-$HOME/src/jscad-chat-evals}"
if [ ! -d "$data_dir" ]; then
  echo "pull-chat-logs: no jscad-chat-evals clone at $data_dir; clone it or set JSCAD_CHAT_DATA" >&2
  exit 1
fi

dest="$data_dir/logs/prod"
mkdir -p "$dest"

echo "pull-chat-logs: ${remote_user}@${REMOTE_HOST}:${remote_log_dir}/ -> ${dest}/"
rsync -az --stats "${remote_user}@${REMOTE_HOST}:${remote_log_dir}/" "$dest/"
