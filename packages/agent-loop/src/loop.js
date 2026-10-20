// Browser-safe agent turn: streams provider text out, hands each tool_use to
// the caller's requestTool, feeds string results back, repeats until the
// provider answers with no tool calls. The only runtime needs are
// AbortSignal/clearTimeout plus the fetch in providers.
import { DEFAULT_API } from './api.js'
import { CONTEXT_BUDGET } from './context.js'
import { argumentsError } from './toolArguments.js'
import { buildTools, READ_ONLY } from './tools.js'

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

// A turn that keeps calling tools without ever answering stops here, so a
// looping model cannot spend the whole context or budget.
export const DEFAULT_MAX_ROUNDS = 32

// Last word when the round cap hits: tools off, answer with text only.
export const MAX_STEPS_PROMPT = 'Maximum steps reached. Respond with text only: summarize what was done, what remains, and the next step.'

// A model repeating the identical call is stuck, not working: the third
// repeat of one (tool, arguments) ends the turn, the opencode/Muse rule.
export const DOOM_LOOP_THRESHOLD = 3

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const doomLoopError = (call) =>
  JSON.stringify({
    ok: false,
    error: {
      name: 'DoomLoopError',
      message: `${call.name} was called ${DOOM_LOOP_THRESHOLD} times with identical arguments; it is stuck in a loop. Change the arguments or try a different approach: ${stableStringify(call.input)}`,
    },
  })

// One tool result may fill at most the budget buildMessages keeps for history,
// so a few oversized results cannot overflow the provider's context.
export const TOOL_RESULT_CHARS = CONTEXT_BUDGET

// All of one turn's tool results together (an eval run is one turn); past
// this each further result is a short note, so many capped results cannot
// overflow the provider's context either.
export const TOOL_RESULTS_PER_TURN_CHARS = 5 * TOOL_RESULT_CHARS

const OVER_TURN_TOTAL = `[tool result omitted: this turn's tool results passed ${TOOL_RESULTS_PER_TURN_CHARS} characters]`

// A `view` result is an object, so it passes through the text cap untouched:
// its renders ride beside the text as image parts, never inside the capped
// string (a PNG data URL is ~340k characters). Everything else is a string.
export const capToolResult = (content) =>
  typeof content === 'string' && content.length > TOOL_RESULT_CHARS
    ? `${content.slice(0, TOOL_RESULT_CHARS)}\n… [tool result truncated: ${TOOL_RESULT_CHARS} of ${content.length} characters shown]`
    : content

// The relay fronts the provider with a 1MB JSON body limit, and past it answers
// 413 (apps/jscad-web/server/src/relay/body.ts). Only the newest view keeps its
// pixels (see pruneViewImages), but one call may still ask for four renders, so
// their data URLs are summed and the oldest dropped until they fit this budget;
// the newest is always kept. Every shot's camera stub survives as text, so the
// model still learns which views it took and can re-ask for a dropped one.
export const MAX_VIEW_IMAGE_CHARS = 700_000

// The newest images that fit `MAX_VIEW_IMAGE_CHARS`, in their original order.
const imagesWithinBudget = (images) => {
  const kept = []
  let chars = 0
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const image = images[i]
    const size = typeof image?.dataUrl === 'string' ? image.dataUrl.length : 0
    // Always keep at least the newest image, even alone over budget.
    if (kept.length > 0 && chars + size > MAX_VIEW_IMAGE_CHARS) break
    kept.push(image)
    chars += size
  }
  return kept.reverse()
}

// A `view` tool result carries its renders as provider-native image parts
// beside a small text stub of the cameras actually used. The stub stays text
// so camera history survives pruning and counts toward the turn's text budget;
// the image parts bypass the cap and are dropped from superseded views.
const viewPartsOf = (result) =>
  result !== null && typeof result === 'object' && Array.isArray(result.shots)
    ? {
        content: JSON.stringify({ ok: result.ok ?? true, cameras: result.shots.map((shot) => shot.camera) }),
        images: imagesWithinBudget(result.shots.map((shot) => shot.image)),
      }
    : null

const asToolMessage = (call, content) => {
  const parts = typeof content === 'string' ? null : viewPartsOf(content)
  if (!parts) return { role: 'tool', toolCallId: call.id, content }
  return { role: 'tool', toolCallId: call.id, content: parts.content, images: parts.images }
}

