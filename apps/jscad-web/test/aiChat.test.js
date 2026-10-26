// apps/jscad-web/test/aiChat.test.js
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSystemPrompt, dispatchTool, SUMMARY_PREFIX } from '@jscadui/agent-loop'
import { TOS_VERSION } from '../src/aiConsent.js'
import { createWebsearchGrant, initChat, relayBaseUrl, visionCapable, WEB_ALLOW, WEB_DECLINE, WEB_PERMISSION_QUESTION, webDeclined, webUnasked } from '../src/aiChat.js'
import * as modelVision from '../src/modelVision.js'

// Every turn is gated on the accepted terms version, so each test here starts
// past the gate; the gate itself is covered in aiConsent.test.js.
beforeEach(() => {
  localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 0, recordOwnChats: true }))
  localStorage.removeItem('jscad-ai.log')
})

describe('browser chat turn', () => {
  it('runs requestTool for a tool_use and appends streamed text', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ requestTool, onText }) => {
      onText('Hello')
      const result = await requestTool('measure', {})
      onText(`volume ${JSON.parse(result).volume}`)
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'how big?'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))
    expect(container.querySelector('.chat-messages').textContent).toMatch(/volume 42/)
  })

  // The turn stays open until `release`, so the gate's question card has a live turn to sit in.
  const openTurn = async (logs) => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const turn = {}
    const runTurnFn = vi.fn(async (opts) => {
      turn.opts = opts
      await new Promise((resolve) => {
        turn.release = resolve
      })
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ ok: true }))
    turn.chat = initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      websearchLog: (entry) => logs.push(entry),
    })
    container.querySelector('.chat-input').value = 'look it up'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    turn.container = container
    turn.requestTool = requestTool
    turn.choose = async (label) => {
      await vi.waitFor(() => expect(container.querySelectorAll('.chat-question:not(.answered)')).toHaveLength(1))
      ;[...container.querySelectorAll('.chat-question-option')].find((b) => b.textContent === label).click()
    }
    return turn
  }

  it('asks the user before the first web call, and a yes grants the conversation', async () => {
    const logs = []
    const turn = await openTurn(logs)
    expect(await turn.opts.beforeToolCall('measure', {})).toBeUndefined()
    const search = turn.opts.beforeToolCall('websearch', { query: 'bearing' })
    const fetch = turn.opts.beforeToolCall('webfetch', { url: 'https://example.com/a' })
    await turn.choose(WEB_ALLOW)
    expect(turn.container.querySelectorAll('.chat-question')).toHaveLength(1)
    expect(turn.container.querySelector('.chat-question-text').textContent).toBe(WEB_PERMISSION_QUESTION.question)
    expect(await search).toBeUndefined()
    expect(await fetch).toBeUndefined()
    expect(turn.chat.isWebsearchGranted()).toBe(true)
    expect(await turn.opts.beforeToolCall('websearch', { query: 'nut' })).toBeUndefined()
    expect(turn.container.querySelectorAll('.chat-question')).toHaveLength(1)
    expect(turn.requestTool).not.toHaveBeenCalled()
    await turn.opts.afterToolCall(
      'websearch',
      { query: 'bearing' },
      JSON.stringify({ ok: true, results: [{ title: 't', url: 'https://example.com/x', snippet: 's', provider: 'exa' }] }),
    )
    expect(logs).toEqual([{ query: 'bearing', provider: 'exa', count: 1 }])
    turn.release()
  })

  it('remembers a no for the conversation until the settings grant web access', async () => {
    const logs = []
    const turn = await openTurn(logs)
    const first = turn.opts.beforeToolCall('webfetch', { url: 'https://example.com/a' })
    await turn.choose(WEB_DECLINE)
    expect(await first).toEqual({ decision: 'deny', reason: webDeclined('webfetch') })
    expect(await turn.opts.beforeToolCall('websearch', { query: 'bearing' })).toEqual({ decision: 'deny', reason: webDeclined('websearch') })
    expect(turn.container.querySelectorAll('.chat-question')).toHaveLength(1)
    // An ungranted call is not audited as a fetch.
    await turn.opts.afterToolCall('webfetch', { url: 'https://example.com/a' }, { ok: true, content: 'hello' })
    expect(logs).toEqual([])
    turn.chat.setWebsearchGranted(true)
    expect(await turn.opts.beforeToolCall('webfetch', { url: 'https://example.com/a' })).toBeUndefined()
    turn.release()
  })

  it('denies a web call it cannot ask about, pointing at Chat settings, and audits only fetched pages', async () => {
    const logs = []
    const unasked = createWebsearchGrant({ log: (entry) => logs.push(entry) })
    expect(await unasked.beforeToolCall('webfetch', { url: 'https://example.com/a' })).toEqual({ decision: 'deny', reason: webUnasked('webfetch') })
    const dismissed = createWebsearchGrant({ ask: async () => Promise.reject(new Error('question dismissed')) })
    expect(await dismissed.beforeToolCall('websearch', { query: 'x' })).toEqual({ decision: 'deny', reason: webUnasked('websearch') })
    // An ungranted call is not audited as a fetch.
    await unasked.afterToolCall('webfetch', { url: 'https://example.com/a' }, { ok: true, content: 'hello' })
    expect(logs).toEqual([])
    unasked.setGranted(true)
    expect(await unasked.beforeToolCall('webfetch', { url: 'https://example.com/a' })).toBeUndefined()
    await unasked.afterToolCall('webfetch', { url: 'https://example.com/a' }, JSON.stringify({ ok: true, content: 'hello' }))
    // A failed fetch is not audited as a fetch; only a page that came back is.
    await unasked.afterToolCall('webfetch', { url: 'https://example.com/b' }, { ok: false, error: { name: 'FetchError' } })
    expect(logs).toEqual([{ url: 'https://example.com/a', bytes: 5 }])
  })

  it('reads a typed yes as allowing web access', async () => {
    const grant = createWebsearchGrant({ ask: async () => 'yes please' })
    expect(await grant.beforeToolCall('websearch', { query: 'x' })).toBeUndefined()
    expect(grant.isGranted()).toBe(true)
  })

  it('answers the pre-rename tool names as unknown, never as a served call', async () => {
    const deps = {
      list: async () => ({ ok: true }),
      search: async () => ({ ok: true }),
      askUser: async () => '',
      run: async () => ({ ok: true }),
      websearch: async () => ({ ok: true }),
    }
    const old = [['list', {}], ['search', { pattern: 'x' }], ['ask_user', { question: 'x' }], ['run', { source: 'x' }], ['web_search', { query: 'x' }]]
    for (const [name, input] of old) {
      expect(await dispatchTool(name, input, deps), name).toEqual({ ok: false, error: { name: 'UnknownToolError', message: `unknown tool ${name}` } })
    }
    expect(await dispatchTool('websearch', { query: 'x' }, deps)).toEqual({ ok: true })
  })

  it('resolves a websearchProvider function per turn and keeps logging when the log throws', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const seenFilters = []
    const runTurnFn = vi.fn(async (opts) => {
      seenFilters.push(opts.toolFilter)
      return { messages: [] }
    })
    let pin = 'random'
    const chat = initChat({
      container,
      requestTool: vi.fn(async () => ({ ok: true })),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      websearchGranted: true,
      websearchLog: () => {
        throw new Error('log down')
      },
      websearchProvider: () => pin,
    })
    expect(chat.isWebsearchGranted()).toBe(true)
    const submit = () => {
      container.querySelector('.chat-input').value = 'hi'
      container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    }
    submit()
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(seenFilters[0]?.('websearch')).toBe(true)
    pin = 'off'
    submit()
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(2))
    expect(seenFilters[1]?.('websearch')).toBe(false)
    expect(seenFilters[1]?.('write')).toBe(true)
    const calls = runTurnFn.mock.calls
    await expect(
      calls[1][0].afterToolCall('websearch', { query: 'x' }, JSON.stringify({ ok: true, results: [] })),
    ).resolves.toBeUndefined()
  })

  it('renders a string tool result as-is, not JSON-quoted with literal \\n', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const docsText = 'cuboid(options)\n  size: [x, y, z]'
    const runTurnFn = vi.fn(async ({ requestTool }) => {
      await requestTool('docs', { name: 'cuboid' })
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: vi.fn(async () => docsText),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'docs for cuboid'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    const resultEl = await vi.waitFor(() => {
      const el = container.querySelector('.chat-tool-result')
      expect(el.textContent).not.toBe('running...')
      return el
    })
    expect(resultEl.textContent).toBe(docsText)
  })

  it('renders text after a tool call as a fresh message below the tool line', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ requestTool, onText }) => {
      onText('I will measure')
      await requestTool('measure', {})
      onText('the volume is 42')
      return { messages: [] }
    })
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    initChat({
      container,
      requestTool,
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'how big?'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))

    const messages = container.querySelector('.chat-messages')
    const assistants = messages.querySelectorAll('.chat-msg.assistant')
    const tool = messages.querySelector('.chat-tool')
    expect(assistants.length).toBe(2)
    expect(assistants[0].textContent).toBe('I will measure')
    expect(assistants[1].textContent).toBe('the volume is 42')
    expect(tool.compareDocumentPosition(assistants[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
const abortError = () => Object.assign(new Error('turn aborted'), { name: 'AbortError' })

// A turn that waits until the test releases it or the chat aborts it.
const heldTurn = () => {
  let release
  let args
  const runTurnFn = vi.fn((options) => {
    args = options
    return new Promise((resolve, reject) => {
      release = () => resolve({ messages: [] })
      options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
    })
  })
  return { runTurnFn, release: () => release(), args: () => args }
}

const openChat = (options = {}) => {
  document.body.innerHTML = '<div id="chat"></div>'
  const container = document.getElementById('chat')
  const controls = initChat({
    container,
    requestTool: async () => '{}',
    getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
    ...options,
  })
  const q = (selector) => container.querySelector(selector)
  const type = (text) => {
    q('.chat-input').value = text
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  }
  return { container, q, type, controls }
}

describe('running turn', () => {
  it('turns Send into Stop while a turn runs and back when it ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    const send = q('.chat-send')
    expect([send.textContent, send.getAttribute('aria-label'), send.type]).toEqual(['Send', 'Send the message', 'submit'])
    type('a cube')
    expect([send.textContent, send.getAttribute('aria-label'), send.type]).toEqual(['Stop', 'Stop the reply', 'button'])
    expect(send.classList.contains('running')).toBe(true)
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.release()
    await vi.waitFor(() => expect(send.textContent).toBe('Send'))
    expect([send.getAttribute('aria-label'), send.type, send.classList.contains('running')]).toEqual(['Send the message', 'submit', false])
  })

  it('keeps the input editable while a turn runs, and Enter does not send until it ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    type('first')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    expect(q('.chat-input').disabled).toBe(false)
    type('second')
    expect(q('.chat-input').value).toBe('second')
    expect(turn.runTurnFn).toHaveBeenCalledTimes(1)
    turn.release()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(2))
    expect(turn.runTurnFn.mock.calls[1][0].conversation.messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it('Stop aborts the turn, keeps the partial reply marked stopped, persists it and still ends the turn', async () => {
    const turn = heldTurn()
    const endTurn = vi.fn(async () => {})
    const storage = { readConversation: async () => null, writeConversation: vi.fn(async () => {}) }
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn, endTurn, storage, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onText('Writing the cu')
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(turn.args().signal.aborted).toBe(true)
    expect(q('.chat-msg.assistant').textContent).toBe('Writing the cu')
    expect(q('.chat-msg.stopped').textContent).toBe('Stopped')
    expect(q('.chat-msg.error')).toBeNull()
    expect(endTurn).toHaveBeenCalledTimes(1)
    expect(storage.writeConversation.mock.calls.at(-1)[1]).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Writing the cu', stopped: true },
    ])
  })

  it('tells the model a stopped reply was stopped, and shows it stopped on resume', async () => {
    const stored = [{ role: 'user', content: 'a cube' }, { role: 'assistant', content: '', stopped: true }]
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const storage = { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation: vi.fn(async () => {}) }
    const { q, type } = openChat({ runTurnFn, storage, projectId: 'p1' })
    await vi.waitFor(() => expect(q('.chat-msg.stopped')?.textContent).toBe('Stopped'))
    expect(q('.chat-msg.assistant')).toBeNull()
    type('go on')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(runTurnFn.mock.calls[0][0].conversation.messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: '[stopped by the user]' },
    ])
  })

  it('shows the phase of the turn above the input and hides it when the turn ends', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    const status = q('.chat-status')
    const phase = q('.chat-status-phase')
    expect(phase.getAttribute('aria-live')).toBe('polite')
    expect(q('.chat-status-time').getAttribute('aria-hidden')).toBe('true')
    expect(status.nextElementSibling).toBe(q('.chat-form'))
    type('a cube')
    expect(status.classList.contains('active')).toBe(true)
    expect(phase.textContent).toBe('Thinking…')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    const { onStatus } = turn.args()
    onStatus({ phase: 'thinking', reasoningChars: 400 })
    expect(phase.textContent).toBe('Thinking…')
    expect(q('.chat-status-time').textContent).toMatch(/^~100 tokens · \d+s$/)
    onStatus({ phase: 'text' })
    expect(phase.textContent).toBe('Writing…')
    expect(q('.chat-status-time').textContent).toMatch(/^\d+s$/)
    onStatus({ phase: 'tool', tool: 'write', detail: 'main.js' })
    expect(phase.textContent).toBe('write main.js…')
    onStatus({ phase: 'tool', tool: 'measure' })
    expect(phase.textContent).toBe('measure…')
    onStatus({ phase: 'retry', attempt: 2, maxAttempts: 4 })
    expect(phase.textContent).toBe('Provider busy, retrying (2/4)…')
    turn.release()
    await vi.waitFor(() => expect(status.classList.contains('active')).toBe(false))
    expect(phase.textContent).toBe('')
    expect(q('.chat-status-time').textContent).toBe('')
  })

  it('counts the seconds of the turn about once a second', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const turn = heldTurn()
      const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      expect(q('.chat-status-time').textContent).toBe('0s')
      vi.advanceTimersByTime(2100)
      expect(q('.chat-status-time').textContent).toBe('2s')
      expect(q('.chat-status-phase').textContent).toBe('Thinking…')
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('chat input', () => {
  it('keeps the draft and points at Chat settings when the provider is not configured', () => {
    const { q, type } = openChat({ getProvider: () => null })
    type('make it bigger')
    expect(q('.chat-msg.error').textContent).toBe('Set your model and API key in Chat settings first.')
    expect(q('.chat-input').value).toBe('make it bigger')
  })

  it('takes multiple lines; Enter submits and Shift+Enter does not', async () => {
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const { q } = openChat({ runTurnFn })
    const input = q('.chat-input')
    expect(input.tagName).toBe('TEXTAREA')
    input.value = 'first line\nsecond line'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    expect(runTurnFn).not.toHaveBeenCalled()
    input.value = 'a cube'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(runTurnFn.mock.calls[0][0].conversation.messages.at(-1)).toEqual({ role: 'user', content: 'a cube' })
  })

  it('follows the stream only while the reader is at the bottom', async () => {
    const turn = heldTurn()
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn })
    const messages = q('.chat-messages')
    Object.defineProperty(messages, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(messages, 'clientHeight', { value: 100, configurable: true })
    messages.scrollTop = 0
    type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onText('streaming…')
    expect(messages.scrollTop).toBe(0)
    messages.scrollTop = 1000
    turn.args().onText(' more')
    expect(messages.scrollTop).toBe(1000)
    turn.release()
  })
})

