// Browser-safe agent turn: streams provider text out, hands each tool_use to
// the caller's requestTool, feeds string results back, repeats until the
// provider answers with no tool calls. Ported from the studio server loop;
// the only runtime needs are AbortSignal/clearTimeout plus the fetch in providers.
import { TOOLS } from './tools.js'

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

export class ToolTimeoutError extends Error {
  constructor(callId, name, timeoutMs) {
    super(`tool ${name} (${callId}) timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
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

/**
 * @param {{conversation:{messages:Array<object>},provider:{send:Function},requestTool:Function,onText?:Function,signal?:AbortSignal,toolTimeoutMs?:number}} options
 * @returns {Promise<{messages:Array<object>}>} a NEW conversation; the input is never mutated.
 */
export const runTurn = (options) => {
  const { conversation, provider, requestTool, onText, signal } = options
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const messages = [...conversation.messages]

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
          iterator = provider.send(messages, TOOLS)[Symbol.asyncIterator]()
          try {
            for (;;) {
              const { done, value } = await nextOrAbort(iterator, signal)
              if (done) break
              if (value.type === 'text') {
                text.push(value.text)
                onText?.(value.text)
              } else if (value.type === 'tool_use') {
                toolCalls.push({ id: value.id, name: value.name, input: value.input })
              } else if (value.type === 'done') {
                break
              }
            }
          } finally {
            iterator.return?.(undefined).catch(() => {})
          }
          if (cancelled) throw abortError('turn aborted')
          if (text.length > 0 || toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: text.length > 0 ? text.join('') : null,
              toolCalls,
            })
          }
          if (toolCalls.length === 0) break
          for (const call of toolCalls) {
            const content = await withTimeout(
              requestTool(call.name, call.input),
              toolTimeoutMs,
              signal,
              () => new ToolTimeoutError(call.id, call.name, toolTimeoutMs),
            )
            messages.push({ role: 'tool', toolCallId: call.id, content })
          }
        }
        resolve({ messages })
      } catch (err) {
        reject(err)
      } finally {
        signal?.removeEventListener('abort', cancel)
        if (cancelled) iterator?.return?.(undefined).catch(() => {})
      }
    })()
  })
}