# Mutual tail calls: a trial that did not pay

Tried in September 2026 to get dotSCAD's `maze3d_mickey.scad` to render in a
browser worker. It halved the stack the model needs but did not fit it, and
nothing else in the corpus needed it, so it was not merged. The code is on the
local branch `mutual-tail-calls`.

## What was built

`tailCall.ts` only trampolines a function calling itself. The trial extended
it to groups of top-level functions in one file that call each other in a
cycle (Tarjan SCC over the call graph), with at least one tail call between
two members.

- Each member compiled to a raw `name_$f$t` whose tail calls to members return
  `{__bounce__: true, fn, args: [...]}`, and an entry `name_$f` that runs the
  bounces, so callers outside the group saw no change.
- A group call that was a let binding's whole value was unwrapped in the
  caller's own frame (`let x = f(...); while (x?.__bounce__) ...`), which is
  what gave one frame per recursion level. Other non-tail group calls went
  through a new `j$.trampoline`.
- Tail calls that pass `$` variables, or sit under a let that binds one, were
  not bounced, so the callee still ran inside `j$.withScope`.
- Call sites reached the raw function as `name_$f.$t ?? name_$f`, and the
  entry set `.$t` on itself when it ran. A static `name_$f.$t = ...` does not
  work: an including file that redefines a member emits a second
  `function name_$f`, the later one wins the binding, and the assignment would
  attach the library's raw function to the redefinition.

Size: 226 added lines across six files, most in `tailCall.ts`, plus 10 tests.
Unit tests and typecheck passed; the GPU corpus was never run.

## Measurements

Smallest Node `--stack-size` at which `maze3d_mickey.scad` renders through
`bin/run-jscad.js`:

| | stack needed |
|---|---|
| `main` (two frames a level) | 1,700 – 2,000 KB |
| trial (one frame a level) | 800 – 900 KB |

Interpreter-only (`--no-maglev --no-turbofan`) is no better, so JIT inlining
is not what fills the frame. A synthetic frame of the `go_maze` shape
(11 parameters, five unwrapped calls) costs about 281 bytes; without the
`resolveUndef` preamble, about 246.

## Why it cannot fit

It was assumed the maze recursed about 977 levels. It recurses about 3,000:
the mickey mask leaves 4,122 open cells, and a depth-first carve can go nearly
that deep, which matches 850 KB at 281 bytes a level. A Chromium worker holds
about 1,920 frames of this shape, roughly 530 KB. Fitting 3,000 levels would
take under about 175 bytes a level, and the parameters plus V8's fixed frame
overhead use most of that before any locals. No frame-level transpiler change
gets this model into a worker.

## If this comes up again

Mutual tail-call elimination is worth its complexity only if a corpus model
overflows by less than half. Check the real recursion depth first; count the
work the recursion walks rather than trusting a frame estimate.