describe('model reasoning', () => {
  // vi.waitFor would advance the fake clock; a macrotask lets the turn start without moving it.
  const started = async (turn) => {
    while (turn.runTurnFn.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  const withClock = async (fn) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      await fn()
    } finally {
      vi.useRealTimers()
    }
  }

  it('streams each step into a collapsed block, Thinking… with its seconds, then Thought for Ns when text starts', () =>
    withClock(async () => {
      const turn = heldTurn()
      const { q, container, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      await started(turn)
      const { onReasoning, onStatus, onText } = turn.args()
      onStatus({ phase: 'thinking', reasoningChars: 4 })
      onReasoning('hmm ')
      const block = q('.chat-reasoning')
      expect(block.tagName).toBe('DETAILS')
      expect(block.open).toBe(false)
      expect(block.querySelector('summary').textContent).toBe('Thinking… 0s')
      onReasoning('a cube')
      expect(q('.chat-reasoning-text').textContent).toBe('hmm a cube')
      vi.advanceTimersByTime(3100)
      expect(block.querySelector('summary').textContent).toBe('Thinking… 3s')
      onStatus({ phase: 'text' })
      onText('Here it is')
      expect(block.querySelector('summary').textContent).toBe('Thought for 3s')
      expect(block.compareDocumentPosition(q('.chat-msg.assistant')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      vi.advanceTimersByTime(5000)
      expect(block.querySelector('summary').textContent).toBe('Thought for 3s')
      expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
      turn.release()
    }))

  it('opens a new block for each model step and closes the last one when the turn ends', () =>
    withClock(async () => {
      const turn = heldTurn()
      const { q, container, type } = openChat({ runTurnFn: turn.runTurnFn })
      type('a cube')
      await started(turn)
      const { onReasoning, onStatus, requestTool } = turn.args()
      onReasoning('write it')
      onStatus({ phase: 'tool', tool: 'write', detail: 'main.js' })
      await requestTool('write', { path: 'main.js', content: 'x' })
      onStatus({ phase: 'thinking' })
      vi.advanceTimersByTime(1000)
      onReasoning('check it')
      const blocks = container.querySelectorAll('.chat-reasoning')
      expect(blocks).toHaveLength(2)
      expect(blocks[0].querySelector('summary').textContent).toBe('Thought for 1s')
      expect(blocks[1].querySelector('summary').textContent).toBe('Thinking… 0s')
      expect(q('.chat-tool').compareDocumentPosition(blocks[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      vi.advanceTimersByTime(2000)
      turn.release()
      await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
      expect(blocks[1].querySelector('summary').textContent).toBe('Thought for 2s')
    }))

  it('closes the block when the turn fails or is stopped', async () => {
    const failing = openChat({
      runTurnFn: async ({ onReasoning }) => {
        onReasoning('hmm')
        throw new Error('provider down')
      },
    })
    failing.type('a cube')
    await vi.waitFor(() => expect(failing.q('.chat-msg.error')?.textContent).toBe('provider down'))
    expect(failing.q('.chat-reasoning summary').textContent).toMatch(/^Thought for \d+s$/)

    const turn = heldTurn()
    const stopped = openChat({ runTurnFn: turn.runTurnFn })
    stopped.type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onReasoning('hmm')
    stopped.q('.chat-send').click()
    await vi.waitFor(() => expect(stopped.q('.chat-msg.stopped')).not.toBeNull())
    expect(stopped.q('.chat-reasoning summary').textContent).toMatch(/^Thought for \d+s$/)
  })

  it('stores the reasoning with the reply, shows it on reload, and never sends it to the model', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const writeConversation = vi.fn(async () => {})
      const first = openChat({
        runTurnFn: async ({ onReasoning, onStatus, onText }) => {
          onReasoning('secret plan')
          onStatus({ phase: 'text' })
          onText('hi')
          return { messages: [] }
        },
        storage: { readConversation: async () => null, writeConversation },
        projectId: 'p1',
      })
      first.type('hello')
      await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toHaveLength(2))
      const stored = writeConversation.mock.calls.at(-1)[1]
      expect(stored[1]).toEqual({ role: 'assistant', content: 'hi', reasoning: [{ text: 'secret plan', seconds: expect.any(Number) }] })

      const runTurnFn = vi.fn(async ({ provider }) => {
        for await (const e of provider.send(runTurnFn.mock.calls[0][0].conversation.messages, [])) void e
        return { messages: [] }
      })
      const resumed = [stored[0], { ...stored[1], reasoning: [{ text: 'secret plan', seconds: 4 }] }]
      const second = openChat({ runTurnFn, storage: { readConversation: async () => ({ messages: resumed, updated: 1 }), writeConversation }, projectId: 'p1' })
      await vi.waitFor(() => expect(second.q('.chat-reasoning')).not.toBeNull())
      const block = second.q('.chat-reasoning')
      expect(block.open).toBe(false)
      expect(block.querySelector('summary').textContent).toBe('Thought for 4s')
      expect(block.querySelector('.chat-reasoning-text').textContent).toBe('secret plan')
      expect(block.compareDocumentPosition(second.q('.chat-msg.assistant')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      second.type('again')
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(runTurnFn.mock.calls[0][0].conversation.messages.slice(1, 3)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ])
      expect(fetchMock.mock.calls[0][1].body).not.toContain('secret plan')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drops a failed turn\u2019s user message so a retry sends it once', async () => {
    const writeConversation = vi.fn(async () => {})
    const runTurnFn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('the provider refused to answer'), { name: 'RefusalError' }))
      .mockImplementation(async ({ onText }) => {
        onText('ok')
        return { messages: [] }
      })
    const chat = openChat({ runTurnFn, storage: { readConversation: async () => null, writeConversation }, projectId: 'p1' })
    chat.type('first')
    await vi.waitFor(() => expect(chat.q('.chat-msg.error')?.textContent).toBe('the provider refused to answer'))
    await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toEqual([]))
    chat.type('second')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(2))
    const sent = runTurnFn.mock.calls[1][0].conversation.messages.filter((m) => m.role === 'user').map((m) => m.content)
    expect(sent).not.toContain('first')
    expect(sent.at(-1)).toBe('second')
  })

  it('stores the reasoning of a stopped reply too', async () => {
    const turn = heldTurn()
    const writeConversation = vi.fn(async () => {})
    const { q, type } = openChat({ runTurnFn: turn.runTurnFn, storage: { readConversation: async () => null, writeConversation }, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    turn.args().onReasoning('hmm')
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(writeConversation.mock.calls.at(-1)[1][1]).toEqual({ role: 'assistant', content: '', stopped: true, reasoning: [{ text: 'hmm', seconds: expect.any(Number) }] })
  })
})

describe('message kinds', () => {
  it('marks user, reply, tool and error rows apart', async () => {
    const { container, q, type } = openChat({
      requestTool: async (name) => {
        if (name === 'measure') throw new Error('no geometry')
        if (name === 'check') return { ok: false, error: { message: 'open edges' } }
        if (name === 'docs') return 'cuboid(options)'
        return { ok: true }
      },
      runTurnFn: async ({ requestTool, onText }) => {
        onText('Writing it')
        await requestTool('write', { path: 'main.js', content: 'x' })
        await requestTool('docs', { query: 'cuboid' })
        await requestTool('measure', {})
        await requestTool('check', {})
        throw new Error('provider down')
      },
    })
    type('a cube')
    await vi.waitFor(() => expect(q('.chat-msg.error')).not.toBeNull())
    expect(q('.chat-msg.user').textContent).toBe('a cube')
    expect(q('.chat-msg.assistant').textContent).toBe('Writing it')
    const rows = [...container.querySelectorAll('.chat-tool')]
    const summary = (row) => ['.chat-tool-name', '.chat-tool-target', '.chat-tool-mark'].map((s) => row.querySelector(`summary ${s}`)?.textContent ?? null)
    expect(rows.map(summary)).toEqual([
      ['write', 'main.js', 'ok'],
      ['docs', 'cuboid', 'ok'],
      ['measure', null, 'failed'],
      ['check', null, 'failed'],
    ])
    expect(rows.map((row) => row.classList.contains('failed'))).toEqual([false, false, true, true])
    expect(rows.every((row) => row.tagName === 'DETAILS' && !row.open)).toBe(true)
    expect(JSON.parse(rows[0].querySelector('.chat-tool-input').textContent)).toEqual({ path: 'main.js', content: 'x' })
    expect(rows[1].querySelector('.chat-tool-result').textContent).toBe('cuboid(options)')
    expect(q('.chat-msg.error').textContent).toBe('provider down')
  })

  it('shows a running tool as pending until it answers', async () => {
    let answer
    const { q, type } = openChat({
      requestTool: () => new Promise((resolve) => { answer = resolve }),
      runTurnFn: async ({ requestTool }) => {
        await requestTool('export', { format: 'stl' })
        return { messages: [] }
      },
    })
    type('export it')
    await vi.waitFor(() => expect(q('.chat-tool')).not.toBeNull())
    expect(q('.chat-tool-target').textContent).toBe('stl')
    expect(q('.chat-tool-mark').textContent).toBe('…')
    expect(q('.chat-tool').classList.contains('running')).toBe(true)
    answer({ ok: true })
    await vi.waitFor(() => expect(q('.chat-tool-mark').textContent).toBe('ok'))
    expect(q('.chat-tool').classList.contains('running')).toBe(false)
  })

  it('shows a view result as thumbnails that open full-size', async () => {
    const shots = [
      { image: { dataUrl: 'data:image/png;base64,AAA' }, camera: { position: [1, 2, 3] } },
      { image: { dataUrl: 'data:image/png;base64,BBB' }, camera: { position: [4, 5, 6] } },
    ]
    const { q, type } = openChat({
      requestTool: async () => ({ ok: true, shots }),
      runTurnFn: async ({ requestTool }) => {
        await requestTool('view', {})
        return { messages: [] }
      },
    })
    type('what do you see?')
    await vi.waitFor(() => expect(q('.chat-tool-mark')?.textContent).toBe('ok'))
    // The text result carries cameras only; the pixels ride the thumbnails.
    expect(q('.chat-tool-result').textContent).not.toContain('data:image')
    const thumbs = q('.chat-tool').querySelectorAll('.chat-tool-thumb img')
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0].src).toContain('data:image/png')
    expect(q('.chat-tool').open).toBe(true)
    q('.chat-tool-thumb').click()
    expect(document.querySelector('.chat-view-overlay img.chat-view-full')?.src).toContain('AAA')
    document.querySelector('.chat-view-close').click()
    expect(document.querySelector('.chat-view-overlay')).toBeNull()
  })
})
describe('stored conversation', () => {
  it('loads a stored conversation and persists the turn', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const storage = {
      readConversation: async () => ({ messages: [{ role: 'user', content: 'old' }], updated: 1 }),
      writeConversation: vi.fn(async () => {}),
    }
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn: async ({ onText }) => { onText('hi'); return { messages: [] } },
      storage,
      projectId: 'p1',
    })
    await vi.waitFor(() => expect(container.querySelector('.chat-messages').textContent).toMatch(/old/))
    container.querySelector('.chat-input').value = 'hello'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({ role: 'assistant', content: 'hi' }))
    const persisted = storage.writeConversation.mock.calls.at(-1)[1]
    expect(persisted).toContainEqual({ role: 'user', content: 'hello' })
    expect(persisted).toContainEqual({ role: 'assistant', content: 'hi' })
  })

  it('records the paths a turn touched as mentions on the persisted reply', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const writeConversation = vi.fn(async () => {})
    initChat({
      container,
      requestTool: async () => ({ ok: true }),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn: async ({ requestTool, onText }) => {
        await requestTool('write', { path: 'src/a.js', content: 'x' })
        await requestTool('glob', {})
        onText('done')
        return { messages: [] }
      },
      storage: { readConversation: async () => null, writeConversation },
      projectId: 'p1',
    })
    container.querySelector('.chat-input').value = 'add a file'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({
      role: 'assistant',
      content: 'done',
      mentions: ['src/a.js'],
    }))
  })

  it('keeps the mentions of a stopped turn', async () => {
    const writeConversation = vi.fn(async () => {})
    const storage = { readConversation: async () => null, writeConversation }
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void (async () => {
          await options.requestTool('write', { path: 'a.js', content: 'x' })
          options.onText('Writing')
        })()
      }))
    const { q, type } = openChat({ runTurnFn, requestTool: async () => ({ ok: true }), storage, projectId: 'p1' })
    type('a cube')
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('Writing'))
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(writeConversation.mock.calls.at(-1)[1]).toEqual([
      { role: 'user', content: 'a cube' },
      { role: 'assistant', content: 'Writing', stopped: true, mentions: ['a.js'] },
    ])
  })

  it('New chat clears the view and persists an empty conversation for the open project', async () => {
    const store = { p1: [{ role: 'user', content: 'old' }] }
    const storage = {
      readConversation: async (pid) => (store[pid] ? { messages: store[pid], updated: 1 } : null),
      writeConversation: vi.fn(async (pid, messages) => { store[pid] = messages }),
    }
    const chat = openChat({ runTurnFn: vi.fn(), storage, projectId: 'p1' })
    await vi.waitFor(() => expect(chat.q('.chat-messages').textContent).toMatch(/old/))
    chat.q('.chat-new').click()
    await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalledWith('p1', []))
    expect(chat.q('.chat-messages').textContent).toBe('')
  })

  it('does nothing on New chat while a turn runs', async () => {
    const turn = heldTurn()
    const writeConversation = vi.fn(async () => {})
    const storage = { readConversation: async () => null, writeConversation }
    const chat = openChat({ runTurnFn: turn.runTurnFn, storage, projectId: 'p1' })
    chat.type('a cube')
    await vi.waitFor(() => expect(turn.runTurnFn).toHaveBeenCalledTimes(1))
    chat.q('.chat-new').click()
    expect(chat.q('.chat-msg.user').textContent).toBe('a cube')
    expect(writeConversation).not.toHaveBeenCalledWith('p1', [])
    turn.release()
    await vi.waitFor(() => expect(chat.q('.chat-send').textContent).toBe('Send'))
  })
})
describe('project switch', () => {
  it('loads the new project conversation on switch and stores per project', async () => {
    const store = {}
    const storage = {
      readConversation: async (pid) => (store[pid] ? { messages: store[pid], updated: 1 } : null),
      writeConversation: vi.fn(async (pid, messages) => { store[pid] = messages }),
    }
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText('ok')
      return { messages: [] }
    })
    let openId = 'p1'
    const chat = openChat({ runTurnFn, storage, projectId: () => openId })
    chat.type('for one')
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toHaveLength(2))
    openId = 'p2'
    await chat.controls.switchTo('p2')
    expect(chat.q('.chat-messages').textContent).not.toContain('for one')
    chat.type('for two')
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[0]).toBe('p2'))
    openId = 'p1'
    await chat.controls.switchTo('p1')
    await vi.waitFor(() => expect(chat.q('.chat-messages').textContent).toContain('for one'))
  })

  it('keeps a running turn on screen when the shown project is reopened', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const storage = { readConversation: vi.fn(async () => null), writeConversation: vi.fn(async () => {}) }
    const runTurnFn = vi.fn(async () => { await gate })
    const chat = openChat({ runTurnFn, storage, projectId: 'p1' })
    chat.type('hello p1')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    await chat.controls.switchTo('p1')
    expect(chat.q('.chat-messages').textContent).toContain('hello p1')
    expect(storage.readConversation).toHaveBeenCalledTimes(1)
    release()
  })

  it('ignores a conversation that resolves after another switch', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const storage = {
      readConversation: vi.fn(async (pid) => {
        if (pid === 'slow') await gate
        return null
      }),
      writeConversation: vi.fn(async () => {}),
    }
    let openId = 'p1'
    const chat = openChat({
      runTurnFn: vi.fn(async () => ({ messages: [] })),
      storage,
      projectId: () => openId,
    })
    const switching = chat.controls.switchTo('slow')
    openId = 'p2'
    release(null)
    await switching
    expect(storage.readConversation).toHaveBeenCalledWith('slow')
    expect(chat.q('.chat-messages').textContent).toBe('')
  })

  it('persists an in-flight turn under the project it started in, and keeps the new project view', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const store = {}
    const storage = {
      readConversation: async (pid) => (store[pid] ? { messages: store[pid], updated: 1 } : null),
      writeConversation: vi.fn(async (pid, messages) => { store[pid] = messages }),
    }
    const runTurnFn = vi.fn(async ({ onText }) => {
      await gate
      onText('late reply')
      return { messages: [] }
    })
    let openId = 'p1'
    const chat = openChat({ runTurnFn, storage, projectId: () => openId })
    chat.type('hello p1')
    await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalled())
    openId = 'p2'
    await chat.controls.switchTo('p2')
    release()
    await vi.waitFor(() => expect(storage.writeConversation.mock.calls.at(-1)?.[1]).toContainEqual({ role: 'assistant', content: 'late reply' }))
    expect(storage.writeConversation.mock.calls.at(-1)[0]).toBe('p1')
    expect(store.p1).toContainEqual({ role: 'assistant', content: 'late reply' })
    expect(chat.q('.chat-messages').textContent).not.toContain('late reply')
  })

  it('drops a tool line that arrives after a switch, and still completes the run', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const store = { p2: [{ role: 'user', content: 'p2 earlier' }] }
    const storage = {
      readConversation: async (id) => (store[id] ? { messages: store[id], updated: 1 } : null),
      writeConversation: vi.fn(async (id, messages) => { store[id] = messages }),
    }
    const requestTool = vi.fn(async () => ({ volume: 42 }))
    const runTurnFn = vi.fn(async ({ requestTool: callTool, onText }) => {
      await gate
      await callTool('measure', {})
      onText('done')
      return { messages: [] }
    })
    let openId = 'p1'
    const chat = openChat({ runTurnFn, requestTool, storage, projectId: () => openId })
    chat.type('how big?')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    openId = 'p2'
    await chat.controls.switchTo('p2')
    await vi.waitFor(() => expect(chat.q('.chat-messages').textContent).toContain('p2 earlier'))
    release()
    await vi.waitFor(() => expect(requestTool).toHaveBeenCalledWith('measure', {}))
    await vi.waitFor(() => expect(chat.q('.chat-send').textContent).toBe('Send'))
    expect(chat.q('.chat-tool')).toBeNull()
    expect(chat.q('.chat-messages').textContent).toBe('p2 earlier')
  })
})
describe('opencode session', () => {
  it('keeps one x-opencode-session per project across messages', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    let project = 'p1'
    const runTurnFn = vi.fn(async ({ provider }) => {
      for await (const event of provider.send([], [])) void event
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'opencode-go', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      projectId: () => project,
    })
    const submit = async (text, turns) => {
      container.querySelector('.chat-input').value = text
      container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(turns))
      await vi.waitFor(() => expect(container.querySelector('.chat-send').textContent).toBe('Send'))
    }
    await submit('one', 1)
    await submit('two', 2)
    project = 'p2'
    await submit('three', 3)
    const session = (i) => fetchMock.mock.calls[i][1].headers['x-opencode-session']
    expect(session(0)).toEqual(expect.any(String))
    expect(session(1)).toBe(session(0))
    expect(session(2)).not.toBe(session(0))
    vi.unstubAllGlobals()
  })

  it('starts a fresh provider session after New chat', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ provider }) => {
      for await (const event of provider.send([], [])) void event
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'opencode-go', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      projectId: 'p1',
    })
    const submit = async (text, turns) => {
      container.querySelector('.chat-input').value = text
      container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(turns))
      await vi.waitFor(() => expect(container.querySelector('.chat-send').textContent).toBe('Send'))
    }
    await submit('one', 1)
    container.querySelector('.chat-new').click()
    await submit('two', 2)
    const session = (i) => fetchMock.mock.calls[i][1].headers['x-opencode-session']
    expect(session(0)).toEqual(expect.any(String))
    expect(session(1)).not.toBe(session(0))
    vi.unstubAllGlobals()
  })
})
describe('effort passthrough', () => {
  it('passes effort from selection into the provider body', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    document.body.innerHTML = '<div id="chat"></div>'
    initChat({
      container: document.getElementById('chat'),
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test', effort: 'high' }),
      runTurnFn: async ({ provider }) => {
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
        return { messages: [] }
      },
    })
    document.querySelector('.chat-input').value = 'hi'
    document.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('high')
    vi.unstubAllGlobals()
  })
})
describe('relay base url', () => {
  it('builds per-kind relay paths under the default root', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    expect(relayBaseUrl({ kind: 'anthropic' })).toBe('https://jscad.rkroll.com/api/relay/anthropic')
    expect(relayBaseUrl({ kind: 'openai' })).toBe('https://jscad.rkroll.com/api/relay/openai')
  })

  it('uses the relay origin stamped in at build time', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    globalThis.__RELAY_ORIGIN__ = 'http://localhost:7377'
    try {
      expect(relayBaseUrl({ kind: 'meta' })).toBe('http://localhost:7377/api/relay/meta')
    } finally {
      delete globalThis.__RELAY_ORIGIN__
    }
  })

  it('honors the localStorage root override', async () => {
    window.localStorage.setItem('jscad-ai.relay', 'http://127.0.0.1:9999')
    expect(relayBaseUrl({ kind: 'openai' })).toBe('http://127.0.0.1:9999/api/relay/openai')
    window.localStorage.removeItem('jscad-ai.relay')
  })

  it('maps a free selection to the jscad-web route', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    expect(relayBaseUrl({ kind: 'jscad-web', inference: 'deepseek-v4.1-flash', free: true })).toBe('https://jscad.rkroll.com/api/relay/jscad-web/deepseek-v4.1-flash')
    window.localStorage.setItem('jscad-ai.relay', 'http://127.0.0.1:9999')
    expect(relayBaseUrl({ kind: 'jscad-web', inference: 'muse-spark-1.3', free: true })).toBe('http://127.0.0.1:9999/api/relay/jscad-web/muse-spark-1.3')
    window.localStorage.removeItem('jscad-ai.relay')
  })

})
describe('conversation context', () => {
  const submit = async (container, text, calls, runTurnFn) => {
    container.querySelector('.chat-input').value = text
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(calls))
    await vi.waitFor(() => expect(container.querySelector('.chat-send').textContent).toBe('Send'))
  }

  it('sends prior turns and the project files ahead of the new message', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ onText }) => {
      onText(`reply ${runTurnFn.mock.calls.length}`)
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      getProjectFiles: async () => ({ 'main.js': 'module.exports = {}' }),
    })
    await submit(container, 'first', 1, runTurnFn)
    await submit(container, 'second', 2, runTurnFn)
    const messages = runTurnFn.mock.calls[1][0].conversation.messages
    expect(messages[0].role).toBe('system')
    expect(messages.slice(1, 3)).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply 1' },
    ])
    expect(messages[3].content).toContain('### main.js')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'second' })
  })

  it('keeps a stored mentions list so the context can rank project files', async () => {
    const stored = [
      { role: 'user', content: 'make a cube' },
      { role: 'assistant', content: 'done', mentions: ['cube.js'] },
    ]
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const { q, type } = openChat({
      runTurnFn,
      storage: { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation: vi.fn(async () => {}) },
      projectId: 'p1',
    })
    await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe('done'))
    type('again')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    expect(runTurnFn.mock.calls[0][0].conversation.messages[2]).toEqual({
      role: 'assistant',
      content: 'done',
      mentions: ['cube.js'],
    })
  })

  it("sends the project's last build report after its files", async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    const report = { ok: false, entry: 'main.js', error: { message: 'boom', file: 'main.js', line: 2, column: 5 }, warnings: [], console: [], params: [] }
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      getProjectFiles: async () => ({ 'main.js': 'module.exports = {}' }),
      getBuild: async () => report,
    })
    await submit(container, 'fix it', 1, runTurnFn)
    const header = runTurnFn.mock.calls[0][0].conversation.messages.at(-2).content
    expect(header).toContain('### main.js')
    expect(header).toContain('Last build of the project')
    expect(header).toContain('"message":"boom"')
  })

  it('starts each turn before it reads the project for the context', async () => {
    const calls = []
    const { type } = openChat({
      runTurnFn: vi.fn(async () => {
        calls.push('runTurn')
        return { messages: [] }
      }),
      startTurn: () => calls.push('startTurn'),
      getProjectFiles: async () => {
        calls.push('getProjectFiles')
        return {}
      },
    })
    type('a cube')
    await vi.waitFor(() => expect(calls).toContain('runTurn'))
    expect(calls).toEqual(['startTurn', 'getProjectFiles', 'runTurn'])
  })

  it('ends each turn once, after the loop, even when it fails', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const endTurn = vi.fn(async () => {})
    let fail = false
    const runTurnFn = vi.fn(async ({ requestTool }) => {
      await requestTool('write', { path: 'main.js', content: 'x' })
      expect(endTurn).not.toHaveBeenCalled()
      if (fail) throw new Error('provider down')
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => ({ ok: true }),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      endTurn,
    })
    await submit(container, 'one', 1, runTurnFn)
    expect(endTurn).toHaveBeenCalledTimes(1)
    fail = true
    await submit(container, 'two', 2, runTurnFn)
    expect(endTurn).toHaveBeenCalledTimes(2)
  })

  it("ends the turn with the user's message so its version carries an excerpt", async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const endTurn = vi.fn(async () => {})
    const runTurnFn = vi.fn(async () => ({ messages: [] }))
    initChat({
      container,
      requestTool: async () => ({ ok: true }),
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
      runTurnFn,
      endTurn,
    })
    container.querySelector('.chat-input').value = 'exhaust pipes at the rear'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(endTurn).toHaveBeenCalledTimes(1))
    expect(endTurn).toHaveBeenCalledWith('exhaust pipes at the rear')
  })

  it('sends the chosen API prompt and passes the API to the loop, fluent by default', async () => {
    const run = async (getApi) => {
      document.body.innerHTML = '<div id="chat"></div>'
      const container = document.getElementById('chat')
      const runTurnFn = vi.fn(async () => ({ messages: [] }))
      initChat({
        container,
        requestTool: async () => '{}',
        getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://relay.test' }),
        runTurnFn,
        ...(getApi ? { getApi } : {}),
      })
      await submit(container, 'a cube', 1, runTurnFn)
      return runTurnFn.mock.calls[0][0]
    }
    const byDefault = await run()
    expect(byDefault.api).toBe('fluent')
    expect(byDefault.conversation.messages[0].content).toBe(buildSystemPrompt('fluent'))
    const modeling = await run(() => 'modeling')
    expect(modeling.api).toBe('modeling')
    expect(modeling.conversation.messages[0].content).toBe(buildSystemPrompt('modeling'))
  })

  it('folds evicted turns into a persisted summary sent after the system message', async () => {
    const fetchMock = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"did stuff"}}]}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const big = 'x'.repeat(13_000)
      const writeConversation = vi.fn(async () => {})
      const stored = [
        { role: 'user', content: `start ${big}` },
        { role: 'assistant', content: big },
      ]
      const runTurnFn = vi.fn(async ({ onText }) => {
        onText('reply')
        return { messages: [] }
      })
      const { q, type } = openChat({
        runTurnFn,
        storage: { readConversation: async () => ({ messages: stored, updated: 1 }), writeConversation },
        projectId: 'p1',
        getSummarizer: () => ({ kind: 'openai', model: 'cheap', apiKey: 'k', baseUrl: 'https://relay.test' }),
      })
      await vi.waitFor(() => expect(q('.chat-msg.assistant')?.textContent).toBe(big))
      type('go on')
      await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const persisted = writeConversation.mock.calls.at(-1)[1]
      expect(persisted[0]).toMatchObject({ role: 'system', basis: 2, text: 'did stuff' })
      expect(persisted[0].content).toBe(`${SUMMARY_PREFIX}did stuff`)
      expect(runTurnFn.mock.calls[0][0].conversation.messages[1].content).toBe(`${SUMMARY_PREFIX}did stuff`)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends x-jscad-chat-id through the relay but not to a custom base URL', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.removeItem('jscad-ai.relay')
    const run = async (selection) => {
      document.body.innerHTML = '<div id="chat"></div>'
      const container = document.getElementById('chat')
      const runTurnFn = vi.fn(async ({ provider }) => {
        for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
        return { messages: [] }
      })
      initChat({ container, requestTool: async () => '{}', getProvider: () => selection, runTurnFn, projectId: 'p1' })
      await submit(container, 'hi', 1, runTurnFn)
    }
    await run({ kind: 'openai', model: 'm', apiKey: 'k' })
    await run({ kind: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://direct.test' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://jscad.rkroll.com/api/relay/openai/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers['x-jscad-chat-id']).toEqual(expect.any(String))
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('x-jscad-chat-id')
    vi.unstubAllGlobals()
  })
})

