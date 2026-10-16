// Chat log shared by the production relay (routes.ts) and the jscad-chat
// launcher (scripts/local/relay.js): one JSONL file per UTC day, one record per
// relayed POST. Plain JS with JSDoc and node: imports only, so plain `node`
// loads it and tsc (allowJs) type-checks and emits it into dist/.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A record's timestamp selects its file, so `ts` must be a full ISO string.
 * @typedef {{ ts: string } & Record<string, unknown>} ChatRecord
 */

/**
 * The request body as it goes into the log: a JSON object without its `tools`
 * (large, and re-derivable), anything else verbatim.
 * @param {import('node:buffer').Buffer} buf
 * @returns {unknown}
 */
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

/**
 * Appends one JSONL line named by the record's UTC day, creating the directory.
 * A failed write warns and continues: the log must never fail the request it
 * describes.
 * @param {string} dir
 * @param {ChatRecord} record
 * @param {{ warn?: (message: string) => void }} [options]
 * @returns {boolean} whether the record reached disk
 */
export const appendChatRecord = (dir, record, { warn = console.warn } = {}) => {
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`)
    return true
  } catch (err) {
    warn(`jscad: chat log write failed (${err instanceof Error ? err.message : String(err)}); continuing without it`)
    return false
  }
}

/**
 * A log handle that warns at most once, so a broken log directory cannot flood
 * the console. Kept for the launcher, which has always written this way.
 * @param {string} dir
 * @param {{ warn?: (message: string) => void }} [options]
 */
export const createChatLog = (dir, { warn = console.warn } = {}) => {
  let warned = false
  return {
    /** @param {ChatRecord} record */
    write(record) {
      appendChatRecord(dir, record, {
        warn: (message) => {
          if (warned) return
          warned = true
          warn(message)
        },
      })
    },
  }
}

/**
 * Tees one relayed upstream response into the chat log: feed every upstream
 * byte to `chunk`, then call `finish` once with the final status. Both relays
 * call this, so their records cannot drift. The record never holds request
 * headers, and its request body drops `tools`.
 * @param {{
 *   log: { write(record: ChatRecord): void } | null,
 *   ts: string,
 *   kind: string,
 *   path: string,
 *   request: import('node:buffer').Buffer,
 *   chatId?: string | null,
 *   started?: number,
 * }} opts
 */
export const teeRelayUpstream = ({ log, ts, kind, path, request, chatId = null, started = Date.now() }) => {
  const decoder = new TextDecoder()
  let response = ''
  return {
    /** @param {Uint8Array} bytes */
    chunk(bytes) {
      if (log) response += decoder.decode(bytes, { stream: true })
    },
    /**
     * @param {number} status
     * @param {{ error?: string, response?: string, inference?: string, costUsd?: number }} [extra]
     *   `response` overrides the accumulated text (an upstream that never streamed
     *   anything, e.g. unreachable); `inference`/`costUsd` are the Phase 2 fields.
     * @returns {ChatRecord | null} the record written, or null when logging is off
     */
    finish(status, extra = {}) {
      if (!log) return null
      const record = {
        ts,
        chatId,
        kind,
        path,
        status,
        request: toLogRequest(request),
        response: extra.response ?? response + decoder.decode(),
        ms: Date.now() - started,
        ...(extra.error ? { error: extra.error } : {}),
        ...(extra.inference !== undefined ? { inference: extra.inference } : {}),
        ...(extra.costUsd !== undefined ? { costUsd: extra.costUsd } : {}),
      }
      log.write(record)
      return record
    },
  }
}
