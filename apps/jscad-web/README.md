# JSCAD web app

This is the JSCAD web application hosted at https://jscad.rkroll.com

If you want to discuss jscad or jscadui, please join us on discord: https://discord.gg/6PB7qZ4HC7

## Running Locally

You must install modules from root of the project because it uses npm workspaces.

After cloning the project, go to the root folder of the checked out jscadui repo. Then install npm dependencies by running:

```
npm i
```

To start the local development server, go to the `apps/jscad-web` directory and run:

```
npm start
```

this will start the dev server without generating jscad docs, which is like ok 99% of time.

to start dev server that also has docs run

```
npm run start:full
```

NOTICE! - there is issue with nodejs 18 on linux `TypeError [ERR_FEATURE_UNAVAILABLE_ON_PLATFORM]: The feature watch recursively ` ... we did not investigate in detail, but using version 21+ should work



## External editor

You can edit your jscad scripts/projects in editor of your own choice and have jscad.app preview result when you save.

Just save your jscad script/project on your drive, and use drag&drop to drop the project folder or single script onto jscad.app. It will check file changes periodicaly and reload changed files.

For projects, you must drag&drop the folder and jscad.app will look into `package.json` for `main`. If you
do not have `package.json` then jscad.app will try following.

- index.js
- index.ts
- FOLDER_NAME.js
- FOLDER_NAME.ts

jscad.app does not read node_modules for now, but loads dependencies from jsdelivr, and some modules may be bundled with jscad.app to avoid going to jsdelivr. `@jscad/modeling` itself is loaded through the `@jbroll/jscad-anchors` CDN build, which wraps the engine's own modeling bundle (`@jscad/modeling-for-anchors`) and re-exports it plus `anchors`:

```js
const bundles = {
  // local bundled alias for common libs.
  '@jscad/modeling': 'https://cdn.jsdelivr.net/npm/@jbroll/jscad-anchors@0.1/dist/jscad-anchors.cjs',
  '@jbroll/jscad-anchors': 'https://cdn.jsdelivr.net/npm/@jbroll/jscad-anchors@0.1/dist/jscad-anchors.cjs',
  '@jscad/modeling-for-anchors': toUrl('./build/bundle.jscad_modeling.js'), // or bundle.manifold_modeling.js
  '@jscad/modeling-for-manifold': toUrl('./build/bundle.jscad_modeling.js'),
  '@jscad/io': toUrl('./build/bundle.jscad_io.js'),
  '@jscad/csg': toUrl('./build/bundle.V1_api.js'),
  '@jbroll/jscad-fluent': toUrl('./build/bundle.jscad-fluent.js'),
}
```

See [bundles.js](bundles.js) for the exact mapping, including the params-core and jscad-text bundles. Fluent models (`require('@jbroll/jscad-fluent')`) resolve to the local `bundle.jscad-fluent.js` build, which re-exports the fluent API over the shared modeling bundle and the anchors CDN build; params work through the existing `@jscad-params` and `getParameterDefinitions` paths.

Set `window.jscadModuleOverrides` before `main.js` runs to replace any of these URLs (for example with a local package build served by a studio). Each name overrides independently; `@jscad/modeling` defaults to the local `bundle.jscad_modeling.js` build.

## AI Chat

The app has an agent chat drawer (AI Chat in the menu) layered on the normal editor, viewer and examples. Describe a part, and the browser-local agent loop writes and measures models by calling tools that run in the browser: `eval`, `params`, `measure`, `check`, `export`, `view` and `writeModel` (`src/aiBridge.js`). The ones that execute model code go through the sandboxed compute frame below. Provider HTTP goes to the relay at `https://jscad.rkroll.com`, overridable via `localStorage 'jscad-ai.relay'`.

Account setup lives in the drawer above the chat:

- Sign in with Google (session via the API at `/api`).
- Pick the provider (`anthropic` or an OpenAI-compatible `baseUrl`) and model name.
- Save the provider key with a custody mode: `session` (memory only), `device` (this browser), or `synced` (AES-GCM ciphertext only, needs a passphrase to unlock). The key travels to the API per chat request and never enters logs or the compute frame.

Tests: `npx vitest run test/aiChat.test.js` for the chat turn, `npx playwright test e2e/ai-chat.spec.js` for the full turn against a stub relay with real local measurements.

## Compute frame

Agent-written model code runs in `/frame/`, a page served from this app's own
origin and embedded in a hidden `<iframe sandbox="allow-scripts">`. Leaving
`allow-same-origin` off is deliberate: it gives the frame an opaque origin, so
model code gets no cookies, no IndexedDB and no same-origin fetch, and the
frame page's CSP limits `connect-src` to `/frame/` and the jsdelivr CDN. The
editor still compiles through the local worker; only the agent's `eval`,
`measure`, `check` and `export` calls cross into the frame
(`src/frameClient.js` on this side, `src_frame/` on the other). The agent's
`params` tool re-runs the model on the local worker, outside the sandbox.

