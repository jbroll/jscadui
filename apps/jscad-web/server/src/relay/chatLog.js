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
 * Width and height from a PNG, GIF or JPEG header, or null.
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number } | null}
 */
export const imageSize = (bytes) => {
  try {
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    if (bytes.length >= 10 && bytes.toString('latin1', 0, 4) === 'GIF8') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
    for (let at = 2; at + 9 <= bytes.length; ) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]
      // SOF0..SOF15 carry the frame size; C4, C8 and CC are other tables.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
      }
      at += 2 + bytes.readUInt16BE(at + 2)
    }
  } catch {
    // A truncated header reads past the end.
  }
  return null
}

/**
 * @param {string} mime
 * @param {string} base64
 */
const imagePlaceholder = (mime, base64) => {
  const size = imageSize(Buffer.from(base64, 'base64'))
  return `[image: ${mime}${size ? `, ${size.width}x${size.height}` : ''}]`
}

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s

/**
 * An inline image part of any provider's wire format as a text part naming its
 * type and size, so the log never holds image bytes. Anything else is null.
 * @param {Record<string, any>} part
 * @returns {Record<string, string> | null}
 */
const imagePartText = (part) => {
  if (part.type === 'image' && part.source?.type === 'base64' && typeof part.source.data === 'string') {
    return { type: 'text', text: imagePlaceholder(String(part.source.media_type ?? 'image'), part.source.data) }
  }
  const url = part.type === 'image_url' ? part.image_url?.url ?? part.image_url : part.type === 'input_image' ? part.image_url : null
  const match = typeof url === 'string' ? DATA_URL.exec(url) : null
  if (!match) return null
  return { type: part.type === 'input_image' ? 'input_text' : 'text', text: imagePlaceholder(match[1], match[2]) }
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
const withoutImageBytes = (value) => {
  if (Array.isArray(value)) return value.map(withoutImageBytes)
  if (value === null || typeof value !== 'object') return value
  const part = /** @type {Record<string, any>} */ (value)
  const text = imagePartText(part)
  if (text) return text
  return Object.fromEntries(Object.entries(part).map(([key, inner]) => [key, withoutImageBytes(inner)]))
}

/**
 * The request body as it goes into the log: a JSON object without its `tools`
 * (large, and re-derivable) and with each inline image replaced by a
 * `[image: <mime>, <w>x<h>]` text part, anything else verbatim.
 * @param {import('node:buffer').Buffer} buf
 * @returns {unknown}
 */
export const toLogRequest = (buf) => {
  const text = buf.toString('utf8')
  try {
    const body = JSON.parse(text)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
    const { tools: _tools, ...rest } = body
    return withoutImageBytes(rest)
  } catch {
    return text
  }
}

/** @param {string} ts a full ISO timestamp */
export const chatLogFileName = (ts) => `${ts.slice(0, 10)}.jsonl`

/** The names `chatLogFileName` produces; retention deletes only these. */
export const CHAT_LOG_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/

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
    appendFileSync(join(dir, chatLogFileName(record.ts)), `${JSON.stringify(record)}\n`)
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
