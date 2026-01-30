#!/bin/sh
# Setup git hooks for jscadui

# Configure git to use custom hooks directory
git config core.hooksPath .git-hooks

# Make hooks executable
chmod +x .git-hooks/*

echo "Git hooks configured! Pre-commit hook will run lint, typecheck, and tests."
