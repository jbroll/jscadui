/**
 * echo() output comparison for test-harness.js.
 *
 * The reference is OpenSCAD's `-o file.echo` export: one message per line,
 * each starting with a tag (`ECHO: `, `WARNING: `, ...). An echoed string
 * containing a newline continues on the next line with no tag. The generated
 * side is run-jscad.js --echo: a JSON array of `ECHO: ...` entries.
 *
 * Only ECHO messages are compared. Warnings and errors are worded by each
 * implementation and are not part of the model's output.
 */

const TAG = /^([A-Z][A-Z-]*):(?: |$)/

/** ECHO entries of an OpenSCAD .echo export, multi-line entries rejoined. */
export function parseEchoExport(text) {
  const entries = []
  let inEcho = false
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    const tag = line.match(TAG)?.[1]
    if (tag) {
      inEcho = tag === 'ECHO'
      if (inEcho) entries.push(line)
    } else if (inEcho) {
      entries[entries.length - 1] += '\n' + line
    }
  }
  return entries
}

/**
 * Compare reference and generated ECHO entries.
 * @returns {{ match: boolean, refCount: number, genCount: number, index?: number, expected?: string, actual?: string }}
 * index is the first entry that differs; expected/actual are undefined past
 * the end of the shorter list.
 */
export function compareEcho(ref, gen) {
  const result = { match: true, refCount: ref.length, genCount: gen.length }
  const n = Math.max(ref.length, gen.length)
  for (let i = 0; i < n; i++) {
    if (ref[i] !== gen[i]) {
      return { ...result, match: false, index: i, expected: ref[i], actual: gen[i] }
    }
  }
  return result
}

/** One-line description of a mismatch from compareEcho(). */
export function describeEchoMismatch(cmp) {
  const show = s => s === undefined ? '(none)' : JSON.stringify(s.length > 120 ? s.slice(0, 117) + '...' : s)
  return `echo ${cmp.index + 1}/${cmp.refCount} (got ${cmp.genCount}): expected ${show(cmp.expected)}, got ${show(cmp.actual)}`
}
