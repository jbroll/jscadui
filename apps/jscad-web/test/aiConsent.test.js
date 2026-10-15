// apps/jscad-web/test/aiConsent.test.js
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACKS,
  DEMO_NOTICE_MESSAGE,
  TOS_REQUIRED_MESSAGE,
  TOS_VERSION,
  acceptTos,
  checkTurn,
  consentRows,
  getRecordOwnChats,
  getTos,
  needsTos,
  openConsentGate,
  setRecordOwnChats,
} from '../src/aiConsent.js'
import { initChat } from '../src/aiChat.js'

const ownKey = () => ({ kind: 'openai', model: 'm', apiKey: 'k' })

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('consent storage', () => {
  it('starts unaccepted on a fresh install and blocks the first turn', () => {
    expect(TOS_VERSION).toBe(1)
    expect(getTos()).toBeNull()
    expect(needsTos()).toBe(true)
    expect(checkTurn(ownKey())).toEqual({ ok: false, reason: 'tos' })
    expect(getRecordOwnChats()).toBe(true)
  })

  it('accepting writes the versioned record and unblocks own-key turns', () => {
    acceptTos(true)
    expect(needsTos()).toBe(false)
    expect(getTos()).toMatchObject({ version: TOS_VERSION, recordOwnChats: true })
    expect(typeof getTos().at).toBe('number')
    expect(localStorage.getItem('jscad-ai.log')).toBeNull()
    expect(checkTurn(ownKey())).toEqual({ ok: true })
  })

  it('mirrors an opt-out into jscad-ai.log and still allows own-key turns', () => {
    acceptTos(false)
    expect(localStorage.getItem('jscad-ai.log')).toBe('off')
    expect(getRecordOwnChats()).toBe(false)
    expect(checkTurn(ownKey())).toEqual({ ok: true })
  })

  it('treats .tos as the source of truth when it disagrees with the log mirror', () => {
    localStorage.setItem('jscad-ai.log', 'off')
    acceptTos(true)
    expect(getRecordOwnChats()).toBe(true)

    window.localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 1, recordOwnChats: false }))
    window.localStorage.removeItem('jscad-ai.log')
    expect(getRecordOwnChats()).toBe(false)
  })

  it('honors the log mirror for a pre-TOS install and defaults to on with neither key', () => {
    localStorage.setItem('jscad-ai.log', 'off')
    expect(getRecordOwnChats()).toBe(false)
    localStorage.clear()
    expect(getRecordOwnChats()).toBe(true)
  })

  it('never accepts the terms when only the recording preference is set', () => {
    setRecordOwnChats(false)
    expect(localStorage.getItem('jscad-ai.log')).toBe('off')
    expect(getTos()).toBeNull()
    expect(needsTos()).toBe(true)
    setRecordOwnChats(true)
    expect(localStorage.getItem('jscad-ai.log')).toBeNull()
    expect(needsTos()).toBe(true)
  })

  it('keeps a corrupt record blocked instead of throwing', () => {
    localStorage.setItem('jscad-ai.tos', '{not json')
    expect(getTos()).toBeNull()
    expect(needsTos()).toBe(true)
    expect(checkTurn(ownKey())).toEqual({ ok: false, reason: 'tos' })
  })
})

describe('version bump', () => {
  beforeEach(() => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION - 1, at: 123, recordOwnChats: false }))
    localStorage.setItem('jscad-ai.log', 'off')
  })

  it('re-blocks every turn until the new version is accepted', () => {
    expect(needsTos()).toBe(true)
    expect(checkTurn(ownKey())).toEqual({ ok: false, reason: 'tos' })
  })

  it('pre-checks the prior recording choice as the default', () => {
    expect(getRecordOwnChats()).toBe(false)
    const recording = consentRows(ownKey()).find((row) => row.key === 'recordOwnChats')
    expect(recording).toMatchObject({ checked: false, locked: false })
    acceptTos(false)
    expect(needsTos()).toBe(false)
    expect(checkTurn(ownKey())).toEqual({ ok: true })
  })
})

