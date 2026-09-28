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

export function formatToolCall(name, input) {
  if (input && typeof input.source === 'string') return `→ ${name}\n${indent(input.source)}`
  const rest = input && Object.keys(input).length > 0 ? ` ${JSON.stringify(input)}` : ''
  return `→ ${name}${rest}`
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
