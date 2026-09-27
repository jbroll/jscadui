#!/bin/bash
# Set up a linked worktree to reuse the main checkout's heavy state.
# Links .deps-cache and the sibling checkouts that jscad-web's build resolves
# via ../../../, and builds a node_modules whose workspace links resolve into
# the worktree's own packages (a plain symlink would load stateful modules
# twice: package imports from the parent, relative imports worktree-local).
# in seconds instead of a full npm install + fetch-deps + fetch-sources.
# See docs/CLOUD_SESSION.md for the cloud equivalent (session-start.sh),
# which installs from scratch because there is no parent checkout there.
#
# Usage: scripts/setup-worktree.sh [<worktree-path>]   (default: cwd)
set -euo pipefail

worktree="${1:-$PWD}"
worktree="$(cd "$worktree" && pwd -P)"
# Convention: worktrees live in <main>/.worktrees/<name>.
main="$(dirname "$(dirname "$worktree")")"

# Build worktree/node_modules as a real directory: workspace links are
# copied verbatim (their relative text then resolves into the worktree's own
# packages), everything else links back to the parent install. A plain
# symlink of the whole directory makes package imports resolve to the parent
# while relative imports stay worktree-local, loading stateful modules twice.
build_node_modules() {
  local main="$1" worktree="$2" src="$main/node_modules" dst="$worktree/node_modules"
  rm -f "$dst"  # replace a whole-dir symlink from an older run of this script
  mkdir -p "$dst"
  local entry base sub
  for entry in "$src"/@*; do
    [ -e "$entry" ] || continue
    base="$(basename "$entry")"
    if [ -L "$entry" ]; then
      cp -P "$entry" "$dst/$base"
    else
      mkdir -p "$dst/$base"
      for sub in "$entry"/*; do
        [ -e "$sub" ] || continue
        if [ -L "$sub" ]; then
          cp -P "$sub" "$dst/$base/$(basename "$sub")"
        else
          ln -sfn "$sub" "$dst/$base/$(basename "$sub")"
        fi
      done
    fi
  done
  for entry in "$src"/*; do
    [ -e "$entry" ] || continue
    base="$(basename "$entry")"
    [[ "$base" == @* || "$base" == .* ]] && continue
    if [ -L "$entry" ]; then
      cp -P "$entry" "$dst/$base"
    else
      ln -sfn "$entry" "$dst/$base"
    fi
  done
  # Share the parent's binaries; npm run / npx resolve them from here.
  [ -e "$dst/.bin" ] || ln -sfn "$src/.bin" "$dst/.bin"
  echo "built: node_modules with worktree-local workspace links"
}

for d in node_modules .deps-cache; do
  if [ -e "$worktree/$d" ] && [ ! -L "$worktree/$d" ]; then
    echo "keep: $d already exists in $worktree"
  elif [ -d "$main/$d" ]; then
    if [ "$d" = node_modules ]; then
      build_node_modules "$main" "$worktree"
    else
      ln -sfn "$main/$d" "$worktree/$d"
      echo "linked: $d -> $main/$d"
    fi
  else
    echo "missing: $main/$d not found; run npm install / fetch-deps in $main first" >&2
  fi
done

# Workspace packages keep their own node_modules (per-package dev deps such
# as typescript); link the ones missing in the worktree.
while IFS= read -r d; do
  if [ ! -e "$worktree/$d" ] && [ -d "$main/$d" ]; then
    ln -s "$main/$d" "$worktree/$d"
    echo "linked: $d -> $main/$d"
  fi
done < <(cd "$main" && find packages apps file-format -maxdepth 3 -name node_modules -type d 2>/dev/null)

# Sibling checkouts beside the main checkout (rowboat, OpenJSCAD.org).
# From the worktree they resolve at <main>/.worktrees/<sibling>.
wt_parent="$(dirname "$worktree")"
for s in rowboat OpenJSCAD.org; do
  if [ -e "$wt_parent/$s" ]; then
    echo "keep: $s already beside worktrees"
  elif [ -d "$main/../$s" ]; then
    ln -s "$main/../$s" "$wt_parent/$s"
    echo "linked: $s beside worktrees"
  else
    echo "skip: no $s checkout beside $main" >&2
  fi
done

# Symlinks-to-directories are not matched by the trailing-slash patterns in
# .gitignore, so keep them out of git status via the local exclude file.
exclude="$(git -C "$worktree" rev-parse --git-common-dir)/info/exclude"
for d in node_modules .deps-cache; do
  if ! git -C "$worktree" check-ignore -q "$d" 2>/dev/null; then
    grep -qx "$d" "$exclude" 2>/dev/null || echo "$d" >> "$exclude"
    echo "excluded: $d in git info/exclude"
  fi
done

# The openscad bundle entry imports @jscadui/openscad, whose package main is
# the tsc-built esm/ output, absent in a fresh worktree. Build it before the
# web bundles, which resolve it through the worktree's own packages.
if [ ! -d "$worktree/packages/openscad/esm" ]; then
  (cd "$worktree/packages/openscad" && npm run build)
fi

# Bundle artifacts are gitignored and cannot be symlinked usefully, so build
# them once per worktree. This is the fast esbuild script (not a full turbo
# build); fluent-worker tests and the pre-commit gate need it.
(cd "$worktree/apps/jscad-web" && node build.js)

echo "done."