describe('demo notice', () => {
  it('allows a demo turn when the accepted terms already record chats', () => {
    acceptTos(true)
    expect(checkTurn({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })).toEqual({ ok: true })
  })

  it('re-blocks a demo turn for a user who opted out of recording', () => {
    acceptTos(false)
    expect(checkTurn({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })).toEqual({ ok: false, reason: 'demo-notice' })
  })

  it('treats a leftover shared selection as demo', () => {
    acceptTos(false)
    expect(checkTurn({ kind: 'meta', model: 'm', shared: 's2' })).toEqual({ ok: false, reason: 'demo-notice' })
  })

  it('checks the terms before the demo notice', () => {
    expect(checkTurn({ kind: 'opencode-go', model: 'm', demo: true })).toEqual({ ok: false, reason: 'tos' })
  })
})

describe('gate rows', () => {
  it('orders the acknowledgements code-execution, sharing, then the recording opt-in', () => {
    expect(consentRows(ownKey()).map((row) => row.key)).toEqual(['code-execution', 'provider-sharing', 'recordOwnChats'])
    expect(consentRows(ownKey()).filter((row) => row.kind === 'ack').every((row) => row.required)).toBe(true)
  })

  it('adds the always-recorded notice for demo, with recording checked and locked', () => {
    const rows = consentRows({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })
    expect(rows.map((row) => row.key)).toEqual(['code-execution', 'provider-sharing', 'demo-recorded', 'recordOwnChats'])
    expect(rows.find((row) => row.key === 'recordOwnChats')).toMatchObject({ checked: true, locked: true })
  })

  it('keeps the code-execution and sharing acks for a custom base URL, skipping the recording question', () => {
    const rows = consentRows({ kind: 'openai', model: 'm', baseUrl: 'https://direct.test' })
    expect(rows.map((row) => row.key)).toEqual(['code-execution', 'provider-sharing'])
  })

  it('keeps each acknowledgement short and specific', () => {
    const byKey = Object.fromEntries(ACKS.map((ack) => [ack.key, ack.text]))
    expect(byKey['code-execution']).toMatch(/JavaScript in workers in this browser/i)
    expect(byKey['provider-sharing']).toMatch(/inference provider/i)
    expect(byKey['provider-sharing']).toMatch(/train on session data/i)
    expect(byKey['demo-recorded']).toMatch(/always recorded/i)
    expect(byKey['demo-recorded']).toMatch(/cannot be opted out/i)
    for (const ack of ACKS) expect((ack.text.match(/\./g) ?? []).length).toBeLessThanOrEqual(2)
  })
})

