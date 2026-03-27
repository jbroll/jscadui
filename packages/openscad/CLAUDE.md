# OpenSCAD Transpiler - Claude Code Instructions

## Critical Understanding

**All runtime errors are transpiler bugs.** The test examples consist of OpenSCAD files that run correctly in OpenSCAD itself. If the transpiled JavaScript produces a runtime error (ReferenceError, TypeError, assertion failure, etc.), the bug is in the transpiler, not the source code.

When debugging test failures:
1. The OpenSCAD source is known-good - it runs in OpenSCAD
2. Runtime errors mean the transpiler generated incorrect JavaScript
3. Shape mismatches mean the transpiler's geometric output differs from OpenSCAD's

## Testing Strategy

The full comparison suite (bosl, bosl2, nopscadlib, snippet, 01-basics, text) runs OpenSCAD and renders hundreds of STL files. This requires several GB of RAM and takes several minutes — **it runs on gpu via simple-ci, not locally**.

**Use remote CI for full suite validation:**
```bash
npm test          # rsyncs to gpu, runs full suite, streams log to stdout when done
                  # progress dots on stderr while waiting; exits 0/1 for pass/fail
```

**Use local commands for debugging individual models:**
```bash
npx vitest run                                                      # unit tests (fast, local)
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl/some_module.scad
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl   # one suite
node bin/test-harness.js ../../apps/jscad-web/examples/openscad/bosl2  # one suite
npm run test:local   # all suites locally (only if gpu unavailable — slow, memory-intensive)
```

The workflow is: iterate locally on individual failing models using `test-harness.js`, then run `npm test` to confirm nothing else regressed.

**Known permanent failure:** nopscadlib passes ~7% (pre-existing transpiler gaps, not regressions).

To watch CI progress in real time:
```bash
ssh gpu 'tail -f ~/ci-logs/$(ls -t ~/ci-logs/*.log | head -1)'
```

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
