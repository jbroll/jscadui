# JSCAD web app

This is the JSCAD web application hosted at https://jscad.rkroll.com

How the page, the compute frame, the API and storage fit together:
[docs/architecture.md](docs/architecture.md).

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

jscad.app does not read node_modules for now, but loads dependencies from jsdelivr, and some modules may be bundled with jscad.app to avoid going to jsdelivr. `@jscad/modeling` itself is loaded through the `@jbroll/jscad-anchors` CDN build, which wraps the engine's own modeling bundle (`@jscad/modeling-for-anchors`) and re-exports it plus `anchors`.

The bundle map lives in [src_frame/frame.js](src_frame/frame.js), not on the
page: a script source inside the compute frame has to come from the frame's
own origin, so the page sends an engine name (`jscad` or `manifold`) with
`jscadInit` and the frame fills in the map from its own `__BUNDLE_BASE__`,
covering `@jscad/modeling`, `@jscad/modeling-for-anchors`,
`@jscad/modeling-for-manifold`, `@jbroll/jscad-anchors`, `@jscad/io`,
`@jscadui/model-tools`, `@jbroll/jscad-fluent`, `@jscad/csg`,
`@jscadui/params-core` and `@jscadui/jscad-text`. Fluent models
(`require('@jbroll/jscad-fluent')`) resolve to the local `bundle.jscad-fluent.js`
build, which re-exports the fluent API over the shared modeling bundle and the
anchors CDN build; params work through the existing `@jscad-params` and
`getParameterDefinitions` paths.

The engine defaults to `manifold`, which renders 780 of the 789 bundled
examples against `jscad`'s 623 and is the one the STL comparison suite checks.
Modeling Engine in the menu switches it, and the choice is remembered.

## AI Chat

The app has an agent chat drawer (AI Chat in the menu) layered on the normal editor, viewer and examples. Describe a part, and the browser-local agent loop writes and measures models by calling tools that run in the browser: `eval`, `params`, `measure`, `check`, `export`, `view` and `writeModel` (`src/aiBridge.js`). The ones that execute model code go through the sandboxed compute frame below, the same one the editor uses. Provider HTTP goes to the relay at `https://jscad.rkroll.com`, overridable via `localStorage 'jscad-ai.relay'`.

Account setup lives in the drawer above the chat:

- Sign in with Google (session via the API at `/api`).
- Pick the provider (`anthropic` or an OpenAI-compatible `baseUrl`) and model name.
- Save the provider key with a custody mode: `session` (memory only), `device` (this browser), or `synced` (AES-GCM ciphertext only, needs a passphrase to unlock). The key travels to the API per chat request and never enters logs or the compute frame.

Tests: `npx vitest run test/aiChat.test.js` for the chat turn, `npx playwright test e2e/ai-chat.spec.js` for the full turn against a stub relay with real local measurements.

## Compute frame

All model code runs in the compute frame — the editor's as well as the
agent's. The frame is a page on its own origin (`https://jscad-run.rkroll.com`,
`http://localhost:5121` in dev) embedded in a hidden
`<iframe sandbox="allow-scripts">`. Without `allow-same-origin` the frame has
an opaque origin, so model code gets no cookies, no IndexedDB and no
same-origin fetch. The page keeps the viewer, the editor and every control. See
[docs/architecture.md](docs/architecture.md) for the boundary and the protocol.

The frame builds into `build/frame/` as part of the normal web build and
deploys to the run host from `deploy-run.conf`. The model engine is built only
there, into `build/frame/assets/`; the app origin ships the viewer bundles and
nothing that can run a model. Its CORS and frame-ancestors
headers are set in `build.js` (dev server), `serve.js` (`npm run serve`) and
`deploy/hooks/apache.configure.post.sh` (the deployed vhost, keyed by
`APP_NAME`). The app origin is baked into the frame's CSP and
`__ALLOWED_ORIGIN__` at build time; `FRAME_APP_ORIGIN` overrides it, and
`FRAME_RUN_ORIGIN` overrides the frame's own.

The app origin answers `Access-Control-Allow-Origin: *` on `/examples/` for
the same reason: an example resolves its sibling files over the network from
inside the frame, a cross-origin GET with a `null` origin. A `#url=` model
resolves its siblings against the app origin too — `main.js` passes it as the
base, not the model's own URL — while a demo browser example resolves against
its own directory.

Tests: `npx playwright test e2e/frame.spec.js` covers the sandbox boundary —
wrong-origin senders, storage access, and what authority a model's fetch
carries.

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

