# Chat easy items

Branch `fix/ui-small`, worktree `.worktrees/ui-small`. Each task is one subagent, test-first, its own commit(s) with docs in the same commit. Delete this file in the final commit before shipping.

Done: stored key fingerprints shown in the key inputs (b93d2349).

## Task 1: viewer keeps its picture while it resizes

`#editor` animates its width (main.css:202), so `#viewer` resizes every frame; `engine.js:44` calls `viewer.resize()`, which clears the WebGL buffer (`renderer.setSize`, `canvas.width =`) and defers the redraw to the next frame (`updateView`), so the cleared canvas is painted: the viewer blacks out while the code panel opens or closes. The AI drawer slides with `transform` and never resizes the viewer.

- `packages/render-threejs/index.js` `resize`, `packages/render-regl/index.js` `resize`: render synchronously after the size change (cancel any pending deferred render), so no cleared frame is painted. Check `render-babylonjs` the same way.
- Tests: a resize triggers a render in the same call (mock renderer / regl seam as the packages' tests already do).

## Task 2: markdown in assistant replies

Replies render as plain `textContent` (`apps/jscad-web/src/aiChat.js`, assistant message element and its streaming `onText`). Render them as markdown.

- A small renderer in `apps/jscad-web/src/chatMarkdown.js` that builds DOM nodes, never `innerHTML`: paragraphs, headings, bold/italic, inline code, fenced code blocks, ordered/unordered lists, tables (GFM pipe), links (`http`/`https` only, `target=_blank rel=noreferrer`). Anything else stays literal text.
- Fenced code blocks get a Copy button (clipboard API, "Copied" feedback).
- Streaming: re-render the message from the accumulated text on each chunk (throttled to an animation frame); the scroll-follow rule is unchanged.
- Persisted and resumed messages render the same way.
- No new dependency.
- Tests: each construct, a `<script>`/HTML-looking reply stays text, a `javascript:` link stays text, copy button copies the block, streaming re-render.

## Task 3: retry after a failed turn

A failed turn removes the user message from the transcript (`aiChat.js` catch, `commit(local.slice(0, -1))`) and shows an error row.

- Keep that rule for the stored transcript, and add a Retry button on the error row that resends the same message with its images (the images already return to the pending area). The draft input is not overwritten if the user has started typing a new message; Retry sends the failed message, not the draft.
- Retry is disabled while a turn runs; it disappears once any new turn starts.
- Tests: error row has Retry; Retry runs a turn with the same message and images; the failed message is not duplicated in the transcript.

## Task 4: token usage per turn

`onUsage` reports `{inputTokens, outputTokens, reasoningTokens}` per provider round; nothing shows it.

- Sum per turn and show a small muted line under the turn's reply: `12.3k in · 1.8k out` (reasoning included in out when the provider reports it separately, shown as `(0.9k thinking)`). No cost figures (no reliable per-model price table).
- Persist the per-turn totals on the assistant message so a resumed chat shows them.
- Tests: summing across rounds, missing fields, rendering, persistence.

## Order

Task 1 runs in parallel with tasks 2-4 (separate packages). Tasks 2, 3, 4 all touch `aiChat.js` and run one after another. Review each task's diff before the next. Ship with `scripts/ship.sh fix/ui-small`; deploy is the user's step.