describe('recording consent in the chat drawer', () => {
  const OWN_KEY = { kind: 'openai', model: 'm', apiKey: 'k' }
  const CUSTOM_KEY = { ...OWN_KEY, baseUrl: 'https://direct.test' }
  const FREE_KEY = { kind: 'jscad-web', model: 'deepseek-v4.1-flash', apiKey: 'jscad-web-free', inference: 'deepseek-v4.1-flash', free: true }

  const openChat = (getProvider) => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    initChat({ container, requestTool: async () => '{}', getProvider, runTurnFn: async () => ({ messages: [] }) })
    return container
  }

  it('shows the saved line while own-key chats are being recorded', async () => {
    const container = openChat(() => OWN_KEY)
    const notice = container.querySelector('.chat-notice')
    expect(notice.style.display).toBe('')
    expect(notice.textContent).toBe('Chats are saved to improve the assistant. Turn this off in Chat settings.')
  })

  it('hides the notice for a custom base URL that the relay never logs', async () => {
    const container = openChat(() => CUSTOM_KEY)
    expect(container.querySelector('.chat-notice').style.display).toBe('none')
  })

  it('hides the notice when the user opted out of recording', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 0, recordOwnChats: false }))
    const container = openChat(() => OWN_KEY)
    expect(container.querySelector('.chat-notice').style.display).toBe('none')
  })

  it('shows the free-models line for a free selection even when opted out', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 0, recordOwnChats: false }))
    const container = openChat(() => FREE_KEY)
    const notice = container.querySelector('.chat-notice')
    expect(notice.style.display).toBe('')
    expect(notice.textContent).toBe('Free jscad-web models share conversations to improve the assistant.')
  })

  it('refreshes the notice when the selection changes', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    let selection = OWN_KEY
    const chat = initChat({ container, requestTool: async () => '{}', getProvider: () => selection, runTurnFn: async () => ({ messages: [] }) })
    expect(container.querySelector('.chat-notice').textContent).toMatch(/Chats are saved/)
    selection = FREE_KEY
    chat.refreshNotice()
    expect(container.querySelector('.chat-notice').textContent).toMatch(/Free jscad-web models share conversations/)
  })
})

