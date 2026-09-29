#!/usr/bin/env bash
# Creates and checks the crt rootfs the agent-loop eval runs model code in
# (packages/agent-loop/eval/sandbox.js).
#
#   scripts/eval-sandbox-setup.sh          create the rootfs if absent, then check it
#   scripts/eval-sandbox-setup.sh --check  check only (ci/eval)
#
# Reads EVAL_CRT, EVAL_SANDBOX_ROOTFS, EVAL_SANDBOX_MEMORY, CRT_HOME and
# EVAL_REQUIRE_MEMORY_LIMIT like the eval does. Run it as the user the eval
# runs as: crt is rootless and the rootfs is per CRT_HOME.
#
# The rootfs is part of the trusted base. An existing one is only checked,
# never changed, and only ever run read-only; its stored config
# ($CRT_HOME/.config/<name>) must equal ci/jscad-eval.crt byte for byte. To
# change it: crt rm <name>, then run this again.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOTFS="${EVAL_SANDBOX_ROOTFS:-jscad-eval}"
CRT="${EVAL_CRT:-$(command -v crt || true)}"

if [ -z "$CRT" ]; then
  echo "eval-sandbox-setup: no crt on PATH; install crt or set EVAL_CRT to its absolute path" >&2
  exit 1
fi
case "$CRT" in
  /*) ;;
  *) echo "eval-sandbox-setup: crt must be an absolute path, not $CRT" >&2; exit 1 ;;
esac
if [ ! -f "$CRT" ] || [ ! -x "$CRT" ]; then
  echo "eval-sandbox-setup: $CRT is not an executable file" >&2
  exit 1
fi

if [ "${1:-}" != --check ] && [ ! -e "${CRT_HOME:-/home/crt}/$ROOTFS" ]; then
  "$CRT" create "$ROOTFS" "$ROOT/ci/jscad-eval.crt"
fi

EVAL_CRT="$CRT" exec node "$ROOT/packages/agent-loop/eval/sandbox.js" --check
