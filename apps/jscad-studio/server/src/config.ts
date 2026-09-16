import type { OAuthProviderConfig } from '@jbroll/rowboat-auth-betterauth';

export interface ServerConfig {
  port: number;
  /** Listen address; `::` binds every interface. */
  host: string;
  dbPath: string;
  frontendUrl: string;
  authSecret: string;
  trustedOrigins: string[];
  providers: OAuthProviderConfig[];
  /** The provisioned rowboat `databaseId` — the audience every data-plane JWT is bound to. */
  rowboatDatabaseId: string;
  /** Origin of the hosted rowboat that serves this tenant's data plane and group API. */
  rowboatUrl: string;
  /** GitHub App for connected-repository storage; absent until the app is installed. */
  githubAppId?: string;
  githubAppPrivateKey?: string;
  githubAppSlug?: string;
}

export function configFromEnv(): ServerConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5120';

  const providers: OAuthProviderConfig[] = [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          {
            name: 'google',
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            scopes: ['openid', 'email'],
            options: { prompt: 'select_account', disableDefaultScopes: true },
          },
        ]
      : []),
    ...(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET
      ? [
          {
            name: 'apple',
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: process.env.APPLE_CLIENT_SECRET,
            scopes: ['name', 'email'],
          },
        ]
      : []),
  ];

  // No default: an unset id would mint tokens with an audience rowboat rejects, surfacing only as
  // a blanket 401 on every sync. Fail at boot instead. Lives here, not in createServer, so tests
  // that build their own ServerConfig stay independent of the process environment.
  const rowboatDatabaseId = process.env.ROWBOAT_DATABASE_ID;
  if (!rowboatDatabaseId) {
    throw new Error('ROWBOAT_DATABASE_ID is required (see rowboat-tenant.<env>.json)');
  }

  const rowboatUrl = process.env.ROWBOAT_URL;
  if (!rowboatUrl) {
    throw new Error(
      'ROWBOAT_URL is required (the hosted rowboat origin, e.g. http://localhost:3020)',
    );
  }

  return {
    port: Number(process.env.PORT) || 3001,
    host: process.env.BIND_HOST || '::',
    dbPath: process.env.AUTH_DB_PATH || (isProd ? './data/auth.db' : './auth.db'),
    frontendUrl,
    authSecret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
    trustedOrigins: [
      'http://localhost:5120',
      'https://jscad-studio.rkroll.com',
      'https://appleid.apple.com',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    ],
    providers,
    rowboatDatabaseId,
    rowboatUrl,
    ...(process.env.GITHUB_APP_ID ? { githubAppId: process.env.GITHUB_APP_ID } : {}),
    // Private keys travel with literal \n in env files; restore real newlines.
    ...(process.env.GITHUB_APP_PRIVATE_KEY
      ? { githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n') }
      : {}),
    ...(process.env.GITHUB_APP_SLUG ? { githubAppSlug: process.env.GITHUB_APP_SLUG } : {}),
  };
}
