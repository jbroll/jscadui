import type { LookupFunction } from 'node:net';
import type { Express, Request, Response } from 'express';
import { Agent, fetch as undiciFetch } from 'undici';
import { RATE_PER_MIN, createLimiter, isTrustedRequest, publicOnlyLookup } from '../relay/policy.js';
import { fetchPage } from './fetchPage.js';

// Nothing about the operator's session leaves this module's closure: the page
// fetch itself (fetchPage.js) sees only the URL and format.

export { MAX_BODY_BYTES, MAX_CONTENT_CHARS, MAX_REDIRECTS } from './fetchPage.js';

export interface FetchRouteOptions {
  trustedOrigins: string[];
  logger?: (entry: Record<string, unknown>) => void;
  fetchFn?: typeof fetch;
  /** DNS seam: defaults to `node:dns` lookup; tests inject fakes. */
  dnsLookup?: (host: string) => Promise<Array<{ address: string }>>;
  timeoutMs?: number;
}

export interface FetchRoutesHandle {
  /** Close the public-only dispatcher; call this on server shutdown. */
  close(): Promise<void>;
}

export function mountFetchRoutes(app: Express, options: FetchRouteOptions): FetchRoutesHandle {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
  const { dnsLookup, timeoutMs } = options;
  // The origin check in fetchPage resolves the name first; the connection then
  // resolves it again. This dispatcher makes the address the socket actually
  // connects to the checked one, so a DNS answer that flips public→private
  // between the two cannot reach the server's own network. An injected fetchFn
  // (tests, the local launcher) owns its connections, so no agent is built.
  const dispatcher = options.fetchFn ? undefined : new Agent({ connect: { lookup: publicOnlyLookup(dnsLookup) as unknown as LookupFunction } });
  const publicOnlyFetch = ((url: string, init?: Parameters<typeof undiciFetch>[1]) =>
    undiciFetch(url, { ...init, dispatcher })) as typeof fetch;
  const fetchFn = options.fetchFn ?? publicOnlyFetch;
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
    const { status, body } = await fetchPage({ url, format, fetchFn, dnsLookup, timeoutMs, logger });
    res.status(status).json(body);
  });

  return {
    close: async () => {
      await dispatcher?.close();
    },
  };
}
