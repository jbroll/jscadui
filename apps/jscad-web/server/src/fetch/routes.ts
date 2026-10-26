import type { Express, Request, Response } from 'express';
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from '../relay/policy.js';
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

export function mountFetchRoutes(app: Express, options: FetchRouteOptions): void {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
  const { fetchFn, dnsLookup, timeoutMs } = options;
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
}
