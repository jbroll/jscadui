import { describe, expect, it } from 'vitest'
import { EMPTY_REPLY, runSession } from './session.js'

const call = { ms: 1, inputTokens: 2, outputTokens: 3 }
const scenario = { name: 'jeep-1-10', prompt: 'make a jeep', persona: 'hobbyist', facts: ['about 340 mm long'] }

function fakeDriver(over = {}) {
  const calls = { send: [], stop: 0, view: [] }
  let turn = 0
  const driver = {
    calls,
    async send(text) {
      calls.send.push(text)
    },
    async waitTurn() {
      turn++
      return { timedOut: false }
    },
    async stop() {
      calls.stop++
    },
    async lastAssistantText() {
      return `reply ${turn}`
    },
    async view(spec) {
      calls.view.push(spec)
      return { ok: true, shots: spec.views.map((v) => ({ image: { dataUrl: `data:${v.preset}#${turn}`, mime: 'image/png' }, camera: {} })) }
    },
    async measure() {
      return { ok: true, size: [340, 150, 180] }
    },
    async check() {
      return { ok: true, solids: [] }
    },
    async buildReport() {
      return { ok: true }
    },
  }
  return Object.assign(driver, over)
}

function fakeSimUser({ accept = () => false, answer = 'about 340 mm', critiqueText = 'make it longer' } = {}) {
  const calls = { answer: [], critique: [] }
  return {
    calls,
    async answer(question, history) {
      calls.answer.push({ question, history: [...history] })
      return { text: answer, call }
    },
    async critique(args) {
      calls.critique.push({ ...args, history: [...args.history] })
      const accepted = accept(calls.critique.length)
      return { accepted, text: accepted ? null : critiqueText, call }
    },
  }
}

