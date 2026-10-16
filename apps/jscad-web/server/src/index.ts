import { realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { remoteGroupBackend } from '@jbroll/rowboat-auth';
import { createIdentity, type Identity } from '@jbroll/rowboat-auth-betterauth';
import Database from 'better-sqlite3';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { mountRelayRoutes } from './relay/routes.js';
import { mountSearchRoutes } from './search/routes.js';
import { mountFetchRoutes } from './fetch/routes.js';
import { configFromEnv, type ServerConfig } from './config.js';

export type { ServerConfig } from './config.js';

// Minimal allow-list CORS middleware — replaces the `cors` package with the same trusted-origin
// behaviour, without pulling in an extra dependency. Only allow-listed origins are echoed.
function corsMiddleware(trustedOrigins: string[]) {
  const allowed = new Set(trustedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ?? 'Content-Type,Authorization',
      );
      res.status(204).end();
      return;
    }
    next();
  };
}

export interface AppServer {
  app: Express;
  db: Database.Database;
  signJWT: Identity['signJWT'];
  start(): Server;
}

// Stands up the express app on ONE better-sqlite3 db: better-auth identity plus the health route
// the deploy checks. No cookie domain is set anywhere — the session cookie must stay host-only on
// jscad.rkroll.com, never .rkroll.com.
export async function createServer(config: ServerConfig): Promise<AppServer> {
  const db = new Database(config.dbPath);

  const identity = createIdentity({
    db,
    authSecret: config.authSecret,
    baseUrl: `${config.frontendUrl}/api/auth`,
    // Short-lived per-user tokens for the hosted-rowboat data plane. iss/aud must match what
    // provisioning registered for this database, or every sync 401s with no other symptom.
    jwt: {
      issuer: `${config.frontendUrl}/api/auth`,
      audience: config.rowboatDatabaseId,
      expirationTime: '15m',
    },
    // Root groups are provisioned lazily by hosted rowboat on a user's first verified sync — this
    // backend has no group tables, so the local user.create.after provisioning hook must not run.
    provisionRootGroup: false,
    providers: config.providers,
  });
  await identity.registerIdentityTables();

  const app = express();
  // Apache is the only hop in front of this app. Express then takes the address
  // Apache appended, not the leftmost X-Forwarded-For entry a client can forge.
  app.set('trust proxy', 'loopback');
  app.use(corsMiddleware(config.trustedOrigins));

  // Group reads/writes go to hosted rowboat, authenticated AS THE ACTING USER. The app does not
  // share anything yet, but mountAuthRoutes requires the backend for its account-merge routes.
  const groupBackend = remoteGroupBackend({
    baseUrl: `${config.rowboatUrl}/db/${config.rowboatDatabaseId}/api/sync`,
    token: (actor) => identity.signJWT(actor),
  });

  // better-auth reads the raw request body — must mount before express.json(). mountAuthRoutes also
  // mounts the account delete + merge routes; merge's group link/grant ride this same groupBackend.
  identity.mountAuthRoutes(app, { groupBackend });

  app.use(express.json());

  // Short-lived data-plane JWT for browser rowboat sync. Same token shape as
  // the group backend's: the rowboat audience in config binds it to one tenant.
  // syncBase rides along so the browser needs no build-time rowboat address.
  app.get('/api/sync-token', async (req, res) => {
    const author = await identity.provider.resolveAuthor(req)
    if (!author) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    res.json({
      token: await identity.signJWT(author),
      syncBase: `${config.rowboatUrl}/db/${config.rowboatDatabaseId}/api/sync`,
    })
  });

  // CORS passthrough to provider APIs for the browser-local loop. No session,
  // no storage; the caller's provider key rides the request through.
  mountRelayRoutes(app, { allowlistPath: config.relayAllowlistPath, inferencePath: config.relaySharedPath, trustedOrigins: config.trustedOrigins });

  // Tavily answers no CORS preflight, so browsers reach it only through here.
  // The operator key is optional: without it the route answers 503 and the
  // page falls back to the keyless direct pool.
  mountSearchRoutes(app, { tavilyKey: process.env.JSCADUI_TAVILY_API_KEY, trustedOrigins: config.trustedOrigins });

  // The browser cannot read an arbitrary cross-origin page, so a URL already in
  // the conversation reaches it only through this relay: http(s) only, a bounded
  // redirect chain re-checked per hop, a bounded body and a capped answer.
  mountFetchRoutes(app, { trustedOrigins: config.trustedOrigins });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return {
    app,
    db,
    signJWT: identity.signJWT,
    start: () =>
      app.listen(config.port, config.host, () => {
        console.log(`[server] listening on ${config.host}:${config.port}`);
      }),
  };
}

// Only run as the process entrypoint (`node dist/index.js` / `tsx watch src/index.ts`) — importing
// this module (e.g. from health.test.ts) must not also open the production db or bind the port.
// realpath so a symlinked invocation still matches import.meta.url, which reports the resolved path.
const isMainModule = (argv1: string | undefined, moduleUrl: string): boolean => {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
};
if (isMainModule(process.argv[1], import.meta.url)) {
  const server = await createServer(configFromEnv());
  server.start();
}
