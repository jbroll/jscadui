# JSCAD Native Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add community JSCAD native models to the test/example corpus via the existing fetch-deps pipeline.

**Architecture:** Extend `scripts/deps/manifest.json` with 4 pinned git deps mapping into `apps/jscad-web/examples/jscad/<suite>/`; gitignore fetched trees except control files; `generate-all-files.js` rebuilds `ALL.js` grids; existing `examples.test.js` + `test-models-execution.js` grade them.

**Tech Stack:** Node.js, fetch-deps.js (manifest + `--fuzz=0` patches), JSCAD V2 loader (`packages/require`), `apps/jscad-web/examples.test.js`

**Spec:** Conversation 2026-10-16 (websearch survey + Tier 1/2/3 split). Established patterns: `scripts/deps/manifest.json` entries (`url`+`ref`+`commit`+`license`+`mappings`+`patches`), `.gitignore:110-176` suite-ignore + control-file negation, `apps/jscad-web/examples/jscad/ALL.js:1-4` generated grids.

## Global Constraints

- Fetched trees + generated `ALL*.js` are gitignored; only `skip.txt`, `exclude.txt`, `compare-skip.txt`, `config.json` tracked per suite.
- Patches live in `scripts/deps/patches/*.patch` and apply exactly (`--fuzz=0`).
- Models served from web as source; any OSI license acceptable but MUST be recorded in manifest `license` + `LICENSE` copied via mapping where available.
- V1 `.jscad` with `include()` goes to `skip.txt` triage, not silent breakage — relative `require()` only (per `TESTING.md:87`).
- Determinism: seed RNG (`Math.random`/`rands()` without seed) or list in suite `skip.txt` with reason.

## Review Focus

- V1 `include()` models failing loader — expect skip-listed with reason, not patched silently.
- License field missing/wrong vs upstream repo — expect manifest value to match upstream license file.
- `ALL.js` grid picking up skipped/broken models — expect `exclude.txt`/`skip.txt` honored by generator.
- Fetch-deps mapping copying PDFs/SVGs/zips into examples — expect `exclude` covers non-model assets.
- Non-deterministic models (unseeded RNG) passing execution once but flaking — expect seeded patch or skip with note.

---

### Task 1: Manifest entries + gitignore + control files

**Files:**
- Modify: `scripts/deps/manifest.json`
- Modify: `.gitignore`
- Create: `apps/jscad-web/examples/jscad/<suite>/skip.txt` (5x, may be empty with header)
- Test: `node scripts/fetch-deps.js --dry-run --dep=<name>` per dep

**Model:** sonnet — multi-file coordination, manifest schema matching.

- [ ] **Step 1: Add 4 dep entries to `scripts/deps/manifest.json`** (no `commit` yet; pin after first fetch prints HEAD):
  - `jscad-z3dev-designs` — `https://github.com/z3dev/designs.git`, `ref: main`, mappings `.` → `apps/jscad-web/examples/jscad/z3dev-designs`, include `*.js **/*.js *.jscad **/*.jscad LICENSE`, exclude `node_modules/**` (bare `*` needed: `**/` never matches root-level files)
  - `jscad-tspspi-models` — `https://github.com/tspspi/jscadModels.git`, `ref: master`, mappings `models` → `.../tspspi/models` + `library` → `.../tspspi/library`
  - `jscad-gilboonet-designs` — `https://github.com/gilboonet/designs.git`, `ref: master`, license `MIT`, mapping `.` → `.../gilboonet`, include root + `2020-2025/**` + `testInclude/**`, exclude `*.pdf *.svg *.zip`
  - `jscad-hardware` — `https://github.com/johnwebbcole/jscad-hardware.git`, `ref: master`, tightened mappings `examples/` + `src/` + `v1/` (NOT root-wide: repo contains docs site, tests, dist bundles)