describe('gate dialog', () => {
  const gate = () => document.querySelector('.tos-gate')
  const box = (key) => gate().querySelector(`[data-tos="${key}"]`)
  const tick = (key) => {
    const input = box(key).querySelector('input')
    input.checked = true
    input.dispatchEvent(new Event('change'))
  }

  it('requires the acknowledgements before Accept, then writes the accepted record', async () => {
    const pending = openConsentGate(ownKey())
    expect(gate()).not.toBeNull()
    const ok = gate().querySelector('.confirm-ok')
    expect(ok.disabled).toBe(true)
    tick('code-execution')
    expect(ok.disabled).toBe(true)
    tick('provider-sharing')
    expect(ok.disabled).toBe(false)
    ok.click()
    expect(await pending).toBe(true)
    expect(gate()).toBeNull()
    expect(needsTos()).toBe(false)
    expect(localStorage.getItem('jscad-ai.log')).toBeNull()
  })

  it('records an unchecked opt-in as off', async () => {
    const pending = openConsentGate(ownKey())
    const recording = box('recordOwnChats').querySelector('input')
    expect(recording.checked).toBe(true)
    recording.checked = false
    recording.dispatchEvent(new Event('change'))
    tick('code-execution')
    tick('provider-sharing')
    gate().querySelector('.confirm-ok').click()
    expect(await pending).toBe(true)
    expect(getRecordOwnChats()).toBe(false)
    expect(localStorage.getItem('jscad-ai.log')).toBe('off')
  })

  it('writes nothing when declined', async () => {
    const pending = openConsentGate(ownKey())
    gate().querySelector('.confirm-cancel').click()
    expect(await pending).toBe(false)
    expect(gate()).toBeNull()
    expect(needsTos()).toBe(true)
    expect(localStorage.getItem('jscad-ai.log')).toBeNull()
  })

  it('locks the recording checkbox on for demo', async () => {
    const pending = openConsentGate({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })
    const recording = box('recordOwnChats').querySelector('input')
    expect(recording.checked).toBe(true)
    expect(recording.disabled).toBe(true)
    expect(box('demo-recorded')).not.toBeNull()
    tick('code-execution')
    tick('provider-sharing')
    tick('demo-recorded')
    gate().querySelector('.confirm-ok').click()
    expect(await pending).toBe(true)
    expect(getRecordOwnChats()).toBe(true)
  })

  it('keeps a prior opt-out when the demo notice is accepted', async () => {
    acceptTos(false)
    const pending = openConsentGate({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })
    const recording = box('recordOwnChats').querySelector('input')
    expect(recording.checked).toBe(true)
    expect(recording.disabled).toBe(true)
    tick('code-execution')
    tick('provider-sharing')
    tick('demo-recorded')
    gate().querySelector('.confirm-ok').click()
    expect(await pending).toBe(true)
    // The locked demo box is not the user's answer, so the stored opt-out
    // survives accepting the notice; demo logging is enforced server-side.
    expect(getRecordOwnChats()).toBe(false)
    expect(localStorage.getItem('jscad-ai.log')).toBe('off')
    // Demo turns stay gated on the notice rather than being silently allowed.
    expect(checkTurn({ kind: 'opencode-go', model: 'm', demo: true, shared: 's1' })).toEqual({ ok: false, reason: 'demo-notice' })
  })

  it('keeps the prior opt-out when the recording question is skipped for a custom base URL', async () => {
    localStorage.setItem('jscad-ai.log', 'off')
    const pending = openConsentGate({ kind: 'openai', model: 'm', baseUrl: 'https://direct.test' })
    expect(box('recordOwnChats')).toBeNull()
    expect(gate().querySelectorAll('.tos-ack')).toHaveLength(2)
    tick('code-execution')
    tick('provider-sharing')
    gate().querySelector('.confirm-ok').click()
    expect(await pending).toBe(true)
    expect(getRecordOwnChats()).toBe(false)
  })
})

