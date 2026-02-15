# OpenSCAD Transpiler - Claude Code Instructions

## Critical Understanding

**All runtime errors are transpiler bugs.** The test corpus consists of OpenSCAD files that run correctly in OpenSCAD itself. If the transpiled JavaScript produces a runtime error (ReferenceError, TypeError, assertion failure, etc.), the bug is in the transpiler, not the source code.

When debugging test failures:
1. The OpenSCAD source is known-good - it runs in OpenSCAD
2. Runtime errors mean the transpiler generated incorrect JavaScript
3. Shape mismatches mean the transpiler's geometric output differs from OpenSCAD's

## Test Commands

```bash
# Unit tests
npx vitest run

# Main corpus (should be 100%)
node bin/test-harness.js test/corpus

# BOSL v1 library tests (should be 100%)
node bin/test-harness.js test/corpus/bosl

# BOSL2 library tests (target: improve pass rate)
node bin/test-harness.js test/corpus/bosl2
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