- [ ] **Step 2: Append gitignore suite blocks** mirroring `.gitignore:158-176` (ignore suite whole, negate `skip.txt`/`exclude.txt`/`config.json`)
- [ ] **Step 3: Create empty control files** (`skip.txt` with header comment) for each of the 4 suites so the ignore-negation has something to track
- [ ] **Step 4: Verify dry-run** — `node scripts/fetch-deps.js --dry-run --no-organize --dep=jscad-z3dev-designs` (repeat per dep). Expected: prints clone+copy actions, no writes. NOTE: `fetch-deps --update` on a commit-less entry throws `cannot find pinned commit` — pin by fetching WITHOUT `--update`, then editing the printed HEAD SHA into the manifest.
- [ ] **Step 5: Commit** — `git add scripts/deps/manifest.json .gitignore apps/jscad-web/examples/jscad/*/skip.txt && git commit -m "feat(corpus): add JSCAD native suite deps (dry-run verified)"`

Dropped during Task 2: `danmarshall/jscad-gallery` — investigated, designs are browserified page bundles (no exported main; entry self-contained), not fetchable source models. Not added.

### Task 2: Fetch, pin, triage

**Files:**
- Modify: `scripts/deps/manifest.json` (fill `commit` SHAs, correct `license`)
- Modify: `apps/jscad-web/examples/jscad/<suite>/skip.txt`, `exclude.txt`
- Create: `scripts/deps/patches/<name>.patch` (only if needed for deterministic/V1 shims)
- Test: `node apps/jscad-web/test-models-execution.js apps/jscad-web/examples/jscad/<suite> --all-last`

**Model:** sonnet — judgment calls on skip vs patch per model.

- [ ] **Step 1: Fetch + pin one dep** — fetch WITHOUT `--update` (prints HEAD), edit SHA into manifest, re-fetch to verify cache-hit. Start with z3dev + hardware (Tier 1, expect green).
  Triage results 2026-10-16: z3dev 21/32 (8 lib-part modules w/o main + 3 V1-definition failures skipped); hardware 0/4 (V1 CSG-global API); tspspi 0/52 (V1 include()); gilboonet 2/41 (V1 global-main + include()).
- [ ] **Step 2: Run execution test on the fetched suite** — record pass/fail per file
- [ ] **Step 3: Triage failures** — V1 `include()` / missing assets / RNG → `skip.txt` with reason; trivial deterministic fixes → `scripts/deps/patches/` entry + manifest `patches` block
- [ ] **Step 4: Repeat Steps 1–3 for remaining deps** (tspspi, gilboonet, gallery — expect heavy `skip.txt`)
- [ ] **Step 5: Verify full fetch clean** — `node scripts/fetch-deps.js --if-missing` idempotent, `git status` shows only manifest + control files + patches
- [ ] **Step 6: Commit** — `git commit -m "feat(corpus): fetch + triage JSCAD native suites"`

### Task 3: Grids + test suite wiring

**Files:**
- Modify: `apps/jscad-web/examples/jscad/ALL.js` (regenerated, untracked — verify only)
- Modify: `apps/jscad-web/examples.test.js` (only if suite discovery needs updating)
- Test: `npm run test:examples` (from `apps/jscad-web`) + `npm test -w apps/jscad-web`

**Model:** haiku — mechanical regeneration + test runs.

- [ ] **Step 1: Regenerate grids** — `npm run generate-all` (or `generate-all-files.js --no-rename`). Expected: per-suite `ALL.js` includes new models minus skipped
- [ ] **Step 2: Run JSCAD example tests** — `npm run test:examples` from root. Expected: PASS (skipped suites excluded)
- [ ] **Step 3: Run execution sweep on new suites** — `node apps/jscad-web/test-models-execution.js apps/jscad-web/examples/jscad --all-last`. Expected: 0 errors outside `skip.txt`
- [ ] **Step 4: Commit** — only tracked control/config changes; verify `git status` shows no generated `ALL*.js`
