# View tool redesign — design

Date: 2026-10-18. Worktree: wt1.

How it gets made: off-screen mesh renders shared with the eval views path, delivered as provider-native image blocks.

## Intent and why

The user sees the model, the agent cannot. Today's `view` (`apps/jscad-web/main.js:1082-1090`)
grabs the live `#viewer canvas` as a ~340 KB `canvas.toDataURL` inside `{ok, image, camera}`,
which never survives the loop's 24,000-char per-result cap
(`packages/agent-loop/src/loop.js`, `packages/agent-loop/src/context.js:4`), and `camera`
serializes after `image`, so the model gets a truncated base64 prefix with no camera
(`docs/backlog.md:154-161`). It is also hidden from the offered catalog
(`packages/agent-loop/test/tools.test.js:19-20`) while still served via dispatch
(`packages/agent-loop/src/dispatchTool.js:82`), with e2e pinning the truncated contract
(`apps/jscad-web/e2e/ai-chat-tools.spec.js:481-533`).

This redesign makes `view` usable: the agent positions a camera for one call, gets back
real images it can act on next round, and the user's own view never moves.

Success: a model can call `view`, receive images, and use them in a later step.

## Goals

- Ephemeral aim: the agent's camera applies only to that one `view` call's render.
- Off-screen from the mesh, never the live canvas; the user view is undisturbed.
- Camera specs array in, that many images back; 1 element = single view.
- Max 4 views per call.
- Size parameter, default 640x480.
- Vision-capable models only.
- Each returned view carries the final camera actually used plus its image.
- Unknown or ambiguous part name fails the call as a tool error, no guessing.

## Non-goals (my call)

- No video, turntable, depth maps, or segmentation masks.
- No user-visible camera moves, no persistent screenshots to disk.
- No text fallback rendering of images for non-vision models (they are not offered `view`).

## Anti-goals (my call)

- Disturbing the user's camera, or changing what the user sees, fails even if images return.
- Returning images as base64 inside JSON through the 24k char cap fails even if pixels are right.
- Resending every past view's images every later round fails on cost.

## Constraints

- Token cost is roughly width×height/750 per image on Anthropic and images are resent
  every later round, so `runTurn` keeps only the latest `view` result's images
  (`docs/backlog.md:641-654`).
- Image payloads must bypass `capToolResult`: Anthropic `tool_result` image content,
  Responses `input_image`, chat completions images in a `user` message after the `tool`
  message (backlog wording).
- Offer `view` only to models known to read images: `vision: true` in `eval/models.json`,
  or in the app the provider's model metadata, else a `VISION_MODELS` table beside
  `RESPONSES_MODELS` (`packages/agent-loop/src/providers.js:20`).
- Render from the mesh via one shared module with the complex grader's views
  (`packages/agent-loop/eval/views.js`, `eval/render/page.html`), not the live canvas.
- Tool error shape stays `{ok: false, error: {name, message}}` like the other tools.

## The parts as decided

Camera spec element (one per requested view), exactly one aim form each:

- `preset`: one of front, back, left, right, top, bottom, iso-front, iso-back.
  iso-front and iso-back reuse the eval describer directions
  (`eval/views.js`: iso-front dir [1,-1,0.7], iso-back [-1,1,0.7], side [0.25,-1,0.35],
  top [0.15,-0.35,1]).
- `lookAt`: either `[x,y,z]` coords or a hierarchical part name (dotted param path such
  as `body`, `front.left`, typed via `proxyState.types` from the params-proxy system,
  e.g. `packages/params-core/src/createParamsProxy.js`, example
  `apps/jscad-web/examples/jscad/jscad-examples/02-hierarchical-car.example.js`).
  A part name resolves to that part's centroid for framing.
- `position` plus `offset`: explicit camera position plus a world-coords offset that
  shifts the camera for that render.

Call shape (builder maps to JSON schema): `{views: [spec...], size?: {w, h}}`.
Defaults: one view when `views` has one element; `size` defaults to 640x480 (my call:
max longest side 768 to bound tokens; larger requests are an error).

Response shape: per requested view `{image: <provider-native image part>, camera: {position,
target, fov, aspect}}` plus `ok: true`. The camera returned is the final one used.

## Builder-check resolutions (my call)

- Complement defaults: a preset sets direction and auto-fits distance to the whole-model
  bounding box; a `lookAt`-only spec targets the coords or part centroid, shot from a
  default iso-front direction auto-fit to the part bbox when a part name is given, else
  the whole model; a `position`+`offset`-only spec looks at the whole-model bbox center
  (part centroid when the call also names a part — not yet specified, builder picks the
  whole-model default if ambiguous).
- Pruning: `runTurn` drops superseded `view` image parts but keeps the text stub with all
  returned `camera` JSON, so the agent keeps aim history without paying image resend.
- Default call: `views` is optional; omitted or empty means one iso-front auto-fit of the
  whole model. Never copies the live user pose.
- No renderable mesh (script error, empty geometry, 2D-only output): tool error, never a
  blank image — a blank frame would mislead the vision model; the agent fixes the script
  first. Mirrors the existing `noGeometry` pattern.
- Partial failure (one bad element of a multi-view array): atomic `{ok: false}` for the whole
  call — a failed view fails the request, no partial image sets.

## What's left to the builder

- Exact JSON schema names and the per-provider wire format in `src/loop.js` /
  `src/providers.js` (Anthropic, Responses, chat completions), including how image parts
  skip `capToolResult` while their text stub still counts toward turn budgets.
- Off-screen renderer choice: headless three.jsframingshared with `eval/views.js` versus
  a hidden canvas; framing math for 640x480 (non-square) from the eval's 768x768
  orthographic box framing (`eval/render/page.html:78`).
- Part-name to centroid resolution: mapping a dotted param path to measured geometry
  (`packages/model-tools/src/measure.js` `measureCenter`) when `main()` returns a plain
  array with no names; ambiguous match detection and error names.
- Preset direction vectors and up vectors for front/back/left/right/bottom (eval defines
  iso-front, iso-back, side, top only); perspective versus orthographic for agent views.
- Vision gating table values and `eval/models.json` flags.
- E2E and unit updates: replace the truncation tripwire in `ai-chat-tools.spec.js`,
  un-hide `view` in `TOOLS` behind the vision gate, update `tools.test.js`,
  `dispatchTool.test.js`, `standardTools.test.js`, and `docs/backlog.md` (both view items).
- Eval gate (my call, from backlog): with a vision model, `complex` `verdictRate` rises
  past run-to-run spread and `harder` totals do not fall; waits on complex grader
  calibration, so land behind that gate or document the waiver.
