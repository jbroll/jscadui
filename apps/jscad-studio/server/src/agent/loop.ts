import type { Provider, ProviderEvent, ProviderMessage, ToolCall } from '../providers/types.js'
import { TOOLS } from './tools.js'

export interface Conversation {
  messages: ProviderMessage[]
}

export interface RunTurnOptions {
  conversation: Conversation
  provider: Provider
  /** Returns a promise the caller resolves when the browser answers the tool call. */
  requestTool(name: string, input: unknown): Promise<string>
  onText?(text: string): void
  signal?: AbortSignal
  toolTimeoutMs?: number
}

const DEFAULT_TOOL_TIMEOUT_MS = 120_000

export class ToolTimeoutError extends Error {
  constructor(callId: string, name: string, timeoutMs: number) {
    super(`tool ${name} (${callId}) timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
  }
}

function abortError(message: string): Error {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

// Races iterator.next() against the abort signal so a stalled provider stream cannot outlive a
// disconnected client. On abort the generator is closed from underneath the pending next().
async function nextOrAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next()
  if (signal.aborted) throw abortError('turn aborted')
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => {
      iterator.return?.(undefined).catch(() => {})
      reject(abortError('turn aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // Abort between the check above and the listener registration would otherwise go unnoticed.
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

// Races a tool result against its timeout and the abort signal. Handlers are attached to the
// original promise, so a late rejection from the caller is observed, never an unhandled one.
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  makeTimeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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
      // Same check-after-register as nextOrAbort: an abort that lands in between must still win.
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
}

// One agent turn: send the conversation and tool definitions to the provider, stream text out as
// it arrives, and when the provider asks for a tool, hand the request to the browser and feed the
// result back, repeating until the provider answers. Returns a NEW conversation; the input is
// never mutated, so a second turn on the same conversation starts from the prior messages.
export function runTurn(options: RunTurnOptions): Promise<Conversation> {
  const { conversation, provider, requestTool, onText, signal } = options
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const messages: ProviderMessage[] = [...conversation.messages]

  return new Promise<Conversation>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError('turn aborted'))
      return
    }
    let iterator: AsyncIterator<ProviderEvent> | undefined
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
          const text: string[] = []
          const toolCalls: ToolCall[] = []
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
            // Closes the provider stream once its pending read settles; never awaited, so a stalled
            // provider cannot delay cancellation.
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