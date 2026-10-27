import { describe, expect, it } from 'vitest'
import { buildMessages, CONTEXT_BUDGET } from '../src/context.js'
import { MAX_VIEW_IMAGE_CHARS, runTurn } from '../src/loop.js'
import { buildSummaryPrompt } from '../src/summarize.js'
import { imageNote, USER_IMAGE_TURNS } from '../src/userImages.js'

const photo = (n, chars = 40) => ({ mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${String(n).padEnd(chars, 'A')}`, width: 1200, height: 900 })

const userTurn = (text, images) => [{ role: 'user', content: text, ...(images ? { images } : {}) }, { role: 'assistant', content: `re ${text}` }]

const build = (transcript, message = 'next', images) => buildMessages({ systemPrompt: 'S', transcript, message, ...(images ? { images } : {}) })

const userRows = (messages) => messages.filter((m) => m.role === 'user' && !m.content.startsWith('The project is empty'))

describe('user images in buildMessages', () => {
  it('attaches the new message images, and sends a text-only message as before', () => {
    expect(build([], 'look', [photo(1)]).at(-1)).toEqual({ role: 'user', content: 'look', images: [photo(1)] })
    expect(build([], 'look').at(-1)).toEqual({ role: 'user', content: 'look' })
    expect(build([], 'look', []).at(-1)).toEqual({ role: 'user', content: 'look' })
  })

  it('keeps only the newest user images, leaving a note where older ones were', () => {
    const transcript = [...userTurn('first', [photo(1), photo(2)]), ...userTurn('second', [photo(3)])]
    const [first, second, next] = userRows(build(transcript))
    expect(first.images).toBeUndefined()
    expect(first.content).toBe(`first\n\n${imageNote(photo(1))}\n${imageNote(photo(2))}`)
    expect(imageNote(photo(1))).toBe('[earlier image, no longer attached: image/jpeg, 1200x900]')
    expect(second).toEqual({ role: 'user', content: 'second', images: [photo(3)] })
    expect(next).toEqual({ role: 'user', content: 'next' })
  })

  it('a new message with images supersedes every earlier one', () => {
    const [earlier, next] = userRows(build(userTurn('first', [photo(1)]), 'now this', [photo(2)]))
    expect(earlier.images).toBeUndefined()
    expect(next.images).toEqual([photo(2)])
  })

  it(`drops the newest images too once ${USER_IMAGE_TURNS} later user messages follow them`, () => {
    const later = Array.from({ length: USER_IMAGE_TURNS - 1 }, (_, i) => userTurn(`t${i}`)).flat()
    const kept = userRows(build([...userTurn('img', [photo(1)]), ...later.slice(0, -2)]))
    expect(kept[0].images).toEqual([photo(1)])
    const dropped = userRows(build([...userTurn('img', [photo(1)]), ...later]))
    expect(dropped[0].images).toBeUndefined()
    expect(dropped[0].content).toContain(imageNote(photo(1)))
  })

  it('an images-only message becomes its note once dropped, never empty content', () => {
    const [earlier] = userRows(build([...userTurn('', [photo(1)]), ...userTurn('later', [photo(2)])]))
    expect(earlier.content).toBe(imageNote(photo(1)))
  })

  it('does not count image bytes toward the history budget', () => {
    const huge = photo(1, CONTEXT_BUDGET * 4)
    const [kept] = userRows(build(userTurn('look', [huge])))
    expect(kept.images).toEqual([huge])
  })

  it('notes an image whose bytes were not stored instead of sending it', () => {
    const stripped = { mime: 'image/png', width: 10, height: 20 }
    const [kept] = userRows(build(userTurn('look', [stripped, photo(1)])))
    expect(kept.images).toEqual([photo(1)])
    expect(kept.content).toBe(`look\n\n${imageNote(stripped)}`)
  })

  it('never mutates the transcript', () => {
    const transcript = userTurn('first', [photo(1)])
    const before = structuredClone(transcript)
    build([...transcript, ...userTurn('second', [photo(2)])])
    expect(transcript).toEqual(before)
  })
})

describe('user images in the loop', () => {
  const viewShot = (n, chars) => ({ image: { mime: 'image/png', dataUrl: `data:image/png;base64,${String(n).padEnd(chars, 'B')}` }, camera: { n } })

  const runWithViews = async (userImages, viewResults) => {
    const sent = []
    const provider = {
      async *send(messages) {
        sent.push(messages)
        if (sent.length <= viewResults.length) {
          yield { type: 'tool_use', id: `v${sent.length}`, name: 'view', input: {} }
          yield { type: 'done', stopReason: 'tool_use' }
        } else {
          yield { type: 'text', text: 'ok' }
          yield { type: 'done', stopReason: 'end_turn' }
        }
      },
    }
    let next = 0
    await runTurn({
      conversation: { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'compare', images: userImages }] },
      provider,
      requestTool: async () => viewResults[next++],
      vision: true,
    })
    return sent.at(-1)
  }

  it('keeps the user images when a view result arrives', async () => {
    const last = await runWithViews([photo(1)], [{ ok: true, shots: [viewShot(1, 50)] }, { ok: true, shots: [viewShot(2, 50)] }])
    expect(last.find((m) => m.role === 'user').images).toEqual([photo(1)])
    expect(last.filter((m) => m.role === 'tool').map((m) => m.images?.length ?? 0)).toEqual([0, 1])
  })

  it('leaves the views only the image budget the user images did not use, newest view kept', async () => {
    const user = [photo(1, 300_000), photo(2, 300_000)]
    const shots = [1, 2, 3].map((n) => viewShot(n, 150_000))
    const last = await runWithViews(user, [{ ok: true, shots }])
    const viewImages = last.find((m) => m.role === 'tool').images
    expect(viewImages.map((image) => image.dataUrl)).toEqual([shots[2].image.dataUrl])
    const total = [...user, ...viewImages].reduce((n, image) => n + image.dataUrl.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_VIEW_IMAGE_CHARS + 150_100)
  })
})

describe('user images in the summary prompt', () => {
  it('names the images a summarized turn carried', () => {
    const prompt = buildSummaryPrompt([userTurn('like this', [photo(1)])])
    expect(prompt).toContain('User: like this [image: image/jpeg, 1200x900]')
  })
})
