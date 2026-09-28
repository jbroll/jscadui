# @jscadui/fs-serviceworker

Service worker that serves files it caches on behalf of `@jscadui/fs-provider`,
so the sandboxed compute frame can `fetch` files that live in the app's page
context (the frame has no filesystem or IndexedDB access of its own). Used by
`apps/jscad-web`'s local model directory.

The worker registers `/swfs/init` to learn a client's id, then serves any
request under `/swfs/<clientId>/<path>` from its per-client cache, asking the
client for the file over `@jscadui/postmessage` on a cache miss.

```js
// registered directly as the service worker script, query params configure it
navigator.serviceWorker.register('bundle.fs-serviceworker.js?prefix=/swfs/')
```

`prefix` (default `/swfs/`) and `debug` are read from the service worker
script's own URL query string.
