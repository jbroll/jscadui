import type { Express, Request, Response } from 'express';
import { RATE_PER_MIN, createLimiter, isTrustedRequest } from '../relay/policy.js';

// Tavily answers no CORS preflight, so browsers can only reach it through
// this route. The operator's key rides the server-to-Tavily call only: it is
// never logged, never echoed, and never leaves this module's closure.
const TAVILY_MCP = 'https://mcp.tavily.com/mcp/';
const SNIPPET_MAX_CHARS = 500;

interface TavilyMcpBody {
  result?: { results?: Array<{ title?: unknown; url?: unknown; snippet?: unknown }> };
  error?: unknown;
}

export interface SearchRouteOptions {
  tavilyKey?: string;
  trustedOrigins: string[];
  logger?: (entry: Record<string, unknown>) => void;
  fetchFn?: typeof fetch;
}

const capSnippet = (snippet: unknown): string =>
  String(snippet ?? '')
    .split('```')
    .join('``\u200b`')
    .slice(0, SNIPPET_MAX_CHARS);

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
    const key = options.tavilyKey;
    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetchFn(`${TAVILY_MCP}?tavilyApiKey=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'jscadui-search-relay',
          method: 'tools/call',
          params: { name: 'tavily-search', arguments: { query: query.trim(), count: count ?? 8 } },
        }),
      });
    } catch {
      res.status(502).json({ error: 'upstream unreachable' });
      return;
    }
    let body: TavilyMcpBody | null = null;
    try {
      body = (await upstreamRes.json()) as TavilyMcpBody;
    } catch {
      res.status(502).json({ error: 'upstream answered without JSON' });
      return;
    }
    if (!upstreamRes.ok || body?.error || !Array.isArray(body?.result?.results)) {
      logger({ search: 'tavily', status: upstreamRes.status });
      res.status(502).json({ error: 'search: provider failed' });
      return;
    }
    const results = body.result.results.map((hit) => ({
      title: String(hit?.title ?? ''),
      url: String(hit?.url ?? ''),
      snippet: capSnippet(hit?.snippet),
      provider: 'tavily',
    }));
    logger({ search: 'tavily', status: upstreamRes.status, count: results.length });
    res.status(200).json({ ok: true, results });
  });
}
