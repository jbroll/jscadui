#!/bin/sh
# Merge the current branch into main, gated on green simple-ci.
#
#   scripts/ship.sh
#
# Resolves the branch HEAD's CI tag (commit-<sha>, pushed by the post-commit
# hook), waits for it, and fast-forwards main plus pushes only on pass.
# Anything else refuses, leaving the branch in place.
set -eu

BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "main" ]; then
  echo "ship: already on main; checkout the branch to merge"
  exit 2
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ship: dirty working tree; commit or stash first"
  exit 2
fi

TAG="commit-$(git rev-parse --short HEAD)"
echo "ship: waiting for CI $TAG (branch $BRANCH)..."
if ! sci wait "$TAG"; then
  echo "ship: CI red or missing; merge refused"
  exit 1
fi
git checkout main
git merge --ff-only "$BRANCH"
git push
echo "ship: $BRANCH merged to main"