describe('own-key recording opt-out', () => {
  it('omits x-jscad-chat-id when recording is off', async () => {
    localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 0, recordOwnChats: false }))
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.removeItem('jscad-ai.relay')
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ provider }) => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'openai', model: 'm', apiKey: 'k' }),
      runTurnFn,
      projectId: 'p1',
    })
    container.querySelector('.chat-input').value = 'hi'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-jscad-chat-id')
    vi.unstubAllGlobals()
  })
})

describe('free turn routing', () => {
  it('routes a free turn to the jscad-web path with the sentinel key', async () => {
    const fetchMock = vi.fn(async () => new Response('data: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    window.localStorage.removeItem('jscad-ai.relay')
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const runTurnFn = vi.fn(async ({ provider }) => {
      for await (const e of provider.send([{ role: 'user', content: 'hi' }], [])) void e
      return { messages: [] }
    })
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'jscad-web', model: 'deepseek-v4.1-flash', apiKey: 'jscad-web-free', inference: 'deepseek-v4.1-flash', free: true }),
      runTurnFn,
    })
    container.querySelector('.chat-input').value = 'hi'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('https://jscad.rkroll.com/api/relay/jscad-web/deepseek-v4.1-flash/v1/chat/completions')
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer jscad-web-free')
    vi.unstubAllGlobals()
  })
})

