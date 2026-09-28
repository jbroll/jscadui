import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const toLogRequest = (buf) => {
  const text = buf.toString('utf8')
  try {
    const body = JSON.parse(text)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    const { tools: _tools, ...rest } = body
    return rest
  } catch {
    return text
  }
}

export const createChatLog = (dir, { warn = console.warn } = {}) => {
  let warned = false
  return {
    write(record) {
      try {
        mkdirSync(dir, { recursive: true })
        appendFileSync(join(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`)
      } catch (err) {
        if (warned) return
        warned = true
        warn(`jscad: chat log write failed (${err.message}); continuing without it`)
      }
    },
  }
}
