// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOS_VERSION } from '../src/aiConsent.js'
import { IMAGE_CAP_NOTE, initChat, NO_VISION_NOTE, NO_VISION_TITLE, REQUEST_TOO_LARGE_MESSAGE, STORED_IMAGE_MESSAGES } from '../src/aiChat.js'

beforeEach(() => {
  localStorage.setItem('jscad-ai.tos', JSON.stringify({ version: TOS_VERSION, at: 0, recordOwnChats: true }))
  localStorage.removeItem('jscad-ai.log')
})

const VISION = { kind: 'openai', model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://relay.test', capabilities: { vision: true } }
const TEXT_ONLY = { kind: 'openai', model: 'text-model', apiKey: 'k', baseUrl: 'https://relay.test' }

const image = (name, type = 'image/png') => new File(['x'], name, { type })
const prepared = (file) => ({ mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${file.name}`, width: 4, height: 3 })

const openChat = ({ selection = VISION, runTurnFn = vi.fn(async () => ({ messages: [] })), ...rest } = {}) => {
  document.body.innerHTML = '<div id="chat"></div>'
  const container = document.getElementById('chat')
  let current = selection
  const chat = initChat({
    container,
    requestTool: async () => ({ ok: true }),
    getProvider: () => current,
    runTurnFn,
    prepareImage: async (file) => prepared(file),
    ...rest,
  })
  const q = (sel) => container.querySelector(sel)
  const qa = (sel) => [...container.querySelectorAll(sel)]
  const submit = (text = '') => {
    q('.chat-input').value = text
    q('.chat-form').dispatchEvent(new Event('submit', { cancelable: true }))
  }
  const paste = (files, text = '') => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files, getData: (type) => (type === 'text/plain' ? text : '') } })
    q('.chat-input').dispatchEvent(event)
    return event
  }
  const drop = (files) => {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } })
    q('.chat-messages').dispatchEvent(event)
    return event
  }
  const pick = (files) => {
    const field = q('.chat-attach-input')
    Object.defineProperty(field, 'files', { value: files, configurable: true })
    field.dispatchEvent(new Event('change'))
  }
  const select = (next) => {
    current = next
    chat.refreshNotice()
  }
  return { container, chat, q, qa, submit, paste, drop, pick, select, runTurnFn }
}

const lastUser = (runTurnFn) => runTurnFn.mock.calls.at(-1)[0].conversation.messages.at(-1)

describe('attaching images', () => {
  it('offers the attach button only for a vision model, explaining why when it is off', () => {
    const chat = openChat({ selection: TEXT_ONLY })
    expect(chat.q('.chat-attach').disabled).toBe(true)
    expect(chat.q('.chat-attach').title).toBe(NO_VISION_TITLE)
    expect(chat.q('.chat-attach-input').accept).toBe('image/*')
    chat.select(VISION)
    expect(chat.q('.chat-attach').disabled).toBe(false)
    expect(chat.q('.chat-attach').title).toMatch(/up to 4/)
  })

  it('attaches a pasted image as a removable thumbnail', async () => {
    const chat = openChat()
    const event = chat.paste([image('shot.png')])
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    expect(chat.q('.chat-pending-item img').src).toBe('data:image/jpeg;base64,shot.png')
    chat.q('.chat-pending-remove').click()
    expect(chat.qa('.chat-pending-item')).toHaveLength(0)
  })

  it('lets pasted text through untouched', () => {
    const chat = openChat()
    expect(chat.paste([], 'plain words').defaultPrevented).toBe(false)
    expect(chat.paste([image('a.png')], 'caption').defaultPrevented).toBe(false)
  })

  it('attaches dropped images and picked files', async () => {
    const chat = openChat()
    expect(chat.drop([image('a.png'), new File(['t'], 'notes.txt', { type: 'text/plain' })]).defaultPrevented).toBe(true)
    chat.pick([image('b.jpg', 'image/jpeg')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(2))
  })

  it('shows a status line instead of attaching for a model that does not read images', async () => {
    const chat = openChat({ selection: TEXT_ONLY })
    chat.paste([image('shot.png')])
    chat.drop([image('drop.png')])
    expect(chat.q('.chat-attach-note').textContent).toBe(NO_VISION_NOTE)
    await Promise.resolve()
    expect(chat.qa('.chat-pending-item')).toHaveLength(0)
  })

  it('caps a message at four images', async () => {
    const chat = openChat()
    chat.drop([1, 2, 3, 4, 5].map((n) => image(`${n}.png`)))
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(4))
    expect(chat.q('.chat-attach-note').textContent).toBe(IMAGE_CAP_NOTE)
    chat.paste([image('6.png')])
    await Promise.resolve()
    expect(chat.qa('.chat-pending-item')).toHaveLength(4)
  })

  it('reports an image it could not read', async () => {
    const chat = openChat({ prepareImage: async () => Promise.reject(new Error('could not read bad.png')) })
    chat.paste([image('bad.png')])
    await vi.waitFor(() => expect(chat.q('.chat-attach-note').textContent).toBe('could not read bad.png'))
    expect(chat.qa('.chat-pending-item')).toHaveLength(0)
  })
})

describe('sending images', () => {
  it('sends the pending images with the message and clears them', async () => {
    const chat = openChat()
    chat.paste([image('a.png'), image('b.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(2))
    chat.submit('like this')
    await vi.waitFor(() => expect(chat.runTurnFn).toHaveBeenCalledTimes(1))
    expect(lastUser(chat.runTurnFn)).toEqual({ role: 'user', content: 'like this', images: [prepared(image('a.png')), prepared(image('b.png'))] })
    expect(chat.qa('.chat-pending-item')).toHaveLength(0)
  })

  it('sends an images-only message', async () => {
    const chat = openChat()
    chat.paste([image('a.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    chat.submit('')
    await vi.waitFor(() => expect(chat.runTurnFn).toHaveBeenCalledTimes(1))
    expect(lastUser(chat.runTurnFn)).toEqual({ role: 'user', content: '', images: [prepared(image('a.png'))] })
  })

  it('waits for an image still being prepared before sending', async () => {
    let finish
    const chat = openChat({ prepareImage: (file) => new Promise((resolve) => { finish = () => resolve(prepared(file)) }) })
    chat.paste([image('slow.png')])
    chat.submit('this one')
    await Promise.resolve()
    expect(chat.runTurnFn).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(chat.runTurnFn).toHaveBeenCalledTimes(1))
    expect(lastUser(chat.runTurnFn).images).toEqual([prepared(image('slow.png'))])
  })

  it('sends a text-only message without an images key', async () => {
    const chat = openChat()
    chat.submit('just text')
    await vi.waitFor(() => expect(chat.runTurnFn).toHaveBeenCalledTimes(1))
    expect(lastUser(chat.runTurnFn)).toEqual({ role: 'user', content: 'just text' })
  })

  it('keeps the draft and images when the model no longer reads images', async () => {
    const chat = openChat()
    chat.paste([image('a.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    chat.select(TEXT_ONLY)
    chat.submit('like this')
    await vi.waitFor(() => expect(chat.q('.chat-msg.error')?.textContent).toMatch(/does not read images/))
    expect(chat.runTurnFn).not.toHaveBeenCalled()
    expect(chat.q('.chat-input').value).toBe('like this')
    expect(chat.qa('.chat-pending-item')).toHaveLength(1)
  })

  it('shows the images in the user bubble, opening full size on click', async () => {
    const chat = openChat()
    chat.paste([image('a.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    chat.submit('like this')
    await vi.waitFor(() => expect(chat.qa('.chat-msg.user .chat-user-thumb')).toHaveLength(1))
    expect(chat.q('.chat-msg.user').textContent).toBe('like this')
    chat.q('.chat-user-thumb').click()
    expect(document.querySelector('.chat-view-overlay .chat-view-full').src).toBe('data:image/jpeg;base64,a.png')
  })

  it.each([
    ['the request guard', Object.assign(new Error('the request is 2000000 bytes'), { name: 'RequestTooLargeError' })],
    ['a relay 413', Object.assign(new Error('openai: {"error":"payload too large"} (status 413)'), { status: 413 })],
  ])('turns %s into a clear error and offers the images again', async (_name, error) => {
    const chat = openChat({ runTurnFn: vi.fn(async () => { throw error }) })
    chat.paste([image('a.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    chat.submit('like this')
    await vi.waitFor(() => expect(chat.q('.chat-msg.error')?.textContent).toBe(REQUEST_TOO_LARGE_MESSAGE))
    expect(chat.qa('.chat-pending-item')).toHaveLength(1)
  })
})

describe('stored images', () => {
  const userWith = (n) => ({ role: 'user', content: `m${n}`, images: [prepared(image(`${n}.png`))] })

  it(`keeps the bytes of the newest ${STORED_IMAGE_MESSAGES} image messages in storage`, async () => {
    const older = Array.from({ length: STORED_IMAGE_MESSAGES }, (_, i) => [userWith(i), { role: 'assistant', content: 'ok' }]).flat()
    const writeConversation = vi.fn(async () => {})
    const storage = { readConversation: async () => ({ messages: older, updated: 1 }), writeConversation }
    const chat = openChat({ storage, projectId: 'p1' })
    await vi.waitFor(() => expect(chat.qa('.chat-msg.user')).toHaveLength(STORED_IMAGE_MESSAGES))
    chat.paste([image('new.png')])
    await vi.waitFor(() => expect(chat.qa('.chat-pending-item')).toHaveLength(1))
    chat.submit('newest')
    await vi.waitFor(() => expect(chat.runTurnFn).toHaveBeenCalled())
    const stored = writeConversation.mock.calls.at(-1)[1].filter((m) => m.role === 'user')
    expect(stored[0].images).toEqual([{ mime: 'image/jpeg', width: 4, height: 3 }])
    expect(stored.slice(1).every((m) => m.images.every((i) => typeof i.dataUrl === 'string'))).toBe(true)
    // The live turn still sends what it was given.
    expect(lastUser(chat.runTurnFn).images).toEqual([prepared(image('new.png'))])
  })

  it('redraws stored images as thumbnails, and a dropped one as a marker', async () => {
    const messages = [{ role: 'user', content: 'old', images: [{ mime: 'image/png', width: 2, height: 2 }, prepared(image('kept.png'))] }]
    const chat = openChat({ storage: { readConversation: async () => ({ messages, updated: 1 }), writeConversation: vi.fn() }, projectId: 'p1' })
    await vi.waitFor(() => expect(chat.qa('.chat-user-thumb')).toHaveLength(1))
    expect(chat.qa('.chat-user-image-gone')).toHaveLength(1)
    expect(chat.q('.chat-user-thumb img').src).toBe('data:image/jpeg;base64,kept.png')
  })
})
