# Local startup design (2026-09-27)

Single command run from a model working directory that boots app + frame + relay. Option A from brainstorming.

## 1. CLI and checkout resolution

- Command: `jscad [dir|file] [--port N] [--build|--no-build]`, run from the model dir. No arg defaults to `.`.
- Resolves the jscadui checkout root from the script's own path, so it works from an installed build or a dev checkout.
- Output dir: `build/` if present, else `build_dev/`. If neither exists, or `--build` is passed, run the web build first; `--no-build` fails fast with a hint instead.
- Entry resolution: explicit file wins. Else `package.json` main, then `index.js`, then `<dirname>.js`, then first `*.js` (mirrors drag-drop rules).

## 2. Single-process server

- One node process serves three things:
  - App static on `PORT` (default `7377`, `JSCAD_PORT`/`--port` override), reusing `apps/jscad-web/serve.js` handlers with `Access-Control-Allow-Origin: *` for example/model reads.
  - Compute frame from `<out>/frame` on `PORT+1` with `frame-ancestors` set to the app origin (same helper as `serveFrame`).
  - Model dir mounted read-only at `/models/` (no symlink/copy into `examples/`).
- Relay via the existing `mountRelayRoutes` on the app origin at `/api/relay/:kind`, with a local allowlist file defaulting to anthropic + openai (`RELAY_ALLOWLIST` override) and `trustedOrigins=[appOrigin]`.
- No auth, no db, no rowboat, no prod dependency. `rkroll.com` is used only when the page itself is served from there; locally the relay is same-origin so no `localStorage jscad-ai.relay` override is needed.

## 3. Open URL, errors, tests

- Opens `http://localhost:PORT/#url=/models/<entry>`.
- Errors: missing out dir tells how to build; unreadable model dir lists a 404; relay upstream failure surfaces a 502 JSON (existing relay behavior).
- Tests: vitest for entry resolution plus a smoke start/stop asserting `/`, `/frame/`, `/models/<entry>` serve 200 and `/api/relay` rejects a bad origin with 403.
