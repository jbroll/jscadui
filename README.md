# jscadui

3D CAD in the browser — source for [jscad.rkroll.com](https://jscad.rkroll.com).

This project grew out of the original [hrgdavor/jscadui](https://github.com/hrgdavor/jscadui) playground; it is now developed independently as the production app at jscad.rkroll.com.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What it is

jscadui is an npm-workspaces monorepo of JavaScript libraries and web applications for building 3D CAD interfaces in the browser. The main production app is [apps/jscad-web](apps/jscad-web), which powers jscad.rkroll.com.

Highlights:

- OpenSCAD to JSCAD transpiler ([packages/openscad](packages/openscad))
- Manifold geometry engine ([packages/manifold](packages/manifold))
- AI chat assistant ([packages/agent-loop](packages/agent-loop))
- Vetted hardware parts catalog ([packages/parts](packages/parts))
- Project storage with local and synced backends

## Live app

**[https://jscad.rkroll.com](https://jscad.rkroll.com)** — design, preview, and export 3D models in the browser.

## Quick start

```bash
npm run setup
npm run dev
```

See [docs/quickstart.md](docs/quickstart.md) for the full walkthrough.

## Documentation

- [docs/quickstart.md](docs/quickstart.md) — from clone to a running dev server
- [docs/development.md](docs/development.md) — repo layout, commands, testing, merge workflow
- [docs/architecture.md](docs/architecture.md) — architecture overview and pointers
- [apps/jscad-web/docs/architecture.md](apps/jscad-web/docs/architecture.md) — full application architecture
- [apps/jscad-web/docs/user-manual.md](apps/jscad-web/docs/user-manual.md) — app user manual
- [TESTING.md](TESTING.md) — test structure and commands
- [docs/backlog.md](docs/backlog.md) — roadmap and outstanding work
- [CLAUDE.md](CLAUDE.md) — agent and contributor context

## Repository layout

- `packages/*` — shared libraries (transpiler, runtime, params, renderers, formats, parts, agent loop)
- `apps/*` — applications; `apps/jscad-web` is the production app
- `file-format/*` — model format exporters

## License

MIT. See [LICENSE](LICENSE).
