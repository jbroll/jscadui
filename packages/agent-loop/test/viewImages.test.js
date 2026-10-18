// packages/agent-loop/test/viewImages.test.js
// Image-block plumbing: a `view` tool result carries provider-native image
// parts beside a small camera-JSON text stub. The pixels bypass the 24k text
// cap, prune to the latest view, and map to each provider's native image shape.
import { describe, expect, it } from 'vitest'
import { partitionTranscript, PRUNED_TOOL_RESULT } from '../src/context.js'
import { runTurn, TOOL_RESULT_CHARS, TOOL_RESULTS_PER_TURN_CHARS } from '../src/loop.js'
import { toAnthropicMessages, toOpenAIMessages } from '../src/providers.js'
import { toResponsesInput } from '../src/responses.js'

const camera = (x) => ({ position: [x, 0, 0], target: [0, 0, 0], fov: 0.6, aspect: 4 / 3 })

// A data URL whose base64 body is `body`, PNG-mime like the renderer's.
const png = (body) => `data:image/png;base64,${body}`

const secondPng = png('c2Vjb25k')
// Longer than the per-result text cap, so it survives only as an image part.
const bigPng = png('A'.repeat(TOOL_RESULT_CHARS + 100))

const shot = (dataUrl, cam) => ({ image: { dataUrl, mime: 'image/png' }, camera: cam })
const viewResult = (dataUrl, cam) => ({ ok: true, shots: [shot(dataUrl, cam)] })

