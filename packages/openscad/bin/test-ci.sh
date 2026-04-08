#!/usr/bin/env bash
#
# test-ci.sh — Run the full OpenSCAD test suite.
#
# Tries to submit to the GPU via simple-ci (which handles host probing
# and tunnelling automatically). If sci is not available or the job
# fails to submit, falls back to a local run with reduced concurrency
# so the laptop doesn't OOM.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"

LOCAL_MAX_WORKERS=5          # safe ceiling for a laptop
SCI="$REPO_ROOT/../simple-ci/sci"

# ── Dispatch ──────────────────────────────────────────────────────────────────

if [[ -x "$SCI" ]]; then
  cd "$REPO_ROOT"
  if JOB=$("$SCI" push jscadui/packages/openscad/test:local 2>/dev/null); then
    echo "✓ Job submitted — waiting for results"
    "$SCI" wait "$JOB"
    exit $?
  fi
fi

echo "⚠ GPU unavailable — running locally (max $LOCAL_MAX_WORKERS workers)"
cd "$PKG_DIR"
OPENSCAD_MAX_WORKERS="$LOCAL_MAX_WORKERS" npm run test:local
