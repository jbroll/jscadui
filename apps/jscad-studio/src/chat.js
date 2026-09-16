// The chat panel drives the agent loop: it POSTs the user's message, streams
// the SSE turn the server returns, executes each tool request in the browser,
// and POSTs the result back to resolve the loop's pending call.
import { createKeyStore } from './keys.js'

const PROVIDER_STORAGE_KEY = 'jscad-studio.provider'

// Non-secret provider selection (kind, model, baseUrl) lives in localStorage;
// the key itself lives in custody and is attached per request. It never enters
// the frame: tool inputs originate from the server, not from here.
const keyStore = createKeyStore()

const getProviderConfig = () => {
  const stored = localStorage.getItem(PROVIDER_STORAGE_KEY)
  if (!stored) return null
  const key = keyStore.get()
  if (!key) return null
  return { ...JSON.parse(stored), apiKey: key }
}

/** @param {string} tag @param {string} className @param {string} [text] */
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Splits a streamed SSE body into complete `event:`/`data:` blocks, keeping
// whatever trailing partial block is still arriving.
const parseEvents = (buffer) => {
  const events = []
  let rest = buffer
  let index
  while ((index = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, index)
    rest = rest.slice(index + 2)
    let name = ''
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (name) events.push({ name, data })
  }
  return { events, rest }
}

/**
 * @param {{container:HTMLElement,projectId?:string,requestTool:(name:string,input:object)=>Promise<object>}} options
 */
export const initChat = ({ container, projectId = 'local', requestTool }) => {
  const header = el('div', 'chat-header', 'Chat')
  const messagesEl = el('div', 'chat-messages')
  const form = el('form', 'chat-form')
  const input = el('input', 'chat-input')
  input.type = 'text'
  input.placeholder = 'Describe the part to build'
  input.autocomplete = 'off'
  const send = el('button', 'chat-send', 'Send')
  form.append(input, send)
  container.append(header, messagesEl, form)

  let running = false
  let assistantEl = null

  const addMessage = (text, kind) => {
    const node = el('div', `chat-msg ${kind}`, text)
    messagesEl.append(node)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return node
  }

  const addToolLine = (name, inputJson) => {
    const details = el('details', 'chat-tool')
    details.append(el('summary', 'chat-tool-name', name))
    details.append(el('pre', 'chat-tool-input', JSON.stringify(inputJson, null, 2)))
    const resultEl = el('pre', 'chat-tool-result', 'running...')
    details.append(resultEl)
    messagesEl.append(details)
    messagesEl.scrollTop = messagesEl.scrollHeight
    return resultEl
  }

  const setRunning = (value) => {
    running = value
    input.disabled = value
    send.disabled = value
  }

  const handleEvent = async ({ name, data }) => {
    const payload = JSON.parse(data)
    if (name === 'text') {
      if (!assistantEl) assistantEl = addMessage('', 'assistant')
      assistantEl.textContent += payload.text
      messagesEl.scrollTop = messagesEl.scrollHeight
    } else if (name === 'tool_request') {
      assistantEl = null
      const { callId, name: toolName, input: toolInput } = payload
      const resultEl = addToolLine(toolName, toolInput)
      const result = await requestTool(toolName, toolInput)
      resultEl.textContent = JSON.stringify(result, null, 2)
      await fetch(`/api/chat/${projectId}/tool/${callId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ result }),
      })
    } else if (name === 'done') {
      assistantEl = null
      setRunning(false)
    } else if (name === 'error') {
      assistantEl = null
      addMessage(payload.message, 'error')
      setRunning(false)
    }
  }

  const runTurn = async (message) => {
    setRunning(true)
    addMessage(message, 'user')
    try {
      const res = await fetch(`/api/chat/${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, provider: getProviderConfig() }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        addMessage(body.error ?? `chat request failed (${res.status})`, 'error')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseEvents(buffer)
        buffer = rest
        for (const event of events) await handleEvent(event)
        if (done) break
      }
      if (buffer.trim()) {
        const { events } = parseEvents(buffer + '\n\n')
        for (const event of events) await handleEvent(event)
      }
    } catch (err) {
      addMessage(err.message, 'error')
    } finally {
      setRunning(false)
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const message = input.value.trim()
    if (!message || running) return
    input.value = ''
    runTurn(message)
  })
}