// Runs a turn whose provider asks for `view` once per result, then answers in
// text. Records the messages sent on every provider round.
const runTurnWithView = async (results) => {
  const sent = []
  const provider = {
    async *send(messages) {
      sent.push([...messages])
      if (sent.length <= results.length) {
        yield { type: 'tool_use', id: `t${sent.length}`, name: 'view', input: {} }
        yield { type: 'done', stopReason: 'tool_use' }
      } else {
        yield { type: 'text', text: 'looked' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }
  let next = 0
  const requestTool = async () => results[next++]
  const result = await runTurn({
    conversation: { messages: [{ role: 'user', content: 'look' }] },
    provider,
    requestTool,
  })
  return { sent, result }
}

const sentToolMessages = (run) => run.sent.at(-1).filter((m) => m.role === 'tool')
const sentImages = (run) => sentToolMessages(run).flatMap((m) => m.images ?? [])
const sentCameras = (run) => sentToolMessages(run).flatMap((m) => JSON.parse(m.content).cameras ?? [])

// A parallel round: the provider asks for view and another read-only tool in
// the same assistant message, then answers. Returns the messages of every send.
const runParallelRound = async () => {
  const sent = []
  const provider = {
    async *send(messages) {
      sent.push([...messages])
      if (sent.length === 1) {
        yield { type: 'tool_use', id: 'v1', name: 'view', input: {} }
        yield { type: 'tool_use', id: 'g1', name: 'glob', input: {} }
        yield { type: 'done', stopReason: 'tool_use' }
      } else {
        yield { type: 'text', text: 'done' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }
  const requestTool = async (name) => (name === 'view' ? viewResult(secondPng, camera(1)) : '{"ok":true}')
  await runTurn({ conversation: { messages: [{ role: 'user', content: 'look' }] }, provider, requestTool })
  return sent
}

describe('view images in the loop', () => {
  it('bypass the text cap and prune to the latest view, keeping every camera', async () => {
    const run = await runTurnWithView([viewResult(bigPng, camera(1)), viewResult(secondPng, camera(2))])
    expect(sentImages(run)).toHaveLength(1)
    expect(sentImages(run)[0].dataUrl).toBe(secondPng)
    expect(sentCameras(run)).toHaveLength(2)
  })

  it('keeps one view image past the text cap as an image part, not truncated JSON', async () => {
    const run = await runTurnWithView([viewResult(bigPng, camera(1))])
    expect(sentImages(run)).toHaveLength(1)
    expect(sentImages(run)[0].dataUrl).toBe(bigPng)
    // The image rides the tool message as an image part, bypassing the cap.
    const tools = sentToolMessages(run)
    expect(tools).toHaveLength(1)
    expect(tools[0].images).toHaveLength(1)
  })

  it('drops the earlier view image but leaves its camera text stub in place', async () => {
    const run = await runTurnWithView([viewResult(bigPng, camera(1)), viewResult(secondPng, camera(2))])
    const tools = sentToolMessages(run)
    expect(tools[0].images).toBeUndefined()
    expect(JSON.parse(tools[0].content)).toEqual({ ok: true, cameras: [camera(1)] })
    expect(tools[1].images).toEqual([{ dataUrl: secondPng, mime: 'image/png' }])
  })

  it('counts the camera stub toward the turn budget even though its image bypasses the per-result cap', async () => {
    const noteChars = Math.floor(TOOL_RESULTS_PER_TURN_CHARS / 2)
    const note = 'c'.repeat(noteChars)
    const result = (n) => ({ ok: true, shots: [{ image: { dataUrl: png(`img${n}`), mime: 'image/png' }, camera: { note } }] })
    const run = await runTurnWithView([result(1), result(2)])
    const tools = sentToolMessages(run)
    // The stub is far past the per-result cap yet arrives whole: images, not
    // text, are what bypass the cap.
    expect(JSON.parse(tools[0].content).cameras[0].note).toHaveLength(noteChars)
    expect(noteChars).toBeGreaterThan(TOOL_RESULT_CHARS)
    // The second view's stub pushes the turn past its total, so it is noted,
    // not carried.
    expect(tools[1].content).toMatch(/^\[tool result omitted: this turn's tool results passed /)
  })
})

describe('provider image mapping', () => {
  const viewToolMsg = {
    role: 'tool',
    toolCallId: 't1',
    content: '{"ok":true,"cameras":[]}',
    images: [{ dataUrl: secondPng, mime: 'image/png' }],
  }

  it('anthropic maps images to tool_result text + image blocks', () => {
    const mapped = toAnthropicMessages([viewToolMsg])
    expect(mapped).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: [
              { type: 'text', text: '{"ok":true,"cameras":[]}' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c2Vjb25k' } },
            ],
          },
        ],
      },
    ])
  })

  it('anthropic keeps a plain tool result a string when it has no images', () => {
    const mapped = toAnthropicMessages([{ role: 'tool', toolCallId: 't1', content: '{"ok":true}' }])
    expect(mapped[0].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' })
  })

  it('openai chat-completions puts images in a follow-up user message', () => {
    const mapped = toOpenAIMessages([viewToolMsg])
    expect(mapped).toEqual([
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true,"cameras":[]}' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: secondPng } }] },
    ])
  })

  it('responses puts images in input_image items after the function output', () => {
    const mapped = toResponsesInput([viewToolMsg])
    expect(mapped).toEqual([
      { type: 'function_call_output', call_id: 't1', output: '{"ok":true,"cameras":[]}' },
      { role: 'user', content: [{ type: 'input_image', image_url: secondPng }] },
    ])
  })

  it('openai batches a parallel round into tool, tool, user(images)', async () => {
    const sent = await runParallelRound()
    const wire = toOpenAIMessages(sent.at(-1))
    expect(wire.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user'])
    expect(wire.at(-1).content).toEqual([{ type: 'image_url', image_url: { url: secondPng } }])
  })

  it('responses batches a parallel round into outputs then one user(images)', async () => {
    const sent = await runParallelRound()
    const wire = toResponsesInput(sent.at(-1))
    expect(wire.map((m) => m.type ?? m.role)).toEqual([
      'user',
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
      'user',
    ])
    expect(wire.at(-1).content).toEqual([{ type: 'input_image', image_url: secondPng }])
  })
})

describe('context pruning', () => {
  it('drops images from a tool result it clears while keeping the rest untouched', () => {
    const tool = (n) => ({
      role: 'tool',
      toolCallId: `t${n}`,
      content: `r${n}`.padEnd(60, 'x'),
      images: [{ dataUrl: `data:image/png;base64,t${n}`, mime: 'image/png' }],
    })
    const transcript = [{ role: 'user', content: 'u' }, tool(1), tool(2), tool(3), tool(4)]
    const { evicted, kept } = partitionTranscript(transcript, 120)
    const cleared = [...evicted, ...kept].find((m) => m.content === PRUNED_TOOL_RESULT)
    expect(cleared).toBeDefined()
    expect(cleared.images).toBeUndefined()
    const full = [...evicted, ...kept].find((m) => m.toolCallId === 't2')
    expect(full.images).toEqual([{ dataUrl: 'data:image/png;base64,t2', mime: 'image/png' }])
  })
})