describe('free quota error', () => {
  it('explains the free-model quota and points at adding a key', async () => {
    document.body.innerHTML = '<div id="chat"></div>'
    const container = document.getElementById('chat')
    const quota = Object.assign(
      new Error('openai: {"error":{"code":"inference_quota_exhausted","scope":"month"}} (status 402)'),
      { status: 402, body: '{"error":{"code":"inference_quota_exhausted"}}' },
    )
    initChat({
      container,
      requestTool: async () => '{}',
      getProvider: () => ({ kind: 'jscad-web', model: 'deepseek-v4.1-flash', apiKey: 'jscad-web-free', inference: 'deepseek-v4.1-flash', free: true }),
      runTurnFn: async () => {
        throw quota
      },
    })
    container.querySelector('.chat-input').value = 'hello'
    container.querySelector('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(container.querySelector('.chat-msg.error')).toBeTruthy())
    expect(container.querySelector('.chat-msg.error').textContent).toMatch(/Add your own key/)
  })
})

describe('view tool', () => {
  const viewResult = {
    ok: true,
    shots: [{ image: { dataUrl: 'data:image/png;base64,AAA', mime: 'image/png' }, camera: { position: [1, 2, 3], target: [0, 0, 0] } }],
  }

  it('hands a view result to the loop whole and shows only its cameras', async () => {
    let handedBack
    const runTurnFn = vi.fn(async ({ requestTool }) => {
      handedBack = await requestTool('view', { views: [{ preset: 'top' }] })
      return { messages: [] }
    })
    const { q, type } = openChat({ runTurnFn, requestTool: async () => viewResult, getProvider: () => ({ kind: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://relay.test' }) })
    type('look at it')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(1))
    // The object survives so the loop's image parts are built from it.
    expect(handedBack).toEqual(viewResult)
    // The transcript shows the cameras, never the data URL.
    const shown = q('.chat-tool-result').textContent
    expect(JSON.parse(shown)).toEqual({ ok: true, cameras: [{ position: [1, 2, 3], target: [0, 0, 0] }] })
    expect(shown).not.toContain('base64')
  })

  it('tells the loop a vision model reads images, and withholds it otherwise', async () => {
    const vision = vi.fn(async () => ({ messages: [] }))
    const text = vi.fn(async () => ({ messages: [] }))
    const { type } = openChat({ runTurnFn: vision, getProvider: () => ({ kind: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://relay.test', capabilities: { vision: true } }) })
    type('hi')
    await vi.waitFor(() => expect(vision).toHaveBeenCalledTimes(1))
    expect(vision.mock.calls[0][0].vision).toBe(true)

    const second = openChat({ runTurnFn: text })
    second.type('hi')
    await vi.waitFor(() => expect(text).toHaveBeenCalledTimes(1))
    expect(text.mock.calls[0][0].vision).toBe(false)
  })
})

describe('visionCapable', () => {
  it('reads only the provider capability metadata, never a hardcoded table', () => {
    expect(visionCapable({ model: 'any-model', capabilities: { vision: true } })).toBe(true)
    expect(visionCapable({ model: 'gpt-4o', capabilities: { vision: false } })).toBe(false)
    expect(visionCapable({ model: 'gpt-4o' })).toBe(false)
    expect(visionCapable({ model: 'some-model' })).toBe(false)
    expect(visionCapable(null)).toBe(false)
  })

  it('lets a manual override force vision on, and the models.dev cache answer', () => {
    const { writeOverride, VISION_CACHE_KEY } = modelVision
    try {
      writeOverride(globalThis.localStorage, 'longcat-2.5-preview-free', true)
      expect(visionCapable({ kind: 'opencode-go', model: 'longcat-2.5-preview-free' })).toBe(true)
    } finally {
      writeOverride(globalThis.localStorage, 'longcat-2.5-preview-free', null)
    }
    expect(visionCapable({ kind: 'opencode-go', model: 'longcat-2.5-preview-free' })).toBe(false)
    try {
      globalThis.localStorage.setItem(
        VISION_CACHE_KEY,
        JSON.stringify({ at: Date.now(), providers: { 'opencode-go': { 'longcat-2.5-preview-free': true } } }),
      )
      expect(visionCapable({ kind: 'opencode-go', model: 'longcat-2.5-preview-free' })).toBe(true)
      expect(visionCapable({ kind: 'opencode-go', model: 'longcat-2.0' })).toBe(false)
    } finally {
      globalThis.localStorage.removeItem(VISION_CACHE_KEY)
    }
  })
})

describe('askUser question card', () => {
  // The turn's requestTool routes 'question' to the panel's own `ask` control,
  // as main.js wires aiDeps.askUser to chatControls.ask.
  const askChat = (options = {}) => {
    const holder = {}
    const requestTool = vi.fn((name, input) => (name === 'question' ? holder.controls.ask(input) : Promise.resolve('{}')))
    const chat = openChat({ ...options, requestTool })
    holder.controls = chat.controls
    return { ...chat, requestTool }
  }

  it('resolves an option click as the answer and marks the tool row ok', async () => {
    let result
    const runTurnFn = vi.fn(async ({ requestTool: callTool }) => {
      result = await callTool('question', { question: 'Which size?', options: ['10', '20'], header: 'Size' })
      return { messages: [] }
    })
    const { q, type } = askChat({ runTurnFn })
    type('make it 20')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    expect(q('.chat-question-header').textContent).toBe('Size')
    expect(q('.chat-question-text').textContent).toBe('Which size?')
    const options = [...q('.chat-question-options').querySelectorAll('.chat-question-option')]
    expect(options.map((button) => button.textContent)).toEqual(['10', '20'])
    options[1].click()
    await vi.waitFor(() => expect(result).toBe('20'))
    expect(q('.chat-question').classList.contains('answered')).toBe(true)
    expect(q('.chat-question.answered').textContent).toContain('20')
    await vi.waitFor(() => expect(q('.chat-tool-mark').textContent).toBe('ok'))
    expect(q('.chat-tool-name').textContent).toBe('question')
    expect(q('.chat-tool-target').textContent).toBe('Size')
    // A second click after the answer is a no-op: the question settles once.
    options[0].click()
    expect(result).toBe('20')
  })

  it('takes a custom typed answer when the user submits the chat input', async () => {
    let result
    const runTurnFn = vi.fn(async ({ requestTool: callTool }) => {
      result = await callTool('question', { question: 'Which printer?' })
      return { messages: [] }
    })
    const { q, type } = askChat({ runTurnFn })
    type('ask me')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    expect(q('.chat-question-options')).toBeNull()
    expect(q('.chat-question-form')).not.toBeNull()
    q('.chat-input').value = 'mk3'
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(result).toBe('mk3'))
    expect(q('.chat-question.answered').textContent).toContain('mk3')
    expect(q('.chat-input').value).toBe('')
  })

  it('answers with the typed draft when Send is clicked while a question is pending', async () => {
    let result
    let release
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ messages: [] })
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void options.requestTool('question', { question: 'Which size?', options: ['10', '20'] }).then((value) => { result = value })
      }))
    const { q, type } = askChat({ runTurnFn })
    type('size?')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    q('.chat-input').value = '15'
    q('.chat-send').click()
    await vi.waitFor(() => expect(result).toBe('15'))
    expect(q('.chat-question.answered').textContent).toContain('15')
    expect(q('.chat-input').value).toBe('')
    // The draft was the answer, not a Stop: the turn is still running.
    expect(q('.chat-send').textContent).toBe('Stop')
    release()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
  })

  it('rejects a second question while one is still open, leaving the first untouched', async () => {
    let first
    let second
    let release
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ messages: [] })
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void options.requestTool('question', { question: 'First?', options: ['a', 'b'] }).then((value) => { first = value })
        void options.requestTool('question', { question: 'Second?' }).then((value) => { second = value })
      }))
    const { q, type } = askChat({ runTurnFn })
    type('go')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    await vi.waitFor(() => expect(second).toBeDefined())
    expect(JSON.parse(second)).toMatchObject({ ok: false, error: { message: 'answer the open question first' } })
    expect(q('.chat-question-text').textContent).toBe('First?')
    expect(q('.chat-question-options')).not.toBeNull()
    q('.chat-question-option').click()
    await vi.waitFor(() => expect(first).toBe('a'))
    release()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
  })

  it('rejects on Stop so the turn ends with a tool error, not a hang', async () => {
    let result
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void options.requestTool('question', { question: 'Which size?', options: ['10', '20'] }).then((value) => { result = value })
      }))
    const { q, type } = askChat({ runTurnFn })
    type('size?')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    q('.chat-send').click()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
    expect(JSON.parse(result)).toMatchObject({ ok: false, error: { name: 'AbortError' } })
    expect(q('.chat-msg.stopped').textContent).toBe('Stopped')
    expect(q('.chat-question')).toBeNull()
  })

  it('settles a question still open when the turn fails, so it never hangs', async () => {
    const runTurnFn = vi.fn(({ requestTool: callTool }) => {
      void callTool('question', { question: 'Which size?', options: ['10'] })
      return Promise.reject(new Error('provider down'))
    })
    const { q, type } = askChat({ runTurnFn })
    type('size?')
    await vi.waitFor(() => expect(q('.chat-msg.error')?.textContent).toBe('provider down'))
    expect(q('.chat-question')).toBeNull()
    expect(q('.chat-send').textContent).toBe('Send')
  })

  it('rejects on project switch without leaking the card', async () => {
    let result
    let release
    const runTurnFn = vi.fn((options) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ messages: [] })
        options.signal.addEventListener('abort', () => reject(abortError()), { once: true })
        void options.requestTool('question', { question: 'Which size?', options: ['10', '20'] }).then((value) => { result = value })
      }))
    let openId = 'p1'
    const { q, type, controls } = askChat({ runTurnFn, projectId: () => openId })
    type('size?')
    await vi.waitFor(() => expect(q('.chat-question')).not.toBeNull())
    openId = 'p2'
    await controls.switchTo('p2')
    expect(q('.chat-question')).toBeNull()
    await vi.waitFor(() => expect(JSON.parse(result)).toMatchObject({ ok: false }))
    expect(JSON.parse(result).error.message).toMatch(/project switch/)
    release()
    await vi.waitFor(() => expect(q('.chat-send').textContent).toBe('Send'))
  })
})

