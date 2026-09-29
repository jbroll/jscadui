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

## Run hooks

The worker reports what a run logged and which options it misused without
holding any of the code that decides either. The host installs two
collectors, each `{ reset(), list() }`:

- `setRunWarnings(collector)`: option warnings. The frame passes the
  collector from `@jscadui/agent-loop`'s `createWarningCollector`.
- `setRunConsole(collector)`: the model's console lines.

`jscadScript` resets both before the module loads. `jscadMain` does not, so a
parameter change reports the load's warnings plus its own, with duplicates
dropped by the collector. A result carries `warnings` and `console` only when
they are non-empty.

## Tests

```bash
npx vitest run --root packages/worker
```
