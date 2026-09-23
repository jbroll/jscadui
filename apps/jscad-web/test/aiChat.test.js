// apps/jscad-web/test/aiChat.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { initChat, relayBaseUrl } from '../src/aiChat.js'

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
    await vi.waitFor(() => expect(storage.writeConversation).toHaveBeenCalledWith('p1', expect.any(Array)))
    const persisted = storage.writeConversation.mock.calls.at(-1)[1]
    expect(persisted).toContainEqual({ role: 'user', content: 'hello' })
    expect(persisted).toContainEqual({ role: 'assistant', content: 'hi' })
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
      await vi.waitFor(() => expect(container.querySelector('.chat-input').disabled).toBe(false))
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
})
describe('relay base url', () => {
  it('builds per-kind relay paths under the default root', async () => {
    window.localStorage.removeItem('jscad-ai.relay')
    expect(relayBaseUrl('anthropic')).toBe('https://jscad.rkroll.com/api/relay/anthropic')
    expect(relayBaseUrl('openai')).toBe('https://jscad.rkroll.com/api/relay/openai')
  })

  it('honors the localStorage root override', async () => {
    window.localStorage.setItem('jscad-ai.relay', 'http://127.0.0.1:9999')
    expect(relayBaseUrl('openai')).toBe('http://127.0.0.1:9999/api/relay/openai')
    window.localStorage.removeItem('jscad-ai.relay')
  })
})
