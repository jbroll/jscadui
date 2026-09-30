# @jscadui/worker

The web worker that runs JSCAD model scripts: it loads a script, calls its
`main` with parameters, and converts the solids to render entities. The
app's compute frame (`apps/jscad-web/src_frame/bundle.frame-worker.js`)
builds on it, and the method protocol is in
[docs/WORKER_PROTOCOL.md](../../docs/WORKER_PROTOCOL.md).

```js
import { initWorker } from '@jscadui/worker'

initWorker({ transform, customHandlers: { jscadSetFiles } })
```

## Transform rule

`jscadScript` passes a script through the host's `transform` only when
`shouldTransform(url, script)` (`src/shouldTransform.js`) holds: the URL ends
in `.ts`, or the script contains `import` and has an import line or an
`export … from` line. The chat's eval backend imports the same function, so
it loads model code as the frame does.

## Run hooks

The worker reports what a run logged and which options it misused without
holding any of the code that decides either. The host installs two
collectors, each `{ reset(), list() }`:

- `setRunWarnings(collector)`: option warnings. The frame passes the
  collector from `@jscadui/agent-loop`'s `createWarningCollector`.
- `setRunConsole(collector)`: the model's console lines.
- `setRunSummary(summarize)`: turns a scratch run's `{ hasMain, value }` into
  plain data for its answer. The frame passes `@jscadui/agent-loop`'s
  `summarizeRun` with `@jscadui/model-tools`' `measure`, so the chat's `run`
  answers `geometry` or a `returned` preview as the eval does.

`jscadScript` resets both before the module loads. A `jscadMain` re-run (a
parameter change) resets the console before `main` runs, so it reports only
its own lines, never those of the load or of a scratch run before it. It keeps
the warnings, so a parameter change reports the load's warnings plus its own,
with duplicates dropped by the collector. A result carries `warnings` and `console` only when
they are non-empty.

## Tests

```bash
npx vitest run --root packages/worker
```
