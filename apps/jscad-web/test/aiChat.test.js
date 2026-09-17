// apps/jscad-web/test/aiChat.test.js
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { initChat } from '../src/aiChat.js'

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