describe('runSession', () => {
  it('accepts after the first turn', async () => {
    const driver = fakeDriver()
    const simUser = fakeSimUser({ accept: () => true })
    const r = await runSession({ driver, scenario, simUser })
    expect(r).toMatchObject({ userTurns: 1, accepted: true, timedOut: false, error: null, checks: null })
    expect(driver.calls.send).toEqual(['make a jeep'])
    expect(r.simUserCalls).toEqual([call])
    expect(driver.calls.view[0]).toEqual({ views: [{ preset: 'iso-front' }, { preset: 'iso-back' }, { preset: 'top' }] })
    expect(r.views.map((v) => [v.turn, v.name])).toEqual([[1, 'iso-front'], [1, 'iso-back'], [1, 'top']])
    expect(simUser.calls.critique[0]).toMatchObject({
      finalText: 'reply 1',
      report: { ok: true },
      images: ['data:iso-front#1', 'data:iso-back#1', 'data:top#1'],
    })
  })

  it('stops at three user turns', async () => {
    const driver = fakeDriver()
    const simUser = fakeSimUser()
    const r = await runSession({ driver, scenario, simUser })
    expect(r).toMatchObject({ userTurns: 3, accepted: false, error: null })
    expect(driver.calls.send).toEqual(['make a jeep', 'make it longer', 'make it longer'])
    expect(simUser.calls.critique).toHaveLength(3)
  })

  it('answers a question through the sim user', async () => {
    let resolved
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        resolved = await onQuestion('How long?')
        return { timedOut: false }
      },
    })
    const simUser = fakeSimUser({ accept: () => true })
    const r = await runSession({ driver, scenario, simUser })
    expect(simUser.calls.answer).toEqual([{ question: 'How long?', history: [{ role: 'user', text: 'make a jeep' }] }])
    expect(resolved).toBe('about 340 mm')
    expect(r.simUserCalls).toEqual([call, call])
  })

  it('passes the conversation as the user saw it', async () => {
    let turn = 0
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        turn++
        if (turn === 1) await onQuestion('How long?')
        return { timedOut: false }
      },
      async lastAssistantText() {
        return `reply ${turn}`
      },
    })
    const simUser = fakeSimUser({ accept: (n) => n === 2 })
    await runSession({ driver, scenario, simUser })
    expect(simUser.calls.critique[1].history).toEqual([
      { role: 'user', text: 'make a jeep' },
      { role: 'question', text: 'How long?' },
      { role: 'user', text: 'about 340 mm' },
      { role: 'assistant', text: 'reply 1' },
      { role: 'user', text: 'make it longer' },
    ])
    expect(simUser.calls.critique[1].finalText).toBe('reply 2')
  })

  it('a timed-out turn stops and ends the session', async () => {
    const driver = fakeDriver({
      async waitTurn() {
        return { timedOut: true }
      },
    })
    const simUser = fakeSimUser()
    const r = await runSession({ driver, scenario, simUser, turnTimeoutMs: 5 })
    expect(driver.calls.stop).toBe(1)
    expect(r).toMatchObject({ timedOut: true, accepted: false, userTurns: 1, error: null })
    expect(simUser.calls.critique).toHaveLength(0)
  })

  it('passes turnTimeoutMs to waitTurn', async () => {
    const seen = []
    const driver = fakeDriver({
      async waitTurn(opts) {
        seen.push(opts.timeoutMs)
        return { timedOut: false }
      },
    })
    await runSession({ driver, scenario, simUser: fakeSimUser({ accept: () => true }), turnTimeoutMs: 600000 })
    expect(seen).toEqual([600000])
  })

  it('a sim-user error ends the session with error, never throws', async () => {
    const driver = fakeDriver()
    const simUser = Object.assign(fakeSimUser(), {
      async critique() {
        throw new Error('go 429')
      },
    })
    const r = await runSession({ driver, scenario, simUser })
    expect(r).toMatchObject({ error: 'go 429', accepted: false, userTurns: 1 })
    expect(driver.calls.send).toHaveLength(1)
  })

  it('a sim-user error inside a question wins over the driver error it causes', async () => {
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        try {
          await onQuestion('How long?')
        } catch {
          throw new Error('question box never closed')
        }
        return { timedOut: false }
      },
    })
    const simUser = Object.assign(fakeSimUser(), {
      async answer() {
        throw new Error('go 503')
      },
    })
    const r = await runSession({ driver, scenario, simUser })
    expect(r.error).toBe('go 503')
    expect(driver.calls.stop).toBe(1)
  })

  it('a sim-user error inside a question ends the session even when the driver swallows it', async () => {
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        await onQuestion('How long?').catch(() => {})
        return { timedOut: false }
      },
    })
    const simUser = Object.assign(fakeSimUser(), {
      async answer() {
        throw new Error('go 503')
      },
    })
    const r = await runSession({ driver, scenario, simUser })
    expect(r.error).toBe('go 503')
    expect(simUser.calls.critique).toHaveLength(0)
    expect(driver.calls.stop).toBe(1)
  })

  it('a swallowed question failure on a timed-out turn records the timeout and stops', async () => {
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        await onQuestion('How long?').catch(() => {})
        return { timedOut: true }
      },
    })
    const simUser = Object.assign(fakeSimUser(), {
      async answer() {
        throw new Error('go 503')
      },
    })
    const r = await runSession({ driver, scenario, simUser })
    expect(r).toMatchObject({ error: 'go 503', timedOut: true })
    expect(driver.calls.stop).toBe(1)
  })

  it('a waitTurn rejection stops the turn and keeps the waitTurn error when stop fails', async () => {
    const driver = fakeDriver({
      async waitTurn() {
        throw new Error('page closed')
      },
      async stop() {
        driver.calls.stop++
        throw new Error('stop failed')
      },
    })
    const r = await runSession({ driver, scenario, simUser: fakeSimUser() })
    expect(r.error).toBe('page closed')
    expect(driver.calls.stop).toBe(1)
  })

  it('a driver error outside waitTurn does not stop the turn', async () => {
    const driver = fakeDriver({
      async buildReport() {
        throw new Error('page crashed')
      },
    })
    await runSession({ driver, scenario, simUser: fakeSimUser() })
    expect(driver.calls.stop).toBe(0)
  })

  it('a driver error ends the session with error', async () => {
    const driver = fakeDriver({
      async buildReport() {
        throw new Error('page crashed')
      },
    })
    const r = await runSession({ driver, scenario, simUser: fakeSimUser() })
    expect(r).toMatchObject({ error: 'page crashed', userTurns: 1, checks: null })
  })

  it('an empty answer is a session error and is never sent', async () => {
    let resolved = 'unset'
    const driver = fakeDriver({
      async waitTurn({ onQuestion }) {
        resolved = await onQuestion('How long?').catch(() => 'rejected')
        return { timedOut: false }
      },
    })
    const r = await runSession({ driver, scenario, simUser: fakeSimUser({ answer: '  ' }) })
    expect(EMPTY_REPLY).toBe('simulated user returned an empty reply')
    expect(r.error).toBe(EMPTY_REPLY)
    expect(resolved).toBe('rejected')
    expect(driver.calls.send).toEqual(['make a jeep'])
  })

  it('an empty critique is a session error and is never sent', async () => {
    const driver = fakeDriver()
    const r = await runSession({ driver, scenario, simUser: fakeSimUser({ critiqueText: '\n ' }) })
    expect(r.error).toBe(EMPTY_REPLY)
    expect(driver.calls.send).toEqual(['make a jeep'])
  })

  it('no geometry critiques without images and records noGeometry', async () => {
    const driver = fakeDriver({
      async view() {
        throw Object.assign(new Error('NoGeometryError: no geometry to render'), { name: 'NoGeometryError' })
      },
      async measure() {
        return { ok: false, error: 'no geometry' }
      },
    })
    const simUser = fakeSimUser({ accept: () => true })
    const r = await runSession({ driver, scenario: { ...scenario, checks: () => [] }, simUser })
    expect(simUser.calls.critique[0].images).toEqual([])
    expect(r.views).toEqual([])
    expect(r.error).toBe(null)
    expect(r.checks).toEqual({ passed: 0, total: null, failed: [], noGeometry: true })
  })

  it('a measure rejection records noGeometry', async () => {
    const driver = fakeDriver({
      async measure() {
        throw new Error('worker gone')
      },
    })
    const r = await runSession({ driver, scenario: { ...scenario, checks: () => [] }, simUser: fakeSimUser({ accept: () => true }) })
    expect(r.checks).toEqual({ passed: 0, total: null, failed: [], noGeometry: true })
    expect(r.error).toBe(null)
  })

  it('runs scenario checks on the final build', async () => {
    const seen = []
    const checks = (m, ctx) => {
      seen.push([m, ctx])
      return [{ pass: true, name: 'built' }, { pass: false, name: 'long' }]
    }
    const r = await runSession({ driver: fakeDriver(), scenario: { ...scenario, checks }, simUser: fakeSimUser({ accept: () => true }) })
    expect(r.checks).toEqual({ passed: 1, total: 2, failed: ['long'] })
    expect(seen).toEqual([[{ ok: true, size: [340, 150, 180] }, { solid: { ok: true, solids: [] } }]])
  })

  it('runs checks after a timed-out turn', async () => {
    const driver = fakeDriver({
      async waitTurn() {
        return { timedOut: true }
      },
    })
    const r = await runSession({ driver, scenario: { ...scenario, checks: () => [{ pass: true }] }, simUser: fakeSimUser() })
    expect(r.checks).toEqual({ passed: 1, total: 1, failed: [] })
  })

  it('a check rejection passes solid as null', async () => {
    const seen = []
    const driver = fakeDriver({
      async check() {
        throw new Error('check failed')
      },
    })
    const checks = (m, { solid }) => {
      seen.push(solid)
      return [{ pass: true }]
    }
    const r = await runSession({ driver, scenario: { ...scenario, checks }, simUser: fakeSimUser({ accept: () => true }) })
    expect(seen).toEqual([null])
    expect(r.error).toBe(null)
  })
})
