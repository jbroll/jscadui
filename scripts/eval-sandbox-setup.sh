#!/usr/bin/env bash
# Creates and checks the crt rootfs the agent-loop eval runs model code in
# (packages/agent-loop/eval/sandbox.js).
#
#   scripts/eval-sandbox-setup.sh          create the rootfs if absent, then check it
#   scripts/eval-sandbox-setup.sh --check  check only (ci/eval)
#
# Reads EVAL_CRT, EVAL_SANDBOX_ROOTFS, EVAL_SANDBOX_MEMORY, CRT_HOME and
# EVAL_REQUIRE_MEMORY_LIMIT like the eval does. Run it as the user the eval
# runs as: crt is rootless and the rootfs is per CRT_HOME, which must lie
# outside $HOME, /tmp and the repo. When CRT_HOME isn't set, this asks
# `crt home` for its resolved default (/data/crt/home/$USER, else /home/crt).
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

# Ask crt for its resolved CRT_HOME rather than guessing: $CRT_HOME, else
# /data/crt/home/$USER if it exists, else /home/crt.
RESOLVED_HOME="$("$CRT" home)" || {
  echo "eval-sandbox-setup: $CRT home failed; run 'crt doctor --limits' to check the install" >&2
  exit 1
}
if [ -z "$RESOLVED_HOME" ]; then
  echo "eval-sandbox-setup: $CRT home printed nothing; run 'crt doctor --limits' to check the install" >&2
  exit 1
fi

# crt refuses hardened runs from a CRT_HOME inside $HOME, /tmp or a bind source.
HOME_DIR="$(realpath -m -- "$RESOLVED_HOME")"
for root in "$HOME" /tmp "$ROOT"; do
  root="$(realpath -m -- "$root")"
  case "$HOME_DIR/" in
    "$root"/*)
      echo "eval-sandbox-setup: CRT_HOME $HOME_DIR is inside $root; put it outside \$HOME, /tmp and the repo (e.g. /data/crt/home/\$USER); run 'crt doctor --limits' to check the install" >&2
      exit 1 ;;
  esac
done

if [ "${1:-}" != --check ] && [ ! -e "$RESOLVED_HOME/$ROOTFS" ]; then
  "$CRT" create "$ROOTFS" "$ROOT/ci/jscad-eval.crt"
fi

EVAL_CRT="$CRT" exec node "$ROOT/packages/agent-loop/eval/sandbox.js" --check
