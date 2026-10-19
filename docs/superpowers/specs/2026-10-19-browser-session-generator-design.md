# Browser session generator

Status: design, 2026-10-19. Working document; delete before merge after
folding the lasting parts into `packages/agent-loop/docs/` and
`apps/jscad-web/docs/architecture.md`.

## Intent

The `chat-review` skill (`.claude/skills/chat-review/SKILL.md`) improves the
chat agent from recorded conversations, but real input is thin: the review on
2026-10-19 found 7 conversations since 2026-09-29, none from 10-01 to 10-18.
Half of the new stumbles it found happened only in the browser (`view`, the
app's `execute` path), where the headless eval (`eval/backend.js`) cannot
reach. This generator runs a stable set of build scenarios through the real
app in a headless browser, with a simulated user, and writes the sessions as
relay logs that `read-log` and `chat-review` already consume. It is the input
side of an outer loop that may change any part of the harness: prompt,
examples, tools, tool descriptions, and skills.

## Goals

- Run every scenario in the set against each builder model in the real
  browser app, unattended, on the GPU host.
- Produce relay-log JSONL indistinguishable in shape from a real session, so
  `npm run read-log -w @jscadui/agent-loop` and `chat-review` read it without
  changes.
- A simulated user that answers the agent's `question` calls and critiques
  each finished turn from rendered views and the build report, up to 3 user
  turns per session.
- A batch manifest that lets two batches on different jscadui commits be
  compared scenario by scenario.
- Zero spend: only free models.

## Non-goals

- Replacing the headless eval. It stays the measure for prompt changes.
- Grading quality with the simulated user. Pass/fail on geometry comes from
  scenario `checks`, never from the simulated user's opinion.
- Generating scenarios with a model. The set is curated.
- Using the production relay or the production free option.

## Anti-goals

- A simulated user that coaches the builder toward a fix, names APIs, or
  reads code. It reacts as the person described by the fact card would.
- Scenario prompts written as specs. An opening request is what a user would
  type, as chat-review's fixture rule requires.
- Any paid call. A batch that would hit a paid model refuses to start.
- Imitating the OpenCode client to reach models OpenCode limits to its own
  client.
- Duplicate live sessions from test retries.

## Constraints (measured 2026-10-19)

- **Models.** With the `opencode-go` key in `~/.config/jscad-chat/keys.json`,
  the Go endpoint (`https://opencode.ai/zen/go/v1`) serves three free models:
  `longcat-2.5-preview-free` and `minimax-m3.1-flash-free` (both read images:
  each named "red square, blue circle" from a test PNG) and `beam-free`
  (text only; an image returns HTTP 400 "Beam supports text input only").
  Paid models return "Insufficient account funds". The Zen endpoint's free
  models (`deepseek-v4.1-flash-free`, `nemotron-3.5-super-vl-free`) return
  `FreeTierError: OpenCode's free tier can only be used from within
  OpenCode` with the same key; `space-bunny-free` is deprecated. Go requests
  need `x-opencode-session`; the app's providers already send it
  (`packages/agent-loop/src/providers.js:361`).
- **Relay.** Use the local launcher (`apps/jscad-web/scripts/jscad.mjs`,
  app on its port, frame on port+1, relay `scripts/local/relay.js`). It logs
  every chat POST through the shared writer `server/src/relay/chatLog.js` to
  `JSCAD_CHAT_LOG`. It trusts only `http://localhost:<its port>`; rate limit
  60/min. Run it with `JSCAD_TRACKED=1` so it does not self-update. The
  production relay refuses a localhost Origin and meters free turns per IP.
- **Build.** Serve the launcher's normal build. `build.js --dev` stamps
  `__RELAY_ORIGIN__` as `https://jscad.rkroll.com`.
- **Browser.** Playwright's bundled chromium with `--use-gl=angle
  --ignore-gpu-blocklist` (`apps/jscad-web/playwright.config.js`); the
  system chromium has no headless WebGL. `retries: 0`.
- **App state to seed** (as `e2e/ai-chat-tools.spec.js` does): ToS consent
  `jscad-ai.tos` with `recordOwnChats: true` (without it Send opens the
  consent gate, and without `recordOwnChats` no `chatId` is sent), the key in
  `jscad-studio.key` as `{mode:'device', key}`, the selection in
  `jscad-ai.selection` (kind `opencode-go`, the model, no custom `baseUrl`,
  which would also suppress `chatId`), and the vision override
  `jscad-ai.vision-overrides` for models the probe passes, since Go serves no
  capability fields and `view` is offered only to vision models. The API
  style setting is `fluent`, the production default; batches run fluent
  only, so the manifest carries no style field.
- **Limits per turn.** 32 rounds (`DEFAULT_MAX_ROUNDS`), then the app's
  "Maximum steps reached" message; 120 s per tool call; 30 s per `run`;
  reasoning models can be silent for minutes. Waits must exceed these.
- **Disk.** The launcher writes the chat project into its model directory
  (`scripts/local/fsApi.js`). Each session gets a fresh directory.
- **CI.** simple-ci on the GPU host, job cap `CI_JOB_TIMEOUT` 7200 s. Ports
  must avoid 5120 (`ci/render`) and 5150 (`ci/web`). Heavy runs go through
  simple-ci, not locally.
- **Data.** Logs and manifests go to the private `jscad-chat-evals` repo
  (`$JSCAD_CHAT_DATA`, default `~/src/jscad-chat-evals`), never to jscadui.

## Design

### Roles

| Builder (app chat model) | `view` offered | Simulated user |
|---|---|---|
| `longcat-2.5-preview-free` | yes | `minimax-m3.1-flash-free` |
| `minimax-m3.1-flash-free` | yes | `longcat-2.5-preview-free`, output capped |
| `beam-free` | no | `minimax-m3.1-flash-free` |

The simulated user is never the builder's own model. Builder temperature
stays at the model's default; the simulated user runs at temperature 0.

### Batch start

1. Probe each model for availability and image input (the shapes test
   above). A builder that fails is skipped and recorded; a simulated user
   that fails image input falls back to text-only critique and is recorded.
2. Refuse to start if any configured model is not one of the free models
   the probe confirmed.

### A session

1. Fresh model directory, seeded with the scenario's `files`. A scenario
   without `files` starts from what a fresh production project holds, not
   the launcher's `scripts/local/scaffold.js` starter (an `@jscad/modeling`
   cube even under fluent); add a launcher flag that skips the scaffold and
   seed the production default instead. Start
   (or reuse) the launcher on that directory with `JSCAD_CHAT_LOG` set to
   `<data>/logs/synthetic/<batch>/`.
2. Seed app state, select the builder, open the chat, type the scenario's
   opening request, send.
3. Wait for the turn to end (`.chat-send` loses `running`). While it runs,
   answer each `.chat-question` from the fact card through the simulated
   user.
4. After the turn: render `iso-front`, `iso-back` and `top` through the
   app's own `view` handler (below), take the build report, and give the
   simulated user the final assistant text, the images and the report. It
   replies with either `ACCEPT` or the next user message.
5. Repeat until `ACCEPT` or 3 user turns, the opening request included.
6. Run the scenario's `checks` on the final build, if it has any, and record
   the outcome.

The simulated user's own model calls go straight from the harness to the Go
endpoint, not through the launcher relay, so they never appear in the chat
log. Each call is recorded in the manifest instead.

### Harness hook

The chat's tool handlers are built inside the tool table at
`apps/jscad-web/main.js:1091`; `view` is `createViewHandler`
(`apps/jscad-web/src/aiView.js:111`) and returns PNG data URLs with camera
data. Add a hook, present only when a harness flag is set in localStorage,
that exposes the same handlers the builder calls:
`globalThis.jscadHarness.view(spec)`, `.measure(args)`, `.check(args)` and
`.buildReport()` (the last build's report as the chat sees it). The
harness renders, grades and critiques the browser build itself, for every
builder including `beam-free`; nothing is regraded in Node, so the job
needs no crt sandbox. (Designer's call: grading the Node build would hide
the browser-only problems this exists to find.) Scenario `checks` take the
hook's `measure` output as `m` and its `check` output as `solid`, the same
shapes the eval passes (`eval/backend.js:561-563`).

### Simulated user

Input: the scenario's persona line and fact card, the conversation so far as
the user saw it (user messages, final assistant texts, questions asked), and
for a critique the three views and the build report. It never sees code or
tool calls. It answers a question from the fact card, or says it does not
mind when the card is silent. It critiques the way the person on the card
would: a size off from the card, a missing feature the card names, a model
that replaced their earlier work. Output is a single user message or
`ACCEPT`.

### Scenarios

One file per scenario in `packages/agent-loop/synth/scenarios/`:

```js
export const scenario = {
  name: 'jeep-1-10',
  category: 'scale-vehicle',
  prompt: 'create a 1:10 scale model of a WW2 Willys Jeep',
  persona: 'hobbyist building a display shelf model',
  facts: ['about 340 mm long', 'display piece, not printed as one part'],
  files: undefined,
  checks: (m, { solid } = {}) => [ /* same contract as eval fixtures */ ],
}
```

`checks` follows the eval fixture contract
(`packages/agent-loop/eval/fixtures/*.js`) so geometry is judged the same
way. Starting set, seeded from real sessions where possible:

- `jeep-1-10`: the request above.
- `jeep-inspect-fix`: "use the view tool to find errors in the Jeep and fix
  them", seeded with the Jeep source preserved in the 2026-10-19T02:15:08Z
  production request (chat bb17e98f).
- `turret-gear-assembly`: the water-gun turret with 10:1 drives (chat
  8d3c5d92).
- `text-vertical-face`: raised lettering on the side of a box.
- `enclosure-lid`, `shelf-bracket`, `spur-gear`, `nameplate`,
  `caboose-toy`, plus about three for categories with no real session.

The builder writes the personas, fact cards and checks, from the real
session where one exists; they need no separate review. The starting set is
committed as written and pruned after the first batches. After that the set changes only by commit, and a new scenario joins
when a batch shows it produces a stumble on the current harness, the same
bar chat-review sets for fixtures.

### Outputs

Per batch, under `<data>/logs/synthetic/<batch>/`: the relay JSONL the
launcher writes, and `manifest.json`:

```json
{
  "batch": "<iso time>", "jscaduiCommit": "<sha>", "scenarioSetCommit": "<sha>",
  "probe": { "<model>": { "available": true, "vision": true } },
  "sessions": [
    { "chatId": "...", "scenario": "jeep-1-10", "builder": "...", "simUser": "...",
      "run": 1, "userTurns": 2, "accepted": true, "checks": { "passed": 3, "total": 4 },
      "stumbles": { "failedCalls": 5, "corrections": 1, "unbuiltTurns": 0 },
      "simUserCalls": [ { "ms": 0, "inputTokens": 0, "outputTokens": 0 } ] }
  ]
}
```

`stumbles` uses chat-review step 2's rules (failed tool calls, user
corrections, turns that end without a build that succeeded), computed by a
script shared with chat-review. In a synthetic session a correction is any
simulated-user message after the opening request that is not `ACCEPT`, a
critique by construction. The script counts failed calls and unbuilt turns
the same way on real logs; corrections in real logs stay chat-review's
judgment.

### Comparing batches

Same scenario set, two jscadui commits: per scenario and builder, compare
check pass rate, stumble counts, user turns to `ACCEPT`, and rounds. Start
at 2 runs per scenario and builder; builder sampling makes single runs
noisy.

### chat-review changes

- Synthetic logs are opt-in per batch. `logs/synthetic/<batch>/` sits two
  levels below `logs/`, so plain `read-log` keeps reading only real logs
  (top level and `prod/`) and a batch of ~72 sessions never swamps them
  under `--since`. `read-log` gains a `--batch <id>` option that reads one
  batch and labels each conversation with its scenario and builder from the
  manifest; chat-review reviews a batch as its own pass.
- Step 2's stumble rules move into the shared script above.
- Scope widens from prompt, examples and fixtures to tools, tool
  descriptions and skills, still one change measured at a time.

## Left to the builder

- Where the runner lives (an `apps/jscad-web` script beside the e2e helpers,
  or `packages/agent-loop/synth/`), and moving `openChatWithKey`, `seedTos`
  and the question-answering steps out of the two e2e specs into
  `e2e/helpers.js`.
- One launcher per batch with a directory switch per session, or one
  launcher per session.
- The CI job name and how a batch is split to fit 7200 s (for example one
  job per builder). 3 builders × ~12 scenarios × 2 runs is ~72 sessions;
  session length is unmeasured.
- Concurrency per model, starting at 1.
- The simulated user's prompt wording, within the rules above.
