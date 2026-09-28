import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// realpath resolves a symlinked invocation to the same path import.meta.url
// reports, unlike a raw argv[1] comparison (or new URL(...).pathname, which
// is URL-decoded and can diverge from the filesystem path too).
export const isMainModule = (argv1, moduleUrl) => {
  if (!argv1) return false
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}
