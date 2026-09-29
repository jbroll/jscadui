#!/usr/bin/env bash
# Creates and checks the crt rootfs the agent-loop eval runs model code in
# (packages/agent-loop/eval/sandbox.js).
#
#   scripts/eval-sandbox-setup.sh          create the rootfs if absent, then check it
#   scripts/eval-sandbox-setup.sh --check  check only (ci/eval)
#
# Reads EVAL_CRT, EVAL_SANDBOX_ROOTFS and CRT_HOME like the eval does. Run it
# as the user the eval runs as: crt is rootless and the rootfs is per CRT_HOME.
# An existing rootfs is only checked, never changed, and only run read-only:
# it is part of the trusted base. To change it, `crt rm` it and rerun this.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOTFS="${EVAL_SANDBOX_ROOTFS:-jscad-eval}"
CRT="${EVAL_CRT:-$(command -v crt || true)}"

if [ -z "$CRT" ]; then
  echo "eval-sandbox-setup: no crt on PATH; install crt or set EVAL_CRT to its absolute path" >&2
  exit 1
fi

if [ "${1:-}" != --check ] && [ ! -d "${CRT_HOME:-/home/crt}/$ROOTFS/bin" ]; then
  "$CRT" create "$ROOTFS" "$ROOT/ci/jscad-eval.crt"
fi

if [ ! -d "/sys/fs/cgroup/user-$(id -u)" ]; then
  echo "eval-sandbox-setup: warning: the executor memory limit is not enforced until 'sudo crt setup' delegates a cgroup" >&2
fi

exec node "$ROOT/packages/agent-loop/eval/sandbox.js" --check
