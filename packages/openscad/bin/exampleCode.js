/**
 * Shared by extract-bosl1-examples.js and extract-bosl2-examples.js.
 *
 * The library doc comments these examples come from are prose as often as they
 * are code: `flatten([[1,2,3]]) returns [1,2,3]`, or a stray extra paren
 * (BOSL2 math.scad's cumprod). Inserting `$fn` before the last `)` in the block
 * put it outside the call in both cases and produced a file that neither
 * OpenSCAD nor the transpiler can parse.
 */

/** Index of the `(` that opens the call on this line, or -1. */
function callOpen(line) {
  const comment = line.indexOf('//')
  const code = comment === -1 ? line : line.slice(0, comment)
  return code.indexOf('(')
}

/** Index of the `)` matching the bracket at `open`, or -1 if unbalanced. */
function matchingClose(line, open) {
  let depth = 0
  for (let i = open; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      i = line.indexOf('"', i + 1)
      if (i === -1) return -1
    } else if (c === '(' || c === '[') {
      depth++
    } else if (c === ')' || c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Add `$fn=<fn>` to the last call in an extracted example and terminate it.
 * Anything after the call other than a `//` comment is library prose and is
 * dropped. Returns the code unchanged when it already sets $fn or when no line
 * holds a balanced call.
 *
 * @param {string} code - the extracted example body
 * @param {number} [fn] - the $fn value to pin
 * @returns {string}
 */
export function withRenderFn(code, fn = 32) {
  const trimmed = code.trim()
  if (/\$fn\s*=/.test(trimmed)) return trimmed

  const lines = trimmed.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const open = callOpen(line)
    if (open === -1) continue
    const close = matchingClose(line, open)
    if (close === -1) continue

    const call = line.slice(0, close)
    const empty = call.slice(open + 1).trim() === ''
    const commentAt = line.indexOf('//', close)
    const comment = commentAt === -1 ? '' : `  ${line.slice(commentAt).trim()}`

    lines[i] = `${empty ? call : `${call}, $fn=${fn}`});${comment}`
    return lines.join('\n')
  }
  return trimmed
}
