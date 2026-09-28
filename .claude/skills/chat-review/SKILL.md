---
name: chat-review
description: Review recorded jscad-chat conversations, reproduce each stumble as an eval fixture, and improve the agent-loop system prompt and examples against the eval. Use when asked to "review the chat logs", review chat conversations, or improve the chat prompt from real sessions.
---

# Chat review

Improves `packages/agent-loop`'s system prompt from what users actually hit.
The launcher relay logs every chat request; the log reader rebuilds the
conversations; the eval measures a prompt change before it is kept.

## Scope

Edit only `packages/agent-loop/prompt.md`, `packages/agent-loop/prompt/`
(examples and `prompt/index.js`) and `packages/agent-loop/eval/fixtures/` in
jscadui. Logs and eval result files live in the private `jscad-chat-evals`
repo, `$JSCAD_CHAT_DATA` (default `~/src/jscad-chat-evals`); new result files
go there, not in jscadui. A stumble whose cause is in the runtime, the tools
or the app goes to `docs/backlog.md` as an item instead, with the
conversation's chat id and the error text.

Live eval runs spend API budget. Before the first live run of a review, tell
the user the fixture count times `EVAL_RUNS` and get a yes.

## Steps

1. **Read the logs.** Read `~/.local/state/jscad-chat/last-review` with the
   Read tool; it holds one ISO time, or does not exist on the first review.
   Note the current time as the review time. Run, from the repo root:

   ```bash
   npm run read-log -w @jscadui/agent-loop -- --since <ISO time from last-review>
   ```

   Drop `--since` when the file does not exist. Add `--json` when you need a
   tool call's full input or result.

2. **List the stumbles.** For each conversation:
   - every failed tool call, with its error message and the source that
     caused it;
   - every turn where the user corrected the model ("no", "that's wrong",
     a repeat of the request, a changed dimension);
   - every turn that ended without a `writeModel`.

3. **Group by cause.** Stumbles with the same cause across conversations are
   one group: the same bad import, the same misread parameter style, the same
   wrong API call. Name each group by its cause, not its symptom.

4. **Reproduce each group as a fixture.** Add
   `packages/agent-loop/eval/fixtures/<name>.js`, where `<name>` is the
   fixture's `name`:

   ```js
   // <one line: the stumble this fixture reproduces>
   export const fixture = {
     name: '<name>',
     prompt: '<the user message from the log, verbatim>',
     requires: ['eval', 'writeModel'],
     verifyBeforeWrite: false,
     maxTurns: 8,
     checks: (m, { params = [] } = {}) => [
       { name: '<what the result must be>', pass: /* from m.dimensions, m.volume, m.boundingBox, params */ false },
     ],
     // For a follow-up request, add the prior turns and project files from the log:
     // transcript: [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }],
     // files: { 'main.js': '...' },
   }
   ```

   Run the new fixtures on the current prompt:

   ```bash
   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor EVAL_FIXTURES=<name>,<name> npm run eval -w @jscadui/agent-loop
   ```

   Confirm each fails the way the log shows: a nonzero mean `firstFail`, and
   the same error text in the run transcripts (`results[].transcript`, the
   tool messages with `"ok":false`) in the result file. A fixture that passes
   on the current prompt does not reproduce the stumble; rework its prompt or
   context until it fails, or drop it.

5. **Draft a prompt or example change.** Use the
   `llm-application-dev:prompt-engineering-patterns` skill, especially its
   few-shot reference (`references/few-shot-learning.md`). If that skill is
   not available, prefer a short example file over added prose, and keep
   prose edits to the Imports and Tool policy sections. Prefer a short
   example model in `prompt/examples/NN-<name>.js` that shows the right form
   over more prose. Each example opens with a one-line comment naming the
   request it answers, and must be listed in `prompt/index.js` in file-name
   order. Keep `prompt.md` prose short and concrete.

6. **Measure the candidate.** Run the full suite on the candidate:

   ```bash
   EVAL_PROVIDER=meta EVAL_MODEL=muse-spark-1.3-contributor npm run eval -w @jscadui/agent-loop
   npm run eval -w @jscadui/agent-loop -- --compare eval/results/<baseline>.json eval/results/<candidate>.json
   ```

   The baseline is the newest result file in `<data>/results/` (`$JSCAD_CHAT_DATA`,
   default `~/src/jscad-chat-evals`) for the current prompt (its `promptSha256`
   matches the committed prompt); run one if none exists.
   Keep the change only if the mean `firstAttemptFailures` drops on the new
   fixtures and no fixture's mean total score falls by more than 0.5.
   Otherwise revise and measure again, or drop the change.

7. **Show and commit.** Show the user the prompt/example diff and the
   comparison table. On approval, commit the prompt, examples and fixtures in
   jscadui; then, in the evals repo, `git -C <data> add logs results` and
   commit the new log and result files, with a message naming the jscadui
   commit it goes with. Push the evals repo (`jbroll/jscad-chat-evals`, the
   user's private repo). Never push jscadui without asking, and never open a
   pull request. Write the review time from step 1 to
   `~/.local/state/jscad-chat/last-review` with the Write tool.
