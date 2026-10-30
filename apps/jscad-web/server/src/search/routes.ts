import type { Express, Request, Response } from 'express';
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from '../relay/policy.js';
import { searchTavily } from './tavily.js';

// Tavily answers no CORS preflight, so browsers can only reach it through
// this route. The operator's key never leaves the server (see tavily.js).
export interface SearchRouteOptions {
  tavilyKey?: string;
  trustedOrigins: string[];
  logger?: (entry: Record<string, unknown>) => void;
  fetchFn?: typeof fetch;
}

export function mountSearchRoutes(app: Express, options: SearchRouteOptions): void {
  const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
  const fetchFn = options.fetchFn ?? fetch;
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

  app.options('/api/search', (req, res) => {
    if (!corsFor(req, res)) {
      res.status(204).end();
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  });

  app.post('/api/search', async (req, res) => {
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
    const { query, count } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim()) {
      res.status(400).json({ error: 'search: query must be a non-empty string' });
      return;
    }
    if (count !== undefined && !Number.isInteger(count)) {
      res.status(400).json({ error: 'search: count must be an integer' });
      return;
    }
    if (!options.tavilyKey) {
      res.status(503).json({ error: 'search: no provider key configured' });
      return;
    }
    const { status, body, upstream } = await searchTavily({
      tavilyKey: options.tavilyKey,
      query: query.trim(),
      count,
      fetchFn,
    });
    if (status === 200) logger({ search: 'tavily', status: upstream, count: (body.results as unknown[]).length });
    else if (upstream !== undefined) logger({ search: 'tavily', status: upstream });
    res.status(status).json(body);
  });
}
