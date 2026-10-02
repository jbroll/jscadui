# Development

Contributor orientation for the jscadui monorepo.

## Layout

npm workspaces monorepo:

- `packages/*` — shared libraries
- `apps/*` — applications (`apps/jscad-web` is the production app)
- `file-format/*` — model format exporters

## Common commands

```bash
npm run dev        # All dev servers (turbo)
npm run build      # Build all packages
npm run test       # All tests (unit + examples + OpenSCAD comparison)
npm run validate   # lint + typecheck + test
```

## Testing

See [TESTING.md](../TESTING.md) for the full test structure and commands.

OpenSCAD transpiler tests are memory-intensive and run via CI on the GPU host. See [packages/openscad/CLAUDE.md](../packages/openscad/CLAUDE.md) for guidance.

## Merge workflow

Develop on a branch, fast-forward into `main`, push:

```bash
git checkout main
git merge --ff-only <branch>
git push
```

`--ff-only` keeps `main` linear. If refused, rebase the branch on `main` and retry. Everything must be green before merging.

Pull requests are only the CI channel for sessions that cannot reach simple-ci. Never merge through GitHub.

## Further reading

- [CLAUDE.md](../CLAUDE.md) — agent and contributor context
- [architecture.md](architecture.md) — architecture overview
- [backlog.md](backlog.md) — roadmap and outstanding work
