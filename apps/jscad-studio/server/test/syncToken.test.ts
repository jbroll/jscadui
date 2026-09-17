import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type ServerConfig, type StudioServer } from '../src/index.js'

const AUTH_SECRET = 'test-secret-test-secret-test-secret'

function testConfig(): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: ':memory:',
    frontendUrl: 'http://localhost:5120',
    authSecret: AUTH_SECRET,
    trustedOrigins: ['http://localhost:5120'],
    providers: [],
    rowboatDatabaseId: 'db_test_tenant',
    rowboatUrl: 'http://rowboat.test',
    relayAllowlistPath: '/nonexistent-providers.json',
  }
}

let server: StudioServer | undefined

afterEach(() => {
  server?.db.close()
  server = undefined
})

describe('sync token', () => {
  it('401s without a session', async () => {
    server = await createServer(testConfig())
    const res = await request(server.app).get('/api/sync-token')
    expect(res.status).toBe(401)
  })

  it('mints a three-part JWT for the session user', async () => {
    // The server offers OAuth sign-in only, so the test seeds a session row
    // directly and signs the session cookie the way better-call does
    // (HMAC-SHA-256 `value.signature`, URI-encoded).
    server = await createServer(testConfig())
    const now = new Date()
    server.db
      .prepare('INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('u1', 'Sync', 'sync@test.com', 0, null, now.toISOString(), now.toISOString())
    server.db
      .prepare('INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('s1', new Date(Date.now() + 3600e3).toISOString(), 'tok123', now.toISOString(), now.toISOString(), null, null, 'u1')
    const signature = createHmac('sha256', AUTH_SECRET).update('tok123').digest('base64')
    const cookie = `better-auth.session_token=${encodeURIComponent(`tok123.${signature}`)}`
    const res = await request(server.app).get('/api/sync-token').set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.body.token.split('.')).toHaveLength(3)
  })
})
