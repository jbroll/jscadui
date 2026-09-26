#!/bin/bash
# SessionStart hook for Claude Code on the web: makes the transpiler, the
# openscad unit tests and single-model comparisons runnable. See
# docs/CLOUD_SESSION.md. Does nothing outside cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Pinned source checkouts that package.json file: deps point into.
node scripts/fetch-sources.js
npm install --no-audit --no-fund
# Third-party OpenSCAD corpora (gitignored); no-op when current.
node scripts/fetch-deps.js --if-missing
npm run build --workspace=@jscadui/openscad

# OpenSCAD for reference STLs (test-harness.js / single-model compares). Uses
# --backend=manifold, which needs a recent snapshot; distro 2021.01 lacks it.
# Optional: a failure here leaves the rest of the setup usable.
if ! command -v openscad >/dev/null || ! openscad --help 2>&1 | grep -q -- '--backend'; then
  (
    set -e
    dir="$HOME/.local/openscad"
    snap=$(curl -fsSL https://files.openscad.org/snapshots/ \
      | grep -o 'OpenSCAD-[0-9.]*-x86_64\.AppImage' | sort -u | tail -1)
    mkdir -p "$dir" "$HOME/.local/bin"
    curl -fsSL "https://files.openscad.org/snapshots/$snap" -o "$dir/openscad.AppImage"
    chmod +x "$dir/openscad.AppImage"
    (cd "$dir" && rm -rf squashfs-root && ./openscad.AppImage --appimage-extract >/dev/null)
    ln -sf "$dir/squashfs-root/AppRun" "$HOME/.local/bin/openscad"
    echo "session-start: installed $snap"
  ) || echo "session-start: OpenSCAD install failed; comparisons need 'openscad' on PATH" >&2
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
