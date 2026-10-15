import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { costUsd, createMeter, estimateTokens, ipGroup, parseUsage } from '../src/relay/meter.js'
import { mountRelayRoutes } from '../src/relay/routes.js'

const NOW = Date.parse('2026-10-15T18:00:00Z')
const budgets = { monthlyUsd: 5, perIpDailyUsd: 0.1 }
const tmp = () => mkdtempSync(join(tmpdir(), 'meter-'))
const meterAt = (now: () => number, statePath = join(tmp(), 'relay-spend.json')) => createMeter({ statePath, now })

describe('meter parsing', () => {
  it('reads usage from a chat-completions stream', () => {
    const text =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
      'data: [DONE]\n\n'
    expect(parseUsage(text)).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('reads usage from a responses stream', () => {
    const text = 'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":7}}}\n\n'
    expect(parseUsage(text)).toEqual({ inputTokens: 3, outputTokens: 7 })
  })

  it('returns null when no usage appears', () => {
    expect(parseUsage('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')).toBeNull()
  })

  it('estimates one token per three bytes', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(1)).toBe(1)
    expect(estimateTokens(3)).toBe(1)
    expect(estimateTokens(4)).toBe(2)
  })

  it('prices input and output at the per-million rates', () => {
    expect(costUsd({ inputTokens: 10, outputTokens: 5 }, { inputUsdPerMTok: 1, outputUsdPerMTok: 2 })).toBeCloseTo(20 / 1e6, 12)
  })
})

describe('IP grouping', () => {
  it('keys IPv4 by the whole address, including the IPv4-mapped form', () => {
    expect(ipGroup('203.0.113.7')).toBe('203.0.113.7')
    expect(ipGroup('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('keys IPv6 by its /64 prefix', () => {
    expect(ipGroup('2001:db8:1:2::1')).toBe(ipGroup('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))
    expect(ipGroup('2001:db8:1:2::1')).not.toBe(ipGroup('2001:db8:1:3::1'))
  })
})

describe('meter budgets', () => {
  it('refuses a spent month with scope month', () => {
    const meter = meterAt(() => NOW)
    meter.charge('1.2.3.4', 5)
    expect(meter.check('1.2.3.4', budgets)).toEqual({ ok: false, scope: 'month' })
  })

  it('refuses a spent IP group with scope day, sharing the /64', () => {
    const meter = meterAt(() => NOW)
    meter.charge('2001:db8:1:2::1', 0.2)
    expect(meter.check('2001:db8:1:2:ffff::9', budgets)).toEqual({ ok: false, scope: 'day' })
    expect(meter.check('2001:db8:1:3::1', budgets)).toEqual({ ok: true })
  })

  it('rolls the day over and keeps the month', () => {
    let t = NOW
    const meter = meterAt(() => t)
    meter.charge('1.2.3.4', 4)
    expect(meter.monthSpent()).toBeCloseTo(4, 12)
    t += 24 * 60 * 60 * 1000
    expect(meter.check('1.2.3.4', budgets)).toEqual({ ok: true })
    expect(meter.monthSpent()).toBeCloseTo(4, 12)
  })

  it('rolls the month over and clears both', () => {
    let t = NOW
    const meter = meterAt(() => t)
    meter.charge('1.2.3.4', 4)
    t = Date.parse('2026-11-02T00:00:00Z')
    expect(meter.monthSpent()).toBe(0)
    expect(meter.check('1.2.3.4', budgets)).toEqual({ ok: true })
  })

  it('reloads spend from the state file after a restart', () => {
    const dir = tmp()
    const statePath = join(dir, 'relay-spend.json')
    createMeter({ statePath, now: () => NOW }).charge('1.2.3.4', 3)
    const reloaded = createMeter({ statePath, now: () => NOW })
    expect(reloaded.monthSpent()).toBeCloseTo(3, 12)
    expect(JSON.parse(readFileSync(statePath, 'utf8')).monthSpent).toBeCloseTo(3, 12)
  })

  it('does not reset a spent day on reload', () => {
    const dir = tmp()
    const statePath = join(dir, 'relay-spend.json')
    createMeter({ statePath, now: () => NOW }).charge('203.0.113.7', 0.2)
    const reloaded = createMeter({ statePath, now: () => NOW })
    expect(reloaded.check('203.0.113.9', budgets)).toEqual({ ok: true })
    expect(reloaded.check('203.0.113.7', budgets)).toEqual({ ok: false, scope: 'day' })
  })

  it('writes the state file through a temp file then a rename', () => {
    const dir = tmp()
    const statePath = join(dir, 'relay-spend.json')
    createMeter({ statePath, now: () => NOW }).charge('1.2.3.4', 3)
    // No temp file survives a completed charge.
    expect(readdirSync(dir).sort()).toEqual(['relay-spend.json'])
  })
})

describe('shared 402 body', () => {
  const NOW_ISO = '2026-10-15T18:00:00.000Z'
  const config = JSON.stringify({
    monthlyUsd: 5,
    perIpDailyUsd: 0.1,
    providers: [
      { kind: 'opencode-go', key: 'sk', models: [{ id: 'deepseek', label: 'D', model: 'deepseek-v4.1-flash', maxTokens: 8, inputUsdPerMTok: 1, outputUsdPerMTok: 2 }] },
    ],
  })

  it('answers 402 with the shared_quota_exhausted body naming the scope', async () => {
    const dir = tmp()
    const allowlistPath = join(dir, 'providers.json')
    writeFileSync(allowlistPath, JSON.stringify({ 'opencode-go': 'https://upstream.test' }))
    const sharedPath = join(dir, 'shared.json')
    writeFileSync(sharedPath, config)
    const spendPath = join(dir, 'relay-spend.json')
    writeFileSync(spendPath, JSON.stringify({ month: '2026-10', monthSpent: 5, day: '2026-10-15', ipSpend: {} }))
    const fetchMock = vi.fn()
    const app = express()
    app.use(express.json())
    mountRelayRoutes(app, {
      allowlistPath,
      sharedPath,
      sharedSpendPath: spendPath,
      trustedOrigins: ['https://app.test'],
      logger: () => {},
      fetchFn: fetchMock,
      dnsLookup: async () => [{ address: '93.184.216.34' }],
      now: () => Date.parse(NOW_ISO),
      // Keep any log record out of the repo's ./data.
      chatLogDir: join(dir, 'chat-logs'),
    })
    const res = await request(app).post('/api/relay/shared/deepseek/v1/chat/completions').set('Origin', 'https://app.test').send({ messages: [] })
    expect(res.status).toBe(402)
    expect(res.body).toEqual({ error: { code: 'shared_quota_exhausted', scope: 'month', message: expect.any(String) } })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
