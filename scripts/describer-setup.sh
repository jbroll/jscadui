#!/usr/bin/env bash
# Installs and checks the eval's describer: Moondream 3.1 through kestrel,
# pinned, in a venv under DESCRIBER_HOME (packages/agent-loop/eval/describer/).
#
#   scripts/describer-setup.sh          install the venv and weights, then check
#   scripts/describer-setup.sh --check  check only (ci/eval-complex)
#
# DESCRIBER_HOME defaults to /data/moondream3 (venv/, hf/); the user the eval
# runs as must be able to read it. DESCRIBER_PYTHON picks the interpreter the
# venv is made from (default python3).
set -euo pipefail

HOME_DIR="${DESCRIBER_HOME:-/data/moondream3}"
VENV="$HOME_DIR/venv"
PY="$VENV/bin/python"
MOONDREAM=2.6.1
KESTREL=0.9.1
export HF_HOME="$HOME_DIR/hf"

fail() {
  echo "describer: $1" >&2
  exit 1
}

# Fetches the model and its tokenizer into HF_HOME; with HF_HUB_OFFLINE=1 it only checks they are there.
weights() {
  "$PY" - <<'PY'
from huggingface_hub import snapshot_download
from kestrel.model_download import ensure_model_weights

ensure_model_weights("moondream3.1-9B-A2B")
snapshot_download("moondream/starmie-v1")
PY
}

if [ "${1:-}" != --check ]; then
  mkdir -p "$HOME_DIR"
  [ -x "$PY" ] || "${DESCRIBER_PYTHON:-python3}" -m venv "$VENV"
  "$PY" -m pip install --quiet "moondream==$MOONDREAM" "kestrel==$KESTREL"
  weights
fi

[ -x "$PY" ] || fail "no venv at $VENV: run scripts/describer-setup.sh (DESCRIBER_HOME=$HOME_DIR)"
for pin in "moondream==$MOONDREAM" "kestrel==$KESTREL"; do
  name="${pin%%==*}"
  want="${pin#*==}"
  have="$("$PY" -c 'import sys, importlib.metadata as m; print(m.version(sys.argv[1]))' "$name" 2>/dev/null)" || fail "$name is not installed in $VENV: run scripts/describer-setup.sh"
  [ "$have" = "$want" ] || fail "$name $have is installed, the pin is $want: run scripts/describer-setup.sh"
done
"$PY" -c 'import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)' 2>/dev/null || fail "torch in $VENV cannot see a CUDA device"
HF_HUB_OFFLINE=1 weights 2>/dev/null || fail "the weights are not in $HF_HOME: run scripts/describer-setup.sh"
command -v nvidia-smi >/dev/null || fail "no nvidia-smi on PATH"
echo "describer: ready"
