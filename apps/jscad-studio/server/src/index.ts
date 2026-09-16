import type { Server } from 'node:http';
import { remoteGroupBackend } from '@jbroll/rowboat-auth';
import { createIdentity, type Identity } from '@jbroll/rowboat-auth-betterauth';
import Database from 'better-sqlite3';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { mountAgentRoutes } from './agent/routes.js';
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

export interface StudioServer {
  app: Express;
  db: Database.Database;
  signJWT: Identity['signJWT'];
  start(): Server;
}

// Stands up the express app on ONE better-sqlite3 db: better-auth identity plus the health route
// the deploy checks. No cookie domain is set anywhere — the session cookie must stay host-only on
// jscad-studio.rkroll.com, never .rkroll.com, so it is not sent to the run host.
export async function createServer(config: ServerConfig): Promise<StudioServer> {
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
  app.set('trust proxy', true);
  app.use(corsMiddleware(config.trustedOrigins));

  // Group reads/writes go to hosted rowboat, authenticated AS THE ACTING USER. The studio does not
  // share anything yet, but mountAuthRoutes requires the backend for its account-merge routes.
  const groupBackend = remoteGroupBackend({
    baseUrl: `${config.rowboatUrl}/db/${config.rowboatDatabaseId}/api/sync`,
    token: (actor) => identity.signJWT(actor),
  });

  // better-auth reads the raw request body — must mount before express.json(). mountAuthRoutes also
  // mounts the account delete + merge routes; merge's group link/grant ride this same groupBackend.
  identity.mountAuthRoutes(app, { groupBackend });

  app.use(express.json());

  mountAgentRoutes(app);

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
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const server = await createServer(configFromEnv());
  server.start();
}
