import type { Express, Request, Response } from 'express';
import { RATE_PER_MIN, RelayRefusal, assertPublicUpstream, createLimiter, isTrustedRequest } from '../relay/policy.js';

// The relay reaches arbitrary public pages the browser cannot: cross-origin
// reads are opaque to fetch(). The guard rails live here, not on the page:
// http(s) only, a bounded redirect chain re-checked per hop, a bounded body,
// and a bounded answer. Nothing about the operator's session leaves this
// module's closure.

/** Characters of extracted text the answer keeps. */
export const MAX_CONTENT_CHARS = 8000;
/** Raw upstream body bytes past which the page is refused, not truncated. */
export const MAX_BODY_BYTES = 2_000_000;
/** Redirects followed before the chain is abandoned. */
export const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchRouteOptions {
  trustedOrigins: string[];
  logger?: (entry: Record<string, unknown>) => void;
  fetchFn?: typeof fetch;
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
}

const escapeFences = (text: string): string => text.split('```').join('``\u200b`');

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

// Named and numeric references, no HTML parser. An out-of-range numeric code
// point resolves to nothing rather than throwing.
const safeCodePoint = (code: number): string | null =>
  Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;

const decodeEntities = (text: string): string =>
  text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = parseInt(name.slice(2), 16);
      return safeCodePoint(code) ?? whole;
    }
    if (name.startsWith('#')) {
      const code = parseInt(name.slice(1), 10);
      return safeCodePoint(code) ?? whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

const titleOf = (html: string): string => {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() : '';
};

// The answer's URL never carries the fetch's query string or fragment: they are
// where a caller's secret token or session id often rides, and the model does
// not need them to cite the page.
const withoutQuery = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return value;
  }
};

// Tag-strip + entity-decode, no HTML parser dependency. Script and style
// bodies are dropped whole (their text is not page content), block-level close
// tags become line breaks so the markdown-ish answer stays readable, and only
// then are entities decoded — so an escaped `&lt;b&gt;` stays text, not a tag.
const toText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim(),
  );

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// Reads a body of at most MAX_BODY_BYTES, aborting the stream the instant the
// cap is passed: a huge (or Content-Length-lying) upstream is never buffered
// whole. The Content-Length fast path in the route catches the honest case.
const readCapped = async (
  res: globalThis.Response,
): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> => {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    return Buffer.byteLength(text) > MAX_BODY_BYTES ? { tooLarge: true } : { tooLarge: false, text };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { tooLarge: false, text };
  } finally {
    reader.releaseLock?.();
  }
};

export function mountFetchRoutes(app: Express, options: FetchRouteOptions): void {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
  const fetchFn = options.fetchFn ?? fetch;
  const { dnsLookup } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = createLimiter({ ratePerMin: RATE_PER_MIN, burst: 10 });
  const allowed = new Set(options.trustedOrigins);

  const corsFor = (req: Request, res: Response): boolean => {
    if (!isTrustedRequest(req.headers, allowed)) return false;
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    return true;
  };

  app.options('/api/fetch', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(204).end();
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  });

  app.post('/api/fetch', async (req, res) => {
    if (!corsFor(req, res)) {
      res.status(403).json({ error: 'untrusted origin' });
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const limited = limiter.check(ip);
    if (!limited.ok) {
      res.setHeader('Retry-After', String(limited.retryAfterSec));
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    const { url, format } = req.body ?? {};
    if (typeof url !== 'string' || !isHttpUrl(url)) {
      res.status(400).json({ error: 'fetch: url must be an http(s) URL', name: 'ValidationError' });
      return;
    }
    if (format !== undefined && format !== 'markdown' && format !== 'text') {
      res.status(400).json({ error: 'fetch: format must be markdown or text', name: 'ValidationError' });
      return;
    }

    // Per-hop private-address refusal: a permitted public name can still point
    // at a private address, and a public redirect can lead there.
    const refused = (err: unknown): boolean => {
      if (!(err instanceof RelayRefusal)) throw err;
      if (err.status === 400) {
        res.status(400).json({ error: 'fetch: refused a private address', name: 'BlockedHostError' });
      } else {
        res.status(502).json({ error: 'fetch: upstream unreachable', name: 'FetchError' });
      }
      return true;
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let currentUrl = url;
    let follows = 0;
    let upstreamRes!: globalThis.Response;
    try {
      try {
        await assertPublicUpstream(url, dnsLookup);
      } catch (err) {
        if (refused(err)) return;
      }
      for (;;) {
        try {
          upstreamRes = await fetchFn(currentUrl, { redirect: 'manual', signal: controller.signal });
        } catch {
          res.status(502).json({ error: 'fetch: upstream unreachable', name: 'FetchError' });
          return;
        }
        if (upstreamRes.status < 300 || upstreamRes.status >= 400) break;
        if (follows >= MAX_REDIRECTS) {
          res.status(502).json({ error: 'fetch: too many redirects', name: 'FetchError' });
          return;
        }
        const location = upstreamRes.headers.get('location');
        let next: URL;
        try {
          next = new URL(location ?? '', currentUrl);
        } catch {
          res.status(502).json({ error: 'fetch: bad redirect target', name: 'FetchError' });
          return;
        }
        if (!isHttpUrl(next.href)) {
          res.status(400).json({ error: 'fetch: redirect must stay http(s)', name: 'ValidationError' });
          return;
        }
        try {
          await assertPublicUpstream(next.href, dnsLookup);
        } catch (err) {
          if (refused(err)) return;
        }
        currentUrl = next.href;
        follows += 1;
      }

      if (!upstreamRes.ok) {
        res.status(502).json({ error: 'fetch: upstream answered an error', name: 'FetchError' });
        return;
      }
      const declaredLength = Number(upstreamRes.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        res.status(413).json({ error: 'fetch: response too large', name: 'TooLargeError' });
        return;
      }
      let read: { tooLarge: true } | { tooLarge: false; text: string };
      try {
        read = await readCapped(upstreamRes);
      } catch {
        res.status(502).json({ error: 'fetch: upstream body unreadable', name: 'FetchError' });
        return;
      }
      if (read.tooLarge) {
        res.status(413).json({ error: 'fetch: response too large', name: 'TooLargeError' });
        return;
      }
      const body = read.text;
      const bytes = Buffer.byteLength(body);
      const escaped = escapeFences(toText(body));
      const content = escaped.slice(0, MAX_CONTENT_CHARS);
      logger({ fetch: 'upstream', status: upstreamRes.status, bytes });
      res.status(200).json({
        ok: true,
        title: titleOf(body),
        finalUrl: withoutQuery(currentUrl),
        content,
        truncated: escaped.length > MAX_CONTENT_CHARS,
      });
    } finally {
      clearTimeout(timer);
    }
  });
}
