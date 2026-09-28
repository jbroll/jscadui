import { createConsoleCollector } from '@jscadui/agent-loop/src/consoleCapture.js'

const LEVELS = ['log', 'info', 'warn', 'error', 'debug']

// The editor's own runs must keep logging to devtools as before, so every
// console call is forwarded to the real console as well as recorded.
export const installRunConsole = ({ setRunConsole }) => {
  const collector = createConsoleCollector()
  setRunConsole(collector)
  for (const level of LEVELS) {
    const real = console[level]
    console[level] = (...args) => {
      collector.capture(...args)
      real.apply(console, args)
    }
  }
  return collector
}