describe('undo this turn', () => {
  const writingTurn = async ({ onText }) => {
    onText('Done')
    return { messages: [] }
  }
  const storageOf = () => ({ readConversation: async () => null, writeConversation: vi.fn(async () => {}) })
  const runTurn = async (options) => {
    const chat = openChat({ runTurnFn: writingTurn, projectId: 'p1', ...options })
    chat.type('make it')
    await vi.waitFor(() => expect(chat.q('.chat-send').textContent).toBe('Send'))
    return chat
  }

  it('shows an undo button after a turn that wrote, calling restoreTurn with the pinned version', async () => {
    const restoreTurn = vi.fn(async () => true)
    const storage = storageOf()
    const { q } = await runTurn({ endTurn: async () => [{ projectId: 'p1', versionId: 'v9' }], restoreTurn, storage })
    const button = q('.chat-undo')
    expect(button.textContent).toBe("Undo this turn's changes")
    expect(storage.writeConversation.mock.calls.at(-1)[1].at(-1).undo).toEqual([{ projectId: 'p1', versionId: 'v9' }])
    button.click()
    await vi.waitFor(() => expect(button.textContent).toBe('Undone'))
    expect(restoreTurn).toHaveBeenCalledWith('p1', 'v9')
    expect(button.disabled).toBe(true)
  })

  it('restores each project the turn wrote, in order', async () => {
    const restoreTurn = vi.fn(async () => true)
    const { q } = await runTurn({
      endTurn: async () => [{ projectId: 'p1', versionId: 'v1' }, { projectId: 'p2', versionId: 'v2' }],
      restoreTurn,
    })
    q('.chat-undo').click()
    await vi.waitFor(() => expect(q('.chat-undo').textContent).toBe('Undone'))
    expect(restoreTurn.mock.calls).toEqual([['p1', 'v1'], ['p2', 'v2']])
  })

  it('keeps the undo button across a reload', async () => {
    const restoreTurn = vi.fn(async () => true)
    const stored = [
      { role: 'user', content: 'make it' },
      { role: 'assistant', content: 'Done', undo: [{ projectId: 'p1', versionId: 'v9' }] },
    ]
    const storage = { readConversation: async () => ({ messages: stored }), writeConversation: async () => {} }
    const { q, controls } = openChat({ storage, projectId: 'p1', restoreTurn })
    await controls.switchTo('p1')
    q('.chat-undo').click()
    await vi.waitFor(() => expect(restoreTurn).toHaveBeenCalledWith('p1', 'v9'))
  })

  it('shows no undo button for a turn that wrote nothing', async () => {
    const none = await runTurn({ endTurn: async () => [], restoreTurn: async () => true })
    expect(none.q('.chat-undo')).toBeNull()
    const unstored = await runTurn({ endTurn: async () => [{ projectId: 'p1', versionId: null }], restoreTurn: async () => true })
    expect(unstored.q('.chat-undo')).toBeNull()
  })

  it('leaves the button in place when the restore is declined', async () => {
    const restoreTurn = vi.fn(async () => false)
    const { q } = await runTurn({ endTurn: async () => [{ projectId: 'p1', versionId: 'v9' }], restoreTurn })
    q('.chat-undo').click()
    await vi.waitFor(() => expect(restoreTurn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(q('.chat-undo').disabled).toBe(false))
    expect(q('.chat-undo').textContent).toBe("Undo this turn's changes")
  })

  it('gives a turn that errors after writing its own undo message', async () => {
    const storage = storageOf()
    const { q } = await runTurn({
      runTurnFn: async () => { throw new Error('provider down') },
      endTurn: async () => [{ projectId: 'p1', versionId: 'v3' }],
      restoreTurn: async () => true,
      storage,
    })
    expect(q('.chat-undo')).not.toBeNull()
    expect(storage.writeConversation.mock.calls.at(-1)[1]).toEqual([{ role: 'assistant', content: '', undo: [{ projectId: 'p1', versionId: 'v3' }] }])
  })

  it('shows a button for a turn that wrote but said nothing, and never sends the empty message', async () => {
    const turns = []
    const runTurnFn = vi.fn(async (opts) => { turns.push(opts.conversation.messages) })
    const chat = openChat({ runTurnFn, projectId: 'p1', endTurn: async () => [{ projectId: 'p1', versionId: 'v3' }], restoreTurn: async () => true })
    chat.type('one')
    await vi.waitFor(() => expect(chat.q('.chat-undo')).not.toBeNull())
    await vi.waitFor(() => expect(chat.q('.chat-send').textContent).toBe('Send'))
    chat.type('two')
    await vi.waitFor(() => expect(runTurnFn).toHaveBeenCalledTimes(2))
    expect(turns[1].filter((m) => m.role === 'assistant')).toEqual([])
  })

  it('keeps an earlier turn undo untouched when a later turn errors', async () => {
    const storage = storageOf()
    let n = 0
    const runTurnFn = vi.fn(async ({ onText }) => {
      if (++n === 2) throw new Error('down')
      onText('Done')
    })
    const endTurn = async () => [{ projectId: 'p1', versionId: `v${n}` }]
    const chat = openChat({ runTurnFn, projectId: 'p1', endTurn, restoreTurn: async () => true, storage })
    chat.type('one')
    await vi.waitFor(() => expect(chat.q('.chat-undo')).not.toBeNull())
    await vi.waitFor(() => expect(chat.q('.chat-send').textContent).toBe('Send'))
    chat.type('two')
    await vi.waitFor(() => expect(chat.container.querySelectorAll('.chat-undo')).toHaveLength(2))
    expect(storage.writeConversation.mock.calls.at(-1)[1].map((m) => m.undo)).toEqual([undefined, [{ projectId: 'p1', versionId: 'v1' }], [{ projectId: 'p1', versionId: 'v2' }]])
  })

  it('shows Undone, disabled, after a restore and a reload', async () => {
    let saved = null
    const storage = { readConversation: async () => (saved ? { messages: saved } : null), writeConversation: vi.fn(async (_id, m) => { saved = JSON.parse(JSON.stringify(m)) }) }
    const { q } = await runTurn({ endTurn: async () => [{ projectId: 'p1', versionId: 'v9' }], restoreTurn: async () => true, storage })
    q('.chat-undo').click()
    await vi.waitFor(() => expect(q('.chat-undo').textContent).toBe('Undone'))
    await vi.waitFor(() => expect(saved.at(-1).undone).toBe(true))
    const reloaded = openChat({ storage, projectId: 'p1' })
    await reloaded.controls.switchTo('p1')
    expect([reloaded.q('.chat-undo').textContent, reloaded.q('.chat-undo').disabled]).toEqual(['Undone', true])
  })

  // Storage that hands out copies, as rowboat does, so a stale message object is never the stored one.
  const copyingStorage = (store = {}) => ({
    store,
    readConversation: async (id) => (store[id] ? { messages: JSON.parse(JSON.stringify(store[id])) } : null),
    writeConversation: vi.fn(async (id, messages) => { store[id] = JSON.parse(JSON.stringify(messages)) }),
  })

  it('marks the turn undone when the restore reopens the project under the click', async () => {
    const storage = copyingStorage()
    const holder = {}
    // main.js reopens the restored project, and its onOpen calls switchTo without awaiting it.
    const restoreTurn = vi.fn(async (projectId) => { holder.controls.switchTo(projectId); return true })
    const chat = await runTurn({ endTurn: async () => [{ projectId: 'p1', versionId: 'v9' }], restoreTurn, storage })
    holder.controls = chat.controls
    chat.q('.chat-undo').click()
    await vi.waitFor(() => expect(storage.store.p1.at(-1).undone).toBe(true))
    expect(storage.store.p1.map((m) => m.content)).toEqual(['make it', 'Done'])
    const button = chat.q('.chat-undo')
    expect([button.textContent, button.disabled]).toEqual(['Undone', true])
  })

  it('marks the owning conversation undone when the restore leaves for another project', async () => {
    const storage = copyingStorage({ p2: [{ role: 'user', content: 'p2 chat' }] })
    const holder = {}
    let openId = 'p1'
    const restoreTurn = vi.fn(async (projectId) => { openId = projectId; holder.controls.switchTo(projectId); return true })
    const chat = await runTurn({
      projectId: () => openId,
      endTurn: async () => [{ projectId: 'p1', versionId: 'v1' }, { projectId: 'p2', versionId: 'v2' }],
      restoreTurn,
      storage,
    })
    holder.controls = chat.controls
    chat.q('.chat-undo').click()
    await vi.waitFor(() => expect(storage.store.p1.at(-1).undone).toBe(true))
    expect(storage.store.p1.map((m) => m.content)).toEqual(['make it', 'Done'])
    expect(storage.store.p2).toEqual([{ role: 'user', content: 'p2 chat' }])
    expect(chat.q('.chat-messages').textContent).toBe('p2 chat')
  })
})
