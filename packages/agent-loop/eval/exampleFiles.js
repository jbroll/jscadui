// A multi-file example marks each file with a `// name.js` line; main.js comes last.
export const exampleFiles = (source) => {
  const parts = source.split(/^(?=\/\/ [\w/-]+\.js\b)/m)
  if (parts.length === 1) return [['main.js', source]]
  return parts.slice(1).map((part) => [part.match(/^\/\/ ([\w/-]+\.js)/)[1], part])
}

/** Writes each file of an example into the backend; the last write's report. */
export const writeExample = async (backend, source) => {
  let res
  for (const [path, content] of exampleFiles(source)) res = JSON.parse(await backend.requestTool('write', { path, content }))
  return res
}
