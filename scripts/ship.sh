#!/bin/sh
# Land a branch onto main, gated on green simple-ci.
#
#   scripts/ship.sh [BRANCH] [--dry-run]
#
# Conventions (adopted from `land`, which does the landing mechanics: lock,
# rebase-if-behind, ff-merge, push, hooks):
# - Run from anywhere: BRANCH defaults to the current worktree's branch, and
#   the merge itself always happens in the main checkout, never here.
# - The main checkout stays on `main`. Do not park it on a holding branch:
#   `land` refuses unless the main repo is on `main`.
# - The exact tree being landed must be CI-green. `land` may rebase a behind
#   branch, which voids the green tag, so a rebase is detected afterwards and
#   the landed tree is gated too.
#
# Resolves the branch HEAD's CI tag (commit-<sha>, pushed by the post-commit
# hook), waits for it, lands via `land`, and pushes only on pass.
# Anything else refuses, leaving the branch in place.
set -eu

usage() {
  echo "usage: scripts/ship.sh [BRANCH] [--dry-run]"
}

DRY_RUN=0
BRANCH=""
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
    -*) echo "ship: unknown flag '$arg'" >&2; usage >&2; exit 2 ;;
    *) if [ -n "$BRANCH" ]; then usage >&2; exit 2; fi; BRANCH="$arg" ;;
  esac
done

if [ -z "$BRANCH" ]; then
  BRANCH=$(git branch --show-current)
fi
if [ "$BRANCH" = "main" ]; then
  echo "ship: refusing to land main onto itself"
  exit 2
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ship: dirty working tree; commit or stash first"
  exit 2
fi
if ! TIP=$(git rev-parse --verify --quiet "$BRANCH"); then
  echo "ship: unknown branch '$BRANCH'"
  exit 2
fi
AHEAD=$(git rev-list --count "main..$BRANCH")
if [ "$AHEAD" = "0" ]; then
  echo "ship: '$BRANCH' has no commits ahead of main; nothing to land"
  exit 0
fi

TAG="commit-$(git rev-parse --short "$TIP")"
LAND_BIN="${LAND_BIN:-land}"
if ! command -v "$LAND_BIN" >/dev/null 2>&1; then
  echo "ship: '$LAND_BIN' not found on PATH; landing needs it"
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "ship: would wait for CI $TAG (branch $BRANCH, $AHEAD commit(s)), then land it"
  exit 0
fi

echo "ship: waiting for CI $TAG (branch $BRANCH)..."
if ! sci wait "$TAG"; then
  echo "ship: CI red or missing for $TAG; push the tree first ('sci push jscadui/test -t $TAG --supersede'), then re-run"
  exit 1
fi
"$LAND_BIN" "$BRANCH"

# `land` rebases a behind branch, which replaces the green tree with a new
# one. Detect that and gate the landed tree too; a red landed tree must be
# investigated or reverted, never left silently.
if [ "$(git rev-parse main)" != "$TIP" ]; then
  echo "ship: land rebased $BRANCH; landed tree differs from green $TAG"
  NEWTAG="commit-$(git rev-parse --short main)"
  sci push jscadui/test -t "$NEWTAG" --supersede | tail -1
  echo "ship: waiting for CI $NEWTAG (landed tree)..."
  if ! sci wait "$NEWTAG"; then
    echo "ship: LANDED TREE $NEWTAG IS RED; investigate or revert main now"
    exit 1
  fi
fi
echo "ship: $BRANCH landed on main, green"
