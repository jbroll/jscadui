import { readFileSync } from 'node:fs'
import { PROVIDER_BASE_URLS, parseAllowlist } from './policy.js'

// A missing file means the built-in table; any other read failure is an error.
export const loadAllowlistFile = (path: string): Record<string, string> => {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...PROVIDER_BASE_URLS }
    throw new Error(`relay: cannot read allowlist ${path}: ${(err as Error).message}`)
  }
  return parseAllowlist(raw, path)
}