// Only the newest view result keeps its pixels: earlier views lose their
// image parts (their camera stubs stay in `content`) so a turn never resends
// renders it can no longer act on. Runs after each round; the tool messages
// here are this turn's own, so dropping keys cannot touch the caller's input.
const pruneViewImages = (messages) => {
  let last = -1
  for (let i = 0; i < messages.length; i += 1) {
    if (Array.isArray(messages[i].images) && messages[i].images.length > 0) last = i
  }
  for (let i = 0; i < last; i += 1) {
    if (Array.isArray(messages[i].images) && messages[i].images.length > 0) {
      const { images: _images, ...rest } = messages[i]
      messages[i] = rest
    }
  }
}

export class ToolTimeoutError extends Error {
  constructor(callId, name, timeoutMs) {
    super(`tool ${name} (${callId}) timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
  }
}

const OUT_OF_TOKENS = new Set(['length', 'max_tokens'])

// A provider round with neither text nor a tool call (a reply that is all
// reasoning, or a stop on the length limit) leaves the user with nothing.
export class EmptyReplyError extends Error {
  constructor(stopReason) {
    super(`the model stopped without answering (stop reason: ${stopReason ?? 'none'})`)
    this.name = 'EmptyReplyError'
    this.stopReason = stopReason
  }
}

// A provider's safety filter can answer with a refusal instead of a reply.
export class RefusalError extends Error {
  constructor(refusal) {
    super(refusal ? `the provider refused: ${refusal}` : 'the provider refused to answer')
    this.name = 'RefusalError'
    this.refusal = refusal
  }
}

const abortError = (message) => {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

// Races iterator.next() against the abort signal so a stalled provider stream
// cannot outlive a disconnected view.
const nextOrAbort = async (iterator, signal) => {
  if (!signal) return iterator.next()
  if (signal.aborted) throw abortError('turn aborted')
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      iterator.return?.(undefined).catch(() => {})
      reject(abortError('turn aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    iterator.next().then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

// Races a tool result against its timeout and the abort signal.
const withTimeout = (promise, timeoutMs, signal, makeTimeoutError) =>
  new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(makeTimeoutError())
    }, timeoutMs)
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(abortError('turn aborted'))
    }
    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(abortError('turn aborted'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      },
    )
  })

const STATUS_DETAIL_CHARS = 40

// The argument that tells one call of a tool from another, for a status line or a chat tool row.
// A `question` call has no path/query, so its short header, then the question, names it.
export const toolDetail = (input) => {
  const value = [input?.path, input?.query, input?.format, input?.header, input?.question].find((v) => typeof v === 'string' && v !== '')
  if (value === undefined) return undefined
  return value.length > STATUS_DETAIL_CHARS ? `${value.slice(0, STATUS_DETAIL_CHARS - 1)}…` : value
}

/**
 * `onStatus` hears where the turn is: `{phase: 'thinking', reasoningChars?}`
 * from each request until its first output, `{phase: 'text'}` when text
 * starts, `{phase: 'tool', tool, detail?}` before each tool runs,
 * `{phase: 'retry', attempt, maxAttempts}` when the provider is retried,
 * `{phase: 'usage', inputTokens, outputTokens, reasoningTokens}` when the
 * provider reports use, and
 * `{phase: 'done'}` once the turn has ended, however it ended. `onText` and
 * `onReasoning` hear each streamed delta; reasoning never enters the messages.
 * `onUsage` hears each usage report; usage never enters the messages.
 * `beforeToolCall(name, input)` may deny a call (`{decision:'deny', reason?}`)
 * or rewrite its arguments (`{updatedInput}`); a throw blocks the call with
 * a tool error. `toolFilter(name)` hides tools from the offered set (a pinned
 * `false` removes the tool from `buildTools` output). `afterToolCall(name, input, result)` may replace the result
 * (`{result}` or a string); a throw becomes a tool error. Denials, rewrites
 * and hook failures are results the model sees, never turn failures.
 * @param {{conversation:{messages:Array<object>},provider:{send:Function},requestTool:Function,onText?:Function,onReasoning?:Function,onUsage?:Function,onStatus?:Function,beforeToolCall?:Function,afterToolCall?:Function,signal?:AbortSignal,toolTimeoutMs?:number,maxRounds?:number,capFinalAnswer?:boolean,toolChoice?:'none'|'auto'|'any',api?:'fluent'|'modeling',vision?:boolean}} options
 * @returns {Promise<{messages:Array<object>,rounds:number,stopped:string|undefined}>} a NEW conversation; the input is never mutated. `stopped` is `'max_rounds'` at the round cap or `'doom_loop'` on a triple repeat. A rejection carries the messages so far as `error.messages`.
 */
export const runTurn = (options) => {
  const { conversation, provider, requestTool, onText, onReasoning, signal } = options
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS
  // The eval harness counts every provider send as a round, so it opts out;
  // the app leaves this on so a capped turn still answers.
  const capFinalAnswer = options.capFinalAnswer ?? true
  const tools = typeof options.toolFilter === 'function' ? buildTools(options.api ?? DEFAULT_API, { vision: options.vision }).filter((tool) => options.toolFilter(tool.name)) : buildTools(options.api ?? DEFAULT_API, { vision: options.vision })
  const messages = [...conversation.messages]
  let rounds = 0
  let resultChars = 0
  const repeats = new Map()
  let phase
  const report = (status) => {
    phase = status.phase
    try {
      options.onStatus?.(status)
    } catch {
      // A status display that throws must not end the turn.
    }
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('turn aborted'))
      return
    }
    let iterator
    let cancelled = false
    const cancel = () => {
      cancelled = true
      iterator?.return?.(undefined).catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()

    void (async () => {
      // One last turn with tools off, so a capped turn still answers instead
      // of stopping silent. Empty or failed answers resolve without one.
      const finalAnswer = async () => {
        const text = []
        try {
          report({ phase: 'thinking' })
          const closing = provider.send([...messages, { role: 'user', content: MAX_STEPS_PROMPT }], [], { toolChoice: 'none' })[Symbol.asyncIterator]()
          try {
            for (;;) {
              const { done, value } = await nextOrAbort(closing, signal)
              if (done) break
              if (value.type === 'text') {
                if (phase !== 'text') report({ phase: 'text' })
                text.push(value.text)
                onText?.(value.text)
              } else if (value.type === 'done') break
            }
          } finally {
            closing.return?.(undefined).catch(() => {})
          }
        } catch {
          return
        }
        if (cancelled || text.length === 0) return
        messages.push({ role: 'assistant', content: text.join(''), toolCalls: [] })
      }
      let resent = false
      try {
        for (;;) {
          rounds += 1
          if (rounds > maxRounds) {
            if (capFinalAnswer) await finalAnswer()
            report({ phase: 'done', stopped: 'max_rounds' })
            resolve({ messages, rounds: maxRounds, stopped: 'max_rounds' })
            return
          }
          const text = []
          const toolCalls = []
          const badCalls = new Map()
          const refusal = []
          let stopReason
          let reasoningChars = 0
          report({ phase: 'thinking' })
          iterator = provider.send(messages, tools, { toolChoice: options.toolChoice })[Symbol.asyncIterator]()
          try {
            for (;;) {
              const { done, value } = await nextOrAbort(iterator, signal)
              if (done) break
              if (value.type === 'text') {
                if (phase !== 'text') report({ phase: 'text' })
                text.push(value.text)
                onText?.(value.text)
              } else if (value.type === 'reasoning') {
                reasoningChars += value.text.length
                report({ phase: 'thinking', reasoningChars })
                onReasoning?.(value.text)
              } else if (value.type === 'refusal') {
                refusal.push(value.text)
              } else if (value.type === 'retry') {
                report({ phase: 'retry', attempt: value.attempt + 1, maxAttempts: value.maxAttempts })
              } else if (value.type === 'usage') {
                const usage = { inputTokens: value.inputTokens ?? null, outputTokens: value.outputTokens ?? null, reasoningTokens: value.reasoningTokens ?? null }
                try {
                  options.onUsage?.(usage)
                } catch {
                  // A usage display that throws must not end the turn.
                }
                report({ phase: 'usage', ...usage })
              } else if (value.type === 'tool_use') {
                const call = { id: value.id, name: value.name, input: value.input }
                if (value.badArguments !== undefined) badCalls.set(call, value)
                toolCalls.push(call)
              } else if (value.type === 'done') {
                stopReason = value.stopReason
                break
              }
            }
          } finally {
            iterator.return?.(undefined).catch(() => {})
          }
          if (cancelled) throw abortError('turn aborted')
          if (text.length === 0 && toolCalls.length === 0) {
            if (refusal.length > 0 || stopReason === 'refusal') throw new RefusalError(refusal.join(''))
            // Free models sometimes end a round with nothing; the same request
            // usually answers. A length stop would only run out again.
            if (!resent && !OUT_OF_TOKENS.has(stopReason)) {
              resent = true
              rounds -= 1
              continue
            }
            throw new EmptyReplyError(stopReason)
          }
          resent = false
          messages.push({
            role: 'assistant',
            content: text.length > 0 ? text.join('') : null,
            toolCalls,
          })
          if (toolCalls.length === 0) break
          const contents = new Array(toolCalls.length)
          const readOnly = []
          const mutating = []
          let doomLoop = false
          toolCalls.forEach((call, i) => {
            if (badCalls.has(call)) contents[i] = argumentsError(badCalls.get(call), stopReason)
            else if (READ_ONLY.has(call.name)) readOnly.push(i)
            else mutating.push(i)
          })
          // One call end to end: hook gate, repeat guard, run, hook rewrite.
          // A hook or guard failure is a result, never a throw, so the turn
          // always has content to feed back.
          const runOneTool = async (i) => {
            const call = toolCalls[i]
            let input = call.input
            try {
              const pre = await options.beforeToolCall?.(call.name, input)
              if (pre?.decision === 'deny') {
                return JSON.stringify({ ok: false, error: { name: 'DeniedError', message: pre.reason ?? `${call.name} was denied` } })
              }
              if (pre?.updatedInput !== undefined) input = pre.updatedInput
            } catch (err) {
              return JSON.stringify({ ok: false, error: { name: err?.name ?? 'HookError', message: err?.message ?? String(err) } })
            }
            const key = `${call.name}\n${stableStringify(input)}`
            const count = (repeats.get(key) ?? 0) + 1
            repeats.set(key, count)
            if (count >= DOOM_LOOP_THRESHOLD) {
              doomLoop = true
              return doomLoopError({ ...call, input })
            }
            const detail = toolDetail(input)
            report({ phase: 'tool', tool: call.name, ...(detail === undefined ? {} : { detail }) })
            let result = await withTimeout(
              requestTool(call.name, input),
              toolTimeoutMs,
              signal,
              () => new ToolTimeoutError(call.id, call.name, toolTimeoutMs),
            )
            try {
              const post = await options.afterToolCall?.(call.name, input, result)
              if (typeof post === 'string') result = post
              else if (post?.result !== undefined) result = post.result
            } catch (err) {
              return JSON.stringify({ ok: false, error: { name: err?.name ?? 'HookError', message: err?.message ?? String(err) } })
            }
            return result
          }
          await Promise.all(
            readOnly.map(async (i) => {
              contents[i] = await runOneTool(i)
            }),
          )
          for (const i of mutating) {
            contents[i] = await runOneTool(i)
          }
          toolCalls.forEach((call, i) => {
            // A view result is an object: capToolResult leaves it whole, and it
            // becomes a camera text stub (which counts toward the turn budget)
            // plus image parts (which do not).
            const message = asToolMessage(call, capToolResult(contents[i]))
            const size = typeof message.content === 'string' ? message.content.length : 0
            if (resultChars + size > TOOL_RESULTS_PER_TURN_CHARS) {
              messages.push({ role: 'tool', toolCallId: call.id, content: OVER_TURN_TOTAL })
            } else {
              resultChars += size
              messages.push(message)
            }
          })
          pruneViewImages(messages)
          if (doomLoop) {
            report({ phase: 'done', stopped: 'doom_loop' })
            resolve({ messages, rounds, stopped: 'doom_loop' })
            return
          }
        }
        report({ phase: 'done' })
        resolve({ messages, rounds, stopped: undefined })
      } catch (err) {
        // Every tool_use needs a tool_result, or the next provider call is a
        // protocol error: an abort or timeout mid-batch leaves orphaned calls,
        // so synthesize an error result for each one the turn never answered.
        const failed = err?.name ?? 'Error'
        const failedMessage = err?.message ?? String(err)
        const covered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId))
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const m = messages[i]
          if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue
          for (const call of m.toolCalls) {
            if (!covered.has(call.id)) {
              covered.add(call.id)
              messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ ok: false, error: { name: failed, message: failedMessage } }) })
            }
          }
          break
        }
        if (err !== null && typeof err === 'object') err.messages ??= messages
        report({ phase: 'done' })
        reject(err)
      } finally {
        signal?.removeEventListener('abort', cancel)
        if (cancelled) iterator?.return?.(undefined).catch(() => {})
      }
    })()
  })
}