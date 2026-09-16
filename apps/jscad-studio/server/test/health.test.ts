import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type StudioServer, type ServerConfig } from '../src/index.js';
import { configFromEnv } from '../src/config.js';

const AUTH_SECRET = 'test-secret-test-secret-test-secret';
const DATABASE_ID = 'db_test_tenant';

function testConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    frontendUrl: 'http://localhost:5120',
    authSecret: AUTH_SECRET,
    trustedOrigins: ['http://localhost:5120'],
    providers: [],
    rowboatDatabaseId: DATABASE_ID,
    rowboatUrl: 'http://rowboat.test',
  };
}

let server: StudioServer | undefined;

afterEach(() => {
  server?.db.close();
  server = undefined;
});

describe('health', () => {
  it('answers 200 with the { status, timestamp } shape', async () => {
    server = await createServer(testConfig());

    const res = await request(server.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });
});

describe('CORS allow-list', () => {
  it('echoes an allow-listed origin with credentials', async () => {
    server = await createServer(testConfig());

    const res = await request(server.app).get('/api/health').set('Origin', 'http://localhost:5120');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5120');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sets no Access-Control-Allow-Origin for a non-allow-listed origin', async () => {
    server = await createServer(testConfig());

    const res = await request(server.app).get('/api/health').set('Origin', 'https://evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('configFromEnv', () => {
  it('throws naming ROWBOAT_DATABASE_ID when it is absent', () => {
    const hadDatabaseId = process.env.ROWBOAT_DATABASE_ID;
    const hadUrl = process.env.ROWBOAT_URL;
    delete process.env.ROWBOAT_DATABASE_ID;
    delete process.env.ROWBOAT_URL;
    try {
      expect(() => configFromEnv()).toThrow(/ROWBOAT_DATABASE_ID/);
    } finally {
      if (hadDatabaseId) process.env.ROWBOAT_DATABASE_ID = hadDatabaseId;
      if (hadUrl) process.env.ROWBOAT_URL = hadUrl;
    }
  });

  it('throws naming ROWBOAT_URL when it is absent', () => {
    const hadDatabaseId = process.env.ROWBOAT_DATABASE_ID;
    const hadUrl = process.env.ROWBOAT_URL;
    process.env.ROWBOAT_DATABASE_ID = DATABASE_ID;
    delete process.env.ROWBOAT_URL;
    try {
      expect(() => configFromEnv()).toThrow(/ROWBOAT_URL/);
    } finally {
      if (hadDatabaseId) process.env.ROWBOAT_DATABASE_ID = hadDatabaseId;
      else delete process.env.ROWBOAT_DATABASE_ID;
      if (hadUrl) process.env.ROWBOAT_URL = hadUrl;
    }
  });
});