The browser treats the frame as cross-origin even though it is same-host, so it
needs CORS and frame-ancestors headers of its own. Three places set them and
must agree:

- `build.js` — dev server middleware.
- `serve.js` — production preview server (`npm run serve`).
- `deploy/hooks/apache.configure.post.sh` — the deployed vhost.

`build.js` also bakes the app origin into the frame page's CSP and into
`__ALLOWED_ORIGIN__`, which `src_frame/frame.js` checks on every inbound
message. A dev build uses `http://localhost:<port>` and a production build
`https://jscad.rkroll.com`; `FRAME_APP_ORIGIN` overrides both.

The frame builds into `build/frame/` as part of the normal web build, with no
deploy step of its own.

Tests: `npx playwright test e2e/frame.spec.js` covers the sandbox boundary —
wrong-origin senders, storage access and fetches against the app origin.

## Storage

Model files are local-first with per-project version history (`src/storage/`).
Every editor compile and `writeModel` save records a version row plus file
hashes, in both modes:

- `local` mode (default) keeps bytes in the service-worker FS and file
  handles, as before. Anonymous users are local-only.
- `rowboat` mode stores bytes as blobs through rowboat file routes, with
  projects, files, versions and conversations in rowboat tables compiled from
  `src/storage/schema.js`. Sign-in starts the interval sync loop with a
  short-lived JWT from the app API's `GET /api/sync-token` (15m expiry, served by `server/` in this dir).
- Mixed projects merge at load time: each manifest path names exactly one
  backend, and unlisted sibling requires resolve local-first, then rowboat.
- Chat conversations persist per project and resume on revisit.
- Any project exports or imports as a zip (`exportZip`/`importZip`).

`src/storage/manifest.js` is generated from `schema.js`; regenerate with
`node scripts/gen-manifest.js` after editing the schema (a parity test fails
on drift). `main.js` imports the storage leaves directly, never the index,
because the index re-exports zod-typed schema the root TS 4.9 gate cannot
parse (see root `tsconfig.json`).

Tests: `npx vitest run test/storage-` covers the interface contract, the
rowboat backend against a recorded sync transcript, map assembly, zip round
trip, write-through session, sync loop, and manifest parity.

The Projects drawer lists projects across both backends, with per-project
version history (restore appends a new row) and a local/rowboat mode toggle
(rowboat needs sign-in). Dropping files onto a project row merges them as a
subfolder; dropping onto the page creates a project. Drawer tabs stack
vertically so the editor, project, and AI panels stay reachable together.

## Deployment

To start the production server run:

```
npm run serve
```

# using url to load external script and CORS

If you want to share a script from your website you should setup CORS, and make sure to use HTTPS!

if you do not setup CORS [jscad.app](https://jscad.app) can fallback to `/remote` to download the script, but this workaround  may not be available forever (such enpoint could be abused to hide IP for attacks).


For hostings (that are uaually cheap and abundant) on CPanel adding .htaccess to your folder should work.
```
<IfModule mod_headers.c>
Header set Access-Control-Allow-Origin "*"
Header set Access-Control-Allow-Headers "origin, x-requested-with, content-type"
Header set Access-Control-Allow-Methods "PUT, GET, POST, DELETE, OPTIONS"
</IfModule>
```

If you are using github you should be fine, as gists and github pages have those CORS headers.

# using data url

you can use data url to pack the script into the url

- [example](https://jscad.app/#data:application/javascript;base64,bW9kdWxlLmV4cG9ydHM9ZnVuY3Rpb24gbWFpbigpe3JldHVybiByZXF1aXJlKCdAanNjYWQvbW9kZWxpbmcnKS5wcmltaXRpdmVzLnNwaGVyZSh7cmFkaXVzOiA0MH0pfQ==)

*NOTICE: utf8 encoding is assumed when converting bytes to string*

# using data url and gzip

you can also use gzip to minimize the length of the url.

- [example](https://jscad.app/#data:application/gzip;base64,H4sICN1FqGUAA3Rlc3QADcrBDkAwDADQu6/YjV3GxUUi8SuLFRXrpl1FIv6dd34xBT3AwZ0TFxkXpblgIhM9UmMfhqJMhuFUZGjqaZfZhzamAAfSWluXGSMWvECc5A3+9LAPqDKYvnvtW33S8ZutYgAAAA==)

*NOTICE: utf8 encoding is assumed when converting bytes to string*

# using github gists to share scripts

- To reference latest version, no commit hash should be in URL:
- max-age=300 for raw gist cannot be lowered
- publish change, wait for 5 minutes before sharing with ppls that gist was changed