describe('send gate', () => {
  const openChat = (options = {}) => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const controls = initChat({ container, requestTool: async () => '{}', ...options })
    const q = (selector) => container.querySelector(selector)
    const type = (text) => {
      q('.chat-input').value = text
      q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    }
    return { container, q, type, controls }
  }

  it('blocks the turn until the terms are accepted, and keeps the history when declined', async () => {
    const stored = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'earlier reply' }]
    const storage = { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation: vi.fn(async () => {}) }
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const { q, type } = openChat({ getProvider: ownKey, runTurnFn, storage, projectId: 'p1' })
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('earlier reply'))

    type('a cube')
    expect(document.querySelector('.tos-gate')).not.toBeNull()
    expect(runTurnFn).not.toHaveBeenCalled()
    document.querySelector('.tos-gate .confirm-cancel').click()
    await vi.waitFor(() => expect(q('.chat-msg.error')).not.toBeNull())

    expect(q('.chat-msg.error').textContent).toBe(TOS_REQUIRED_MESSAGE)
    expect(runTurnFn).not.toHaveBeenCalled()
    expect(q('.chat-msg.assistant').textContent).toBe('earlier reply')
    expect(q('.chat-input').value).toBe('a cube')
    expect(storage.writeConversation).not.toHaveBeenCalled()
  })

  it('runs the turn once the terms are accepted and stops asking', async () => {
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText('ok')
      return { messages: [] }
    })
    const { type } = openChat({ getProvider: ownKey, runTurnFn })
    type('a cube')
    const ok = document.querySelector('.tos-gate .confirm-ok')
    for (const input of document.querySelectorAll('.tos-gate .tos-ack')) {
      input.checked = true
      input.dispatchEvent(new Event('change'))
    }
    ok.click()
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(document.querySelector('.tos-gate')).toBeNull()

    type('a second cube')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(2))
    expect(document.querySelector('.tos-gate')).toBeNull()
  })

  it('keeps the provider-sharing ack for a custom base URL and never records the turn', async () => {
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const custom = { kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://direct.test' }
    const { q, type } = openChat({ getProvider: () => custom, runTurnFn, projectId: 'p1' })
    type('a cube')
    const gate = document.querySelector('.tos-gate')
    expect(gate.querySelectorAll('.tos-ack')).toHaveLength(2)
    expect(gate.querySelector('[data-tos="recordOwnChats"]')).toBeNull()
    for (const input of gate.querySelectorAll('.tos-ack')) {
      input.checked = true
      input.dispatchEvent(new Event('change'))
    }
    gate.querySelector('.confirm-ok').click()
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(q('.chat-msg.error')).toBeNull()
  })

  it('runs one turn when Send is pressed twice while the gate is open', async () => {
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText('done')
      return { messages: [] }
    })
    const { q, type } = openChat({ getProvider: ownKey, runTurnFn })
    type('a cube')
    type('a cube')
    const gate = document.querySelector('.tos-gate')
    for (const input of gate.querySelectorAll('.tos-ack')) {
      input.checked = true
      input.dispatchEvent(new Event('change'))
    }
    gate.querySelector('.confirm-ok').click()
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('done'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runTurnFn).toHaveBeenCalledTimes(1)
    expect(q('.chat-messages').querySelectorAll('.chat-msg.user')).toHaveLength(1)
  })

  it('asks for the demo notice when a recording opt-out meets the demo provider', async () => {
    acceptTos(false)
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const demo = { kind: 'opencode-go', model: 'm', apiKey: 'demo-limited-free', shared: 's1', demo: true }
    const { q, type } = openChat({ getProvider: () => demo, runTurnFn, projectId: 'p1' })
    type('a cube')
    const gate = document.querySelector('.tos-gate')
    expect(gate).not.toBeNull()
    expect(gate.querySelector('[data-tos="demo-recorded"]')).not.toBeNull()
    expect(gate.querySelector('[data-tos="recordOwnChats"] input').disabled).toBe(true)
    gate.querySelector('.confirm-cancel').click()
    await vi.waitFor(() => expect(q('.chat-msg.error')).not.toBeNull())
    expect(q('.chat-msg.error').textContent).toBe(DEMO_NOTICE_MESSAGE)
    expect(runTurnFn).not.toHaveBeenCalled()
  })

  it('runs the demo turn after the notice is accepted, keeping the opt-out for the next send', async () => {
    acceptTos(false)
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText('demo reply')
      return { messages: [] }
    })
    const demo = { kind: 'opencode-go', model: 'm', apiKey: 'demo-limited-free', shared: 's1', demo: true }
    const { q, type } = openChat({ getProvider: () => demo, runTurnFn, projectId: 'p1' })
    type('a cube')
    const gate = document.querySelector('.tos-gate')
    for (const input of gate.querySelectorAll('.tos-ack')) {
      input.checked = true
      input.dispatchEvent(new Event('change'))
    }
    gate.querySelector('.confirm-ok').click()
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('demo reply'))
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(runTurnFn).toHaveBeenCalledTimes(1)
    // Accepting the notice does not clear the stored opt-out, so the next demo
    // send is gated again (the relay records demo turns regardless).
    expect(getRecordOwnChats()).toBe(false)
    type('a second cube')
    await vi.waitFor(() => expect(document.querySelector('.tos-gate')).not.toBeNull())
    expect(runTurnFn).toHaveBeenCalledTimes(1)
  })
})

describe('consent link target', () => {
  // GitHub's heading slugs: lower-case, punctuation dropped, spaces to hyphens.
  const slug = (heading) => heading.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')

  it('points the privacy note at a heading that exists in docs/architecture.md', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { TOS_LINK } = await import('../src/aiConsent.js')
    // The link and the local doc must not drift: same file, same anchor.
    expect(TOS_LINK.href).toMatch(/\/apps\/jscad-web\/docs\/architecture\.md#privacy$/)
    const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'architecture.md'), 'utf8')
    const slugs = new Set(
      doc
        .split('\n')
        .filter((line) => /^#{1,6}\s/.test(line))
        .map((line) => slug(line.replace(/^#{1,6}\s*/, ''))),
    )
    expect(slugs).toContain(new URL(TOS_LINK.href).hash.slice(1))
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})
