// Pure formatting for EVAL_VERBOSE console output; kept separate from
// run-eval.js so the layout is unit-testable without a run. Full content,
// not clipped, except the result JSON line (see formatToolResult).
const clip = (s, n) => (s.length > n ? s.slice(0, n) : s)
const indent = (s) => s.split('\n').map((l) => `    ${l}`).join('\n')

export function formatRunHeader(fixture, run, runs) {
  return `== ${fixture.name} run ${run}/${runs}\nuser: ${fixture.prompt}`
}

export function formatText(text) {
  return `assistant: ${text}`
}

const marked = (mark, s) => s.split('\n').map((l) => `${mark}${l}`).join('\n')

export function formatToolCall(name, input) {
  const args = input ?? {}
  if (typeof args.source === 'string') return `→ ${name}\n${indent(args.source)}`
  if (typeof args.content === 'string') return `→ ${name} ${args.path}\n${indent(args.content)}`
  if (typeof args.oldString === 'string' && typeof args.newString === 'string') {
    return `→ ${name} ${args.path}${args.replaceAll ? ' (every occurrence)' : ''}\n${indent(marked('- ', args.oldString))}\n${indent(marked('+ ', args.newString))}`
  }
  const rest = Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : ''
  return `→ ${name}${rest}`
}

export function formatRetry({ attempt, maxAttempts, status, reason, delayMs }) {
  const cause = status != null ? `status ${status}` : 'network error'
  return `retry ${attempt}/${maxAttempts} after ${cause}: ${clip(reason ?? '', 200)} (waiting ${delayMs}ms)`
}

export function formatToolResult(resultString) {
  let parsed
  try {
    parsed = JSON.parse(resultString)
  } catch {
    parsed = null
  }
  if (parsed && parsed.ok === false && parsed.error) {
    const message = parsed.error.message ?? ''
    return message.includes('\n')
      ? `← FAILED ${parsed.error.name ?? 'Error'}:\n${indent(message)}`
      : `← FAILED ${parsed.error.name ?? 'Error'}: ${message}`
  }
  return `← ok ${clip(resultString, 300)}`
}
