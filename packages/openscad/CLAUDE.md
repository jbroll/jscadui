# OpenSCAD Transpiler - Claude Code Instructions

## Critical Understanding

**All runtime errors are transpiler bugs.** The test examples consist of OpenSCAD files that run correctly in OpenSCAD itself. If the transpiled JavaScript produces a runtime error (ReferenceError, TypeError, assertion failure, etc.), the bug is in the transpiler, not the source code.

When debugging test failures:
1. The OpenSCAD source is known-good - it runs in OpenSCAD
2. Runtime errors mean the transpiler generated incorrect JavaScript
3. Shape mismatches mean the transpiler's geometric output differs from OpenSCAD's

## Testing Strategy

> **CRITICAL: Never run the full test suite locally.** The full comparison suite requires OpenSCAD binary, several GB of RAM, and takes many minutes. It will OOM or time out on a dev machine.

**Valid workflows:**
1. Debug individual failing models locally with `run-jscad.js` + `compare-stl.js`
2. Run unit tests locally with `npx vitest run`
3. Full comparison runs on the GPU host (same `ci/test` either way)

```bash
# Runs on GPU via simple-ci (when reachable from your session):
npm test          # rsyncs working tree, including uncommitted changes,
                  # streams log to stdout when done

# Runs on GPU by committing: push the branch (open a PR if none).
# ci/gpu-poll.mjs runs ci/gpu-test on the head commit and reports an
# `openscad-gpu` commit status plus a PR comment. A `success` status on
# the exact commit counts as GPU verification.

# OK locally — single file or single suite:
npx vitest run                                                      # unit tests (fast, local)
node bin/run-jscad.js path/to/file.scad -o /tmp/out.stl            # transpile+render one file
node bin/compare-stl.js ref.stl /tmp/out.stl                       # compare one file
node bin/test-harness.js path/to/one/file.scad                     # compare one file end-to-end

# DO NOT RUN LOCALLY — too slow/heavy:
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl     # entire suite
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/nopscadlib
npm run test:local
```

Setup: `ci/README.md`; session workflow: `docs/CLOUD_SESSION.md`.

> **NEVER work around CI.** `npm test` and gpu-poll are the only sanctioned ways to run the full comparison
> suite. Do not manually rsync to the GPU, do not SSH in and run test-harness by hand, do not
> improvise alternate CI paths. If both are unreachable (connection refused,
> host unreachable, simple-ci errors), **stop and investigate the CI issue first** or raise it
> with the user. A broken CI pipeline is a higher priority than any feature work — fix CI
> before proceeding with transpiler changes.

## Development Methodology

**One change, one test, one commit.** Transpiler changes are high-risk because regressions are hard to diagnose after the fact. Follow this workflow strictly:

1. **Make one small, focused change** — a single logical modification to the transpiler
2. **Run unit tests locally** — `npx vitest run` must pass (fast, seconds)
3. **Commit on a branch and push** (open a PR if there is none) — pushing re-runs the full suite on the GPU host
4. **Wait for `openscad-gpu` success on the exact head commit** — never stack unverified changes
5. **Record the run in `MODEL_COMPARISON_BASELINE.md`** — new `Latest GPU run` section with commit, branch/PR, job id, OpenSCAD version, and the suite table
6. **If a regression appears, fix it immediately** before moving on

Never combine multiple transpiler changes into one commit. Never merge through GitHub; fast-forward `main` as in root `CLAUDE.md`, and GitHub marks the PR merged.

**Baseline documentation** (`MODEL_COMPARISON_BASELINE.md`) is the source of truth:
- Any deviation from 100% on baseline suites is a regression that must be fixed
- When improvements are made (new models passing, new suites added), update the baseline document
- The baseline can only improve — never document regressions as the new baseline

## Architecture Overview

See `ARCHITECTURE.md` for full details. Key points:

- **Namespace separation**: Functions use `_$f` suffix, modules use `_$m` suffix
- **Curried modules**: `module_$m(args)(children)` pattern
- **Let bindings**: Use unique suffixes (`$1`, `$2`, etc.) to avoid shadowing
- **Local variables**: Tracked in `ctx.localFunctionBindings` so calls don't get `_$f` suffix

## Common Bug Patterns

1. **`foo_$f is not defined`** - A local variable or let binding is being called as a global function. Check if `foo` should be in `localFunctionBindings`.

2. **Double suffixes like `foo$63$63`** - The `replaceIdentifier` function is matching inside already-renamed identifiers. Check the regex word boundaries.

3. **Wrong arguments passed** - Named argument reordering may be using wrong parameter list. Check `moduleParamLists` vs `functionParamLists`.

4. **Missing arguments** - Parameter shadowing detection may have renamed a parameter incorrectly.
