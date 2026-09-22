Status: done, committed, not pushed.

Commit: 8a0288b — docs(jscad-web): record the live two-host deploy and its traps

Files changed:
- apps/jscad-web/docs/architecture.md
- apps/jscad-web/e2e/RENDER-TESTING.md
- docs/backlog.md

Disagreements found between docs and code: none. architecture.md, README.md,
and the apache-hook/deploy-run.conf/deploy.conf setup already matched the
running code (two hosts, `build/frame`+`assets/` bundle dir, CORS split,
smoke gate flow) — those needed no correction, just filling gaps that weren't
written down yet:

- architecture.md: added the deploy-full.sh stage order with the smoke gate
  as the last step, the go-live date (2026-09-21), the `REMOTE_HOST`
  silent-no-op trap in `deploy.sh`'s `lib/platform.sh` sourcing, and a new
  "Smoke gate" subsection describing what `e2e/smoke-deploy.mjs` proves and
  why it uses `01-basics/ALL.js` instead of mcad's grid.
- RENDER-TESTING.md: added the like-for-like baseline comparison that
  justified the merge (main 575/201/12 vs branch 596/186/6, same harness, no
  per-library regressions, difference is the `packages/require` circular-dep
  fix).
- docs/backlog.md: recorded the 2026-09-21 two-host go-live in the Deploy
  section (old `run.*` vhosts already retired, not still pending); rewrote
  the Render sweep item to name the 88/192 browser-only geometry gap (not the
  older 85/145 NopSCADlib-only figure, which is now 100/145 in the current
  baseline) as the largest known problem, with mcad's `polyholes_test.scad`
  ("segments must be four or more", confirmed against
  `packages/params-core/test-all-scenario.js`) named as one instance.

Verified against source: deploy-full.sh, deploy.conf, deploy-run.conf,
deploy/hooks/apache.configure.post.sh, build.js (frame bundle dir), and
e2e/render-baseline.json (byLib counts, `_comment` field, polyholes_test
entry).
