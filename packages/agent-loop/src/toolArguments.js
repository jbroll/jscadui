const SHOWN_CHARS = 300

// A call whose arguments are not JSON goes on to the loop, which answers it
// with a tool error the model can retry, keeping the start of the text the
// provider sent so the next occurrence shows its cause.
export const parseToolArguments = (raw) => {
  try {
    return { input: JSON.parse(raw || '{}') }
  } catch {
    const text = String(raw)
    const badArguments = text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS)}… (${text.length - SHOWN_CHARS} more characters)` : text
    return { input: {}, badArguments }
  }
}

export const argumentsError = (call, stopReason) =>
  JSON.stringify({
    ok: false,
    error: {
      name: 'ArgumentsError',
      message: `arguments for ${call.name} were not valid JSON (finish_reason ${call.finishReason ?? stopReason ?? 'none'}); call it again with a JSON object: ${call.badArguments}`,
    },
  })
