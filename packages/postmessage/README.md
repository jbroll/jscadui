# @jscadui/postmessage

RPC over `postMessage`, for talking to a worker or an iframe. Wraps a
JSONRPC-like protocol (`{ method, params, id }` requests, `{ response, error,
id }` replies) so calls look like ordinary async function calls instead of
raw message events. Used by `@jscadui/fs-serviceworker` and the jscad-web
compute frame.

```js
import { messageProxy } from '@jscadui/postmessage'

// worker side: wrap your handler methods
const api = messageProxy(self, { add: (a, b) => a + b })

// caller side: wrap the worker/iframe and call methods on it
const remote = messageProxy(worker, {})
const sum = await remote.add(1, 2)
```

Exports: `messageProxy(target, handlers, options?)` returns a `Proxy` whose
methods send a request and return a promise of the response. `initMessaging(target,
handlers, options?)` is the lower-level form, returning `{ sendCmd, ... }`
instead of a `Proxy`. `withTransferable(value, transferable)` marks a return
value's payload to be sent as a `postMessage` transferable instead of copied.
`options`: `onJobCount`, `debug`, `allowedOrigin`.
