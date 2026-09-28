export const CONSOLE_CAP_LINES = 50
export const CONSOLE_CAP_CHARS = 4000
const LEVELS = ['log', 'info', 'warn', 'error', 'debug']

const formatValue = (v) => {
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

export const formatConsoleArgs = (args) => args.map(formatValue).join(' ')

export const createConsoleCollector = ({ lines: capLines = CONSOLE_CAP_LINES, chars: capChars = CONSOLE_CAP_CHARS } = {}) => {
  let lines = []
  let chars = 0
  let dropped = 0
  const append = (line) => {
    if (lines.length >= capLines || chars + line.length > capChars) {
      dropped += 1
      return
    }
    lines.push(line)
    chars += line.length
  }
  return {
    append,
    capture: (...args) => append(formatConsoleArgs(args)),
    reset: () => {
      lines = []
      chars = 0
      dropped = 0
    },
    list: () => (dropped > 0 ? [...lines, `… (${dropped} more lines)`] : [...lines]),
  }
}

// Temporary console patch for one run (the eval backend); the frame worker's
// own long-lived patch lives in apps/jscad-web/src_frame/consoleCapture.js.
export const installConsoleCapture = ({ forward = false } = {}) => {
  const collector = createConsoleCollector()
  const real = {}
  for (const level of LEVELS) {
    real[level] = console[level]
    console[level] = (...args) => {
      collector.capture(...args)
      if (forward) real[level]?.apply(console, args)
    }
  }
  return {
    restore: () => {
      for (const level of LEVELS) console[level] = real[level]
    },
    list: collector.list,
  }
}
