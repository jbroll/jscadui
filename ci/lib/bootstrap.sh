#!/usr/bin/env bash
# The steps that bring a checkout's gitignored state up to date before it
# builds or tests. CI entries, deploy-full.sh, setup-worktree.sh, the cloud
# SessionStart hook, `npm run setup` / `generate-all` and the jscad
# launcher's tracking refresh all run their preamble through here.
#
#   ci/lib/bootstrap.sh [--root DIR] [--dry-run] STEP...
#   . ci/lib/bootstrap.sh; bootstrap [--root DIR] [--dry-run] STEP...
#
# Named steps run in this order, whatever order they are given in:
#   sources    node scripts/fetch-sources.js
#   install    npm install --no-audit --no-fund
#   ci         npm ci (in place of install)
#   deps       node scripts/fetch-deps.js --if-missing
#   grids      node packages/openscad/bin/generate-all-files.js --no-rename
#   examples   npm run sync-examples in apps/jscad-web
#   openscad   npm run build in packages/openscad
#   workspace  npm run build -- --continue; a failure is reported, not fatal
#   app        npm run build in apps/jscad-web
#
# --root defaults to the checkout holding this file. --dry-run prints the
# commands without running them. The first failing step ends the run with its
# status. Sourcing defines `bootstrap` and leaves the caller's shell options
# alone.

_bootstrap_home="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_bootstrap_order="sources install ci deps grids examples openscad workspace app"

_bootstrap_run() {
  local root="$1" dry="$2" dir="$3"
  shift 3
  echo "bootstrap: ${dir:+($dir) }$*"
  [ "$dry" = 1 ] && return 0
  (cd "$root/$dir" && "$@")
}

_bootstrap_step() {
  local r=("$1" "$2")
  case "$3" in
    sources) _bootstrap_run "${r[@]}" "" node scripts/fetch-sources.js ;;
    install) _bootstrap_run "${r[@]}" "" npm install --no-audit --no-fund ;;
    ci) _bootstrap_run "${r[@]}" "" npm ci ;;
    deps) _bootstrap_run "${r[@]}" "" node scripts/fetch-deps.js --if-missing ;;
    # --no-rename keeps numeric prefixes, which the render baselines depend on.
    grids) _bootstrap_run "${r[@]}" "" node packages/openscad/bin/generate-all-files.js --no-rename ;;
    examples) _bootstrap_run "${r[@]}" apps/jscad-web npm run sync-examples ;;
    openscad) _bootstrap_run "${r[@]}" packages/openscad npm run build ;;
    # An unrelated package failing must not block the builds callers check for.
    workspace) _bootstrap_run "${r[@]}" "" npm run build -- --continue \
      || echo "bootstrap: workspace build had failures (continuing)" ;;
    app) _bootstrap_run "${r[@]}" apps/jscad-web npm run build ;;
  esac
}

bootstrap() {
  local root="$_bootstrap_home" dry=0 wanted=" " step
  while [ $# -gt 0 ]; do
    case "$1" in
      --root)
        [ $# -ge 2 ] || { echo "bootstrap: --root needs a directory" >&2; return 2; }
        root="$2"
        shift 2
        ;;
      --dry-run) dry=1; shift ;;
      *)
        if [[ " $_bootstrap_order " != *" $1 "* ]]; then
          echo "bootstrap: unknown step '$1' (steps: $_bootstrap_order)" >&2
          return 2
        fi
        wanted+="$1 "
        shift
        ;;
    esac
  done
  if [ "$wanted" = " " ]; then
    echo "usage: bootstrap [--root DIR] [--dry-run] STEP... (steps: $_bootstrap_order)" >&2
    return 2
  fi
  if [[ $wanted == *" install "* && $wanted == *" ci "* ]]; then
    echo "bootstrap: install and ci are alternatives; name one" >&2
    return 2
  fi
  [ -d "$root" ] || { echo "bootstrap: no directory $root" >&2; return 2; }
  for step in $_bootstrap_order; do
    [[ $wanted == *" $step "* ]] || continue
    _bootstrap_step "$root" "$dry" "$step" || return
  done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  bootstrap "$@"
fi
