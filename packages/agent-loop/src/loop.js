// Browser-safe agent turn: streams provider text out, hands each tool_use to
// the caller's requestTool, feeds string results back, repeats until the
// provider answers with no tool calls. Ported from the studio server loop;
// the only runtime needs are AbortSignal/clearTimeout plus the fetch in providers.
import { DEFAULT_API } from './api.js'
import { CONTEXT_BUDGET } from './context.js'
import { argumentsError } from './toolArguments.js'
import { buildTools } from './tools.js'

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

// One tool result may fill at most the budget buildMessages keeps for history,
// so a few oversized results cannot overflow the provider's context.
export const TOOL_RESULT_CHARS = CONTEXT_BUDGET

// All of one turn's tool results together (an eval run is one turn); past
// this each further result is a short note, so many capped results cannot
// overflow the provider's context either.
export const TOOL_RESULTS_PER_TURN_CHARS = 5 * TOOL_RESULT_CHARS

const OVER_TURN_TOTAL = `[tool result omitted: this turn's tool results passed ${TOOL_RESULTS_PER_TURN_CHARS} characters]`

export const capToolResult = (content) =>
  typeof content === 'string' && content.length > TOOL_RESULT_CHARS
    ? `${content.slice(0, TOOL_RESULT_CHARS)}\n… [tool result truncated: ${TOOL_RESULT_CHARS} of ${content.length} characters shown]`
    : content

export class ToolTimeoutError extends Error {
  constructor(callId, name, timeoutMs) {
    super(`tool ${name} (${callId}) timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
  }
}

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
export const toolDetail = (input) => {
  const value = [input?.path, input?.query, input?.format].find((v) => typeof v === 'string' && v !== '')
  if (value === undefined) return undefined
  return value.length > STATUS_DETAIL_CHARS ? `${value.slice(0, STATUS_DETAIL_CHARS - 1)}…` : value
}

/**
 * `onStatus` hears where the turn is: `{phase: 'thinking', reasoningChars?}`
 * from each request until its first output, `{phase: 'text'}` when text
 * starts, `{phase: 'tool', tool, detail?}` before each tool runs,
 * `{phase: 'retry', attempt, maxAttempts}` when the provider is retried, and
 * `{phase: 'done'}` once the turn has ended, however it ended. `onText` and
 * `onReasoning` hear each streamed delta; reasoning never enters the messages.
 * @param {{conversation:{messages:Array<object>},provider:{send:Function},requestTool:Function,onText?:Function,onReasoning?:Function,onStatus?:Function,signal?:AbortSignal,toolTimeoutMs?:number,api?:'fluent'|'modeling'}} options
 * @returns {Promise<{messages:Array<object>}>} a NEW conversation; the input is never mutated. A rejection carries the messages so far as `error.messages`.
 */
export const runTurn = (options) => {
  const { conversation, provider, requestTool, onText, onReasoning, signal } = options
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const tools = buildTools(options.api ?? DEFAULT_API)
  const messages = [...conversation.messages]
  let resultChars = 0
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
      try {
        for (;;) {
          const text = []
          const toolCalls = []
          const badCalls = new Map()
          const refusal = []
          let stopReason
          let reasoningChars = 0
          report({ phase: 'thinking' })
          iterator = provider.send(messages, tools)[Symbol.asyncIterator]()
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
            throw new EmptyReplyError(stopReason)
          }
          messages.push({
            role: 'assistant',
            content: text.length > 0 ? text.join('') : null,
            toolCalls,
          })
          if (toolCalls.length === 0) break
          for (const call of toolCalls) {
            if (!badCalls.has(call)) {
              const detail = toolDetail(call.input)
              report({ phase: 'tool', tool: call.name, ...(detail === undefined ? {} : { detail }) })
            }
            const content = badCalls.has(call)
              ? argumentsError(badCalls.get(call), stopReason)
              : await withTimeout(
                  requestTool(call.name, call.input),
                  toolTimeoutMs,
                  signal,
                  () => new ToolTimeoutError(call.id, call.name, toolTimeoutMs),
                )
            let capped = capToolResult(content)
            const size = typeof capped === 'string' ? capped.length : 0
            if (resultChars + size > TOOL_RESULTS_PER_TURN_CHARS) capped = OVER_TURN_TOTAL
            else resultChars += size
            messages.push({ role: 'tool', toolCallId: call.id, content: capped })
          }
        }
        report({ phase: 'done' })
        resolve({ messages })
      } catch (err) {
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