// Where a NaN option came from: the expression written for it at the call the
// error names, and the names that expression reads. The option check sees only
// the values; the source says which field or variable was undefined.

const NAN_ITEMS = /(?:^|: )([A-Za-z_$][\w$]*(?:\[\d+\])?(?:, [A-Za-z_$][\w$]*(?:\[\d+\])?)*) (?:is|are) NaN/m
const WINDOW_LINES = 10
const OPEN = { '(': ')', '[': ']', '{': '}' }
const NOT_INPUTS = new Set(['Math', 'Number', 'JSON', 'Array', 'Object', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'new', 'typeof'])

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// From `start`, the text up to the first top-level `stops` character, as
// [pieces split at top-level commas, end]; quotes and brackets nest.
const scan = (text, start, stops) => {
  const pieces = []
  const stack = []
  let quote = null
  let from = start
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (OPEN[c]) stack.push(OPEN[c])
    else if (stack.length > 0 && c === stack.at(-1)) stack.pop()
    else if (stack.length === 0 && stops.includes(c)) {
      pieces.push(text.slice(from, i).trim())
      return pieces
    } else if (stack.length === 0 && c === ',') {
      pieces.push(text.slice(from, i).trim())
      from = i + 1
    }
  }
  return null
}

const inputsOf = (expr) => {
  const names = expr.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '').match(/[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*/g) ?? []
  return names.map((name) => name.replace(/\s+/g, '')).filter((name) => !NOT_INPUTS.has(name.split(/\??\./)[0]))
}

const listed = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])

/**
 * @param {string} message the option check's error, `<fn>: size[0], size[1] are NaN: …`
 * @param {Record<string, unknown>} files the project's files
 * @param {string} file the file the error names
 * @param {number} line its 1-based line
 * @returns {string | null}
 */
export const nanSourceHint = (message, files, file, line) => {
  const items = NAN_ITEMS.exec(String(message ?? ''))?.[1].split(', ')
  const text = files?.[file]
  if (!items || typeof text !== 'string' || !Number.isInteger(line)) return null
  const option = items[0].replace(/\[\d+\]$/, '')
  const window = text.split('\n').slice(line - 1, line - 1 + WINDOW_LINES).join('\n')
  const at = new RegExp(`[{,]\\s*${escapeRegex(option)}\\s*:\\s*`).exec(window)
  if (!at) return null
  const valueStart = at.index + at[0].length
  const quoted = []
  if (items[0].endsWith(']')) {
    if (window[valueStart] !== '[') return null
    const elements = scan(window, valueStart + 1, ']')
    if (!elements) return null
    for (const item of items) {
      const expr = elements[Number(/\[(\d+)\]$/.exec(item)[1])]
      if (expr) quoted.push([item, expr])
    }
  } else {
    const value = scan(window, valueStart, ',})')?.[0]
    if (value) quoted.push([option, value])
  }
  if (quoted.length === 0) return null
  const inputs = [...new Set(quoted.flatMap(([, expr]) => inputsOf(expr)))]
  const head = `${listed(quoted.map(([item, expr]) => `${item} is ${expr}`))} at ${file}:${line}`
  if (inputs.length === 0) return head
  return `${head}; ${inputs.length > 1 ? `one of ${inputs.join(', ')}` : inputs[0]} is undefined or NaN there`
